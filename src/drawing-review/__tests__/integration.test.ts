import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReviewFlowService } from '../flow.service';
import { SuggestionService } from '../suggestion.service';
import { BaseAdapter } from '../adapter';

// Mock environment
const mockEnv = {
  REGISTRY: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
};

// Mock adapter
const mockAdapter = {
  listReviews: vi.fn(),
  createReview: vi.fn(),
  createRecord: vi.fn(),
  findReviewById: vi.fn(),
  updateReview: vi.fn(),
  findReviewsByPattern: vi.fn(),
  getProjectSuggestions: vi.fn(),
  getMachineSuggestions: vi.fn(),
};

describe('图纸评审 - 联想功能集成测试', () => {
  let flowService: ReviewFlowService;
  let suggestionService: SuggestionService;

  beforeEach(() => {
    vi.clearAllMocks();
    flowService = new ReviewFlowService(mockEnv as any, mockAdapter as any);
    suggestionService = new SuggestionService(mockAdapter as any);
    
    // Setup default mock responses
    mockEnv.REGISTRY.get.mockResolvedValue(null);
    mockAdapter.listReviews.mockResolvedValue([]);
    mockAdapter.createReview.mockImplementation(async (review: any) => ({
      recordId: 'rec-1',
      ...review,
    }));
    mockAdapter.getProjectSuggestions.mockResolvedValue([]);
    mockAdapter.getMachineSuggestions.mockResolvedValue([]);
  });

  describe('完整的联想工作流程', () => {
    it('should complete full suggestion workflow', async () => {
      // 1. 用户开始输入项目编号
      const projectQuery = 'PRJ';
      mockAdapter.getProjectSuggestions.mockResolvedValue(['PRJ-001', 'PRJ-002']);
      
      const projectSuggestions = await suggestionService.getSuggestions({}, projectQuery);
      expect(projectSuggestions).toHaveLength(2);
      expect(projectSuggestions[0].type).toBe('project');
      
      // 2. 用户选择项目编号，触发机型联想
      const selectedProject = 'PRJ-001';
      const machineQuery = 'R1';
      mockAdapter.getMachineSuggestions.mockResolvedValue(['R1底盘', 'R1机械臂']);
      
      const machineSuggestions = await suggestionService.getSuggestions(
        { projectId: selectedProject }, 
        machineQuery
      );
      expect(machineSuggestions.some(s => s.type === 'machine')).toBe(true);
      
      // 3. 用户提交表单，系统应用智能默认值
      const submitInput = {
        projectId: selectedProject,
        machineName: 'R1底盘',
        drawingFiles: [{ name: 'test.pdf', token: 'test-token' }],
        designNotes: '', // 空值，应该使用模板
      };
      
      const result = await flowService.submit(submitInput, 'user-123');
      
      expect(result.projectId).toBe(selectedProject);
      expect(result.machineName).toBe('R1底盘');
      expect(result.designNotes).toContain('【设计说明模板】');
      expect(result.designerId).toBe('user-123');
    });

    it('should handle task-based suggestions in workflow', async () => {
      // 模拟已有任务数据
      const existingReview = {
        recordId: 'rec-1',
        reviewId: 'DR-001',
        projectId: 'PRJ-001',
        machineName: 'R1底盘',
        drawingVersion: 'V1.0',
        designerId: 'user-123',
        drawingFiles: [],
        designNotes: '测试',
        status: 'pending_review',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      mockAdapter.findReviewById.mockResolvedValue(existingReview);
      mockAdapter.findReviewsByPattern
        .mockResolvedValueOnce([ // 相关机型
          { ...existingReview, machineName: 'R2底盘', drawingVersion: 'V1.1' },
        ])
        .mockResolvedValueOnce([ // 历史项目
          { ...existingReview, projectId: 'PRJ-002', machineName: 'R3底盘', reviewId: 'DR-002' },
        ]);
      
      // 获取基于任务的联想
      const taskSuggestions = await suggestionService.getTaskBasedSuggestions('DR-001');
      
      expect(taskSuggestions.length).toBeGreaterThan(0);
      expect(taskSuggestions.some(s => s.label.includes('相关机型'))).toBe(true);
      
      // 用户基于建议选择新的机型
      const newMachineName = taskSuggestions.find(s => s.type === 'machine')?.value;
      expect(newMachineName).toBe('R2底盘');
    });

    it('should maintain data consistency throughout workflow', async () => {
      // 模拟用户完整的填写流程
      const workflowSteps: Array<() => Promise<any>> = [
        // 步骤 1: 获取项目建议
        async () => {
          mockAdapter.getProjectSuggestions.mockResolvedValue(['PRJ-001', 'PRJ-002']);
          return await suggestionService.getSuggestions({}, 'PRJ');
        },
        
        // 步骤 2: 获取机型建议
        async () => {
          mockAdapter.getMachineSuggestions.mockResolvedValue(['R1底盘', 'R2底盘']);
          return await suggestionService.getSuggestions({ projectId: 'PRJ-001' }, 'R');
        },
        
        // 步骤 3: 提交表单
        async () => {
          const input = {
            projectId: 'PRJ-001',
            machineName: 'R1底盘',
            drawingFiles: [{ name: 'test.pdf', token: 'test-token' }],
          };
          return await flowService.submit(input, 'user-123');
        },
      ];
      
      // 执行完整工作流程
      const projectSuggestions = await workflowSteps[0]();
      expect(projectSuggestions.length).toBeGreaterThan(0);
      
      const machineSuggestions = await workflowSteps[1]();
      expect(machineSuggestions.length).toBeGreaterThan(0);
      
      const submitResult = await workflowSteps[2]();
      expect(submitResult.reviewId).toBeDefined();
      expect(submitResult.status).toBe('pending_review');
    });
  });

  describe('错误处理和边界情况', () => {
    it('should handle empty suggestions gracefully', async () => {
      mockAdapter.getProjectSuggestions.mockResolvedValue([]);
      mockAdapter.getMachineSuggestions.mockResolvedValue([]);
      
      const suggestions = await suggestionService.getSuggestions({}, 'XYZ');
      expect(suggestions).toEqual([]);
    });

    it('should handle adapter errors gracefully', async () => {
      mockAdapter.getProjectSuggestions.mockRejectedValue(new Error('Database error'));
      
      // 当前实现会抛出异常，这是可以接受的
      await expect(suggestionService.getSuggestions({}, 'PRJ')).rejects.toThrow('Database error');
    });

    it('should validate input parameters', async () => {
      // 测试空查询字符串
      const emptyQuerySuggestions = await suggestionService.getSuggestions({}, '');
      expect(emptyQuerySuggestions).toEqual([]);
      
      // 测试特殊字符
      const specialCharSuggestions = await suggestionService.getSuggestions({}, '!@#$%');
      expect(specialCharSuggestions).toEqual([]);
    });
  });

  describe('性能和限制', () => {
    it('should respect suggestion limits', async () => {
      // 模拟大量建议
      const manyProjects = Array.from({ length: 20 }, (_, i) => `PRJ-${i.toString().padStart(3, '0')}`);
      const manyMachines = Array.from({ length: 20 }, (_, i) => `机型${i}`);
      
      mockAdapter.getProjectSuggestions.mockResolvedValue(manyProjects);
      mockAdapter.getMachineSuggestions.mockResolvedValue(manyMachines);
      
      const suggestions = await suggestionService.getSuggestions({}, '');
      
      // 应该限制总建议数量
      expect(suggestions.length).toBeLessThanOrEqual(8);
    });

    it('should deduplicate suggestions', async () => {
      mockAdapter.getProjectSuggestions.mockResolvedValue(['PRJ-001', 'PRJ-001', 'PRJ-002']);
      mockAdapter.getMachineSuggestions.mockResolvedValue(['R1底盘', 'R1底盘']);
      
      const suggestions = await suggestionService.getSuggestions({}, 'PRJ');
      
      const projectValues = suggestions.filter(s => s.type === 'project').map(s => s.value);
      const uniqueProjectValues = [...new Set(projectValues)];
      
      expect(projectValues.length).toBe(uniqueProjectValues.length);
    });
  });
});
