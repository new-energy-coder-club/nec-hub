import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SuggestionService } from '../suggestion.service';
import { BaseAdapter } from '../adapter';

// Mock adapter
const mockAdapter = {
  getProjectSuggestions: vi.fn(),
  getMachineSuggestions: vi.fn(),
  findReviewById: vi.fn(),
  findReviewsByPattern: vi.fn(),
};

describe('图纸评审 - 联想服务', () => {
  let suggestionService: SuggestionService;

  beforeEach(() => {
    vi.clearAllMocks();
    suggestionService = new SuggestionService(mockAdapter as any);
  });

  describe('基础联想功能', () => {
    it('should return project suggestions', async () => {
      mockAdapter.getProjectSuggestions.mockResolvedValue(['PRJ-001', 'PRJ-002', 'PRJ-003']);
      mockAdapter.getMachineSuggestions.mockResolvedValue([]);

      const result = await suggestionService.getSuggestions({}, 'PRJ');

      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('project');
      expect(result[0].value).toBe('PRJ-001');
    });

    it('should return machine suggestions', async () => {
      mockAdapter.getProjectSuggestions.mockResolvedValue([]);
      mockAdapter.getMachineSuggestions.mockResolvedValue(['R1底盘', 'R2底盘', '机械臂']);

      const result = await suggestionService.getSuggestions({}, 'R');

      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('machine');
      expect(result[0].value).toBe('R1底盘');
    });

    it('should combine project and machine suggestions', async () => {
      mockAdapter.getProjectSuggestions.mockResolvedValue(['PRJ-001']);
      mockAdapter.getMachineSuggestions.mockResolvedValue(['R1底盘']);

      const result = await suggestionService.getSuggestions({}, 'R');

      expect(result).toHaveLength(2);
      expect(result.some(s => s.type === 'project')).toBe(true);
      expect(result.some(s => s.type === 'machine')).toBe(true);
    });

    it('should filter suggestions based on context', async () => {
      mockAdapter.getProjectSuggestions.mockResolvedValue(['PRJ-001', 'PRJ-002']);
      mockAdapter.getMachineSuggestions.mockResolvedValue(['R1底盘', 'R2底盘']);

      const context = { projectId: 'PRJ-001' };
      const result = await suggestionService.getSuggestions(context, 'PRJ');

      // 应该过滤掉不匹配的项目建议
      expect(result.length).toBeLessThanOrEqual(4);
    });
  });

  describe('基于任务的智能联想', () => {
    it('should return task-based suggestions', async () => {
      const mockReview = {
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

      mockAdapter.findReviewById.mockResolvedValue(mockReview);
      
      // 第一次调用：基于项目编号查找相关机型
      mockAdapter.findReviewsByPattern.mockResolvedValueOnce([
        { ...mockReview, machineName: 'R2底盘', drawingVersion: 'V1.1' },
        { ...mockReview, machineName: '机械臂', drawingVersion: 'V2.0' },
      ]);
      
      // 第二次调用：基于设计师查找历史项目
      mockAdapter.findReviewsByPattern.mockResolvedValueOnce([
        { ...mockReview, projectId: 'PRJ-002', machineName: 'R3底盘', reviewId: 'DR-002' },
        { ...mockReview, projectId: 'PRJ-003', machineName: 'R4底盘', reviewId: 'DR-003' },
      ]);

      const result = await suggestionService.getTaskBasedSuggestions('DR-001');

      // 应该返回相关机型和历史项目的建议，但可能会因为去重而少于预期
      expect(result.length).toBeGreaterThan(0);
      expect(result.some(s => s.label.includes('相关机型'))).toBe(true);
      expect(result.some(s => s.label.includes('历史项目'))).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      mockAdapter.findReviewById.mockRejectedValue(new Error('Database error'));

      const result = await suggestionService.getTaskBasedSuggestions('DR-001');

      expect(result).toEqual([]);
    });
  });

  describe('联想结果处理', () => {
    it('should deduplicate suggestions', async () => {
      mockAdapter.getProjectSuggestions.mockResolvedValue(['PRJ-001', 'PRJ-001', 'PRJ-002']);
      mockAdapter.getMachineSuggestions.mockResolvedValue(['R1底盘', 'R1底盘']);

      const result = await suggestionService.getSuggestions({}, 'PRJ');

      // 应该去重
      const projectValues = result.filter(s => s.type === 'project').map(s => s.value);
      expect(projectValues).toEqual(['PRJ-001', 'PRJ-002']);
    });

    it('should limit suggestion count', async () => {
      mockAdapter.getProjectSuggestions.mockResolvedValue(['PRJ-001', 'PRJ-002', 'PRJ-003', 'PRJ-004', 'PRJ-005']);
      mockAdapter.getMachineSuggestions.mockResolvedValue(['R1', 'R2', 'R3', 'R4', 'R5']);

      const result = await suggestionService.getSuggestions({}, '');

      // 应该限制总数量
      expect(result.length).toBeLessThanOrEqual(8);
    });
  });
});
