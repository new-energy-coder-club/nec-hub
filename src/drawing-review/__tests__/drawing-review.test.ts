import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReviewFlowService, SubmitReviewInput } from '../flow.service';
import { InventoryService, MANUAL_IMPORT_SOURCE } from '../inventory.service';
import { DrawingReviewAdapter } from '../adapter';
import { DrawingReviewConfig } from '../types';
import { KV_KEYS } from '../../shared/kv-keys';

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
};

describe('Drawing Review - Easy Filling Functionality', () => {
  let service: ReviewFlowService;
  const mockConfig: DrawingReviewConfig = {
    base: 'test-base',
    tables: {
      reviews: 'tbl-reviews',
      minutes: 'tbl-minutes',
      rectifications: 'tbl-rectifications',
      bom: 'tbl-bom',
      assessments: 'tbl-assessments',
      inventory: 'tbl-inventory',
      delivery: 'tbl-delivery',
      schedule: 'tbl-schedule',
      inquiries: 'tbl-inquiries',
      events: 'tbl-events',
    },
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ReviewFlowService(mockEnv as any, mockAdapter as any);
    
    // Setup default mock responses
    mockEnv.REGISTRY.get.mockResolvedValue(null);
    mockAdapter.listReviews.mockResolvedValue([]);
    
    // Mock createReview to return a dynamic response based on input
    mockAdapter.createReview.mockImplementation(async (review: any) => {
      return {
        recordId: 'rec-1',
        reviewId: review.reviewId,
        projectId: review.projectId,
        machineName: review.machineName,
        drawingVersion: review.drawingVersion,
        designerId: review.designerId,
        drawingFiles: review.drawingFiles,
        designNotes: review.designNotes,
        status: review.status,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
      };
    });
  });

  describe('自动默认填写功能', () => {
    it('should use current user as designer when not specified', async () => {
      const input: SubmitReviewInput = {
        projectId: 'PRJ-001',
        machineName: 'R1底盘',
        drawingFiles: [{ name: 'test.pdf', token: 'test-token' }],
      };
      
      const result = await service.submit(input, 'user-123');
      
      expect(result.designerId).toBe('user-123');
    });

    it('should generate default drawing version when not specified', async () => {
      const input: SubmitReviewInput = {
        projectId: 'PRJ-001',
        machineName: 'R1底盘',
        drawingFiles: [{ name: 'test.pdf', token: 'test-token' }],
      };
      
      const result = await service.submit(input, 'user-123');
      
      expect(result.drawingVersion).toBe('V1.0');
    });

    it('should use template for design notes when not specified', async () => {
      const input: SubmitReviewInput = {
        projectId: 'PRJ-001',
        machineName: 'R1底盘',
        drawingFiles: [{ name: 'test.pdf', token: 'test-token' }],
      };
      
      const result = await service.submit(input, 'user-123');
      
      // The template should be used when designNotes is not provided
      // Since we're using the default template, it should contain the template text
      expect(result.designNotes).toContain('【设计说明模板】');
      expect(result.designNotes).toContain('设计背景与目标');
    });

    it('should increment version for existing project/machine', async () => {
      // Mock existing reviews with versions
      mockAdapter.listReviews.mockResolvedValue([
        {
          recordId: 'rec-1',
          reviewId: 'DR-20261013-001',
          projectId: 'PRJ-001',
          machineName: 'R1底盘',
          drawingVersion: 'V1.0',
          designerId: 'user-123',
          drawingFiles: [],
          designNotes: 'Previous version',
          status: 'pending_review',
          createdAt: '2026-10-13T00:00:00Z',
          updatedAt: '2026-10-13T00:00:00Z',
        }
      ]);
      
      const input: SubmitReviewInput = {
        projectId: 'PRJ-001',
        machineName: 'R1底盘',
        drawingFiles: [{ name: 'test.pdf', token: 'test-token' }],
      };
      
      const result = await service.submit(input, 'user-123');
      
      expect(result.drawingVersion).toBe('V1.1');
    });

    it('should save user preferences after successful submission', async () => {
      const input: SubmitReviewInput = {
        projectId: 'PRJ-001',
        machineName: 'R1底盘',
        drawingFiles: [{ name: 'test.pdf', token: 'test-token' }],
        designNotes: 'Custom notes',
      };
      
      await service.submit(input, 'user-123');
      
      expect(mockEnv.REGISTRY.put).toHaveBeenCalledWith(
        KV_KEYS.userPrefs('dr', 'user-123'),
        expect.stringContaining('defaultProjectId')
      );
      expect(mockEnv.REGISTRY.put).not.toHaveBeenCalledWith(
        KV_KEYS.legacyUserPrefs('user-123'),
        expect.anything()
      );
    });
  });

  describe('开始填写（方便填写）功能', () => {
    it('should return defaults from getDefaultSubmissionValues', async () => {
      const input: SubmitReviewInput = {
        projectId: 'PRJ-001',
        machineName: 'R1底盘',
        drawingFiles: [{ name: 'test.pdf', token: 'test-token' }],
      };
      
      const defaults = await service.getDefaultSubmissionValues(input, 'user-123');
      
      expect(defaults).toEqual({
        projectId: 'PRJ-001',
        machineName: 'R1底盘',
        drawingVersion: 'V1.0',
        designerId: 'user-123',
        designNotes: expect.stringContaining('【设计说明模板】'),
      });
    });

    it('should return defaults with user preferences', async () => {
      // Mock user preferences
      mockEnv.REGISTRY.get.mockResolvedValue(JSON.stringify({
        defaultProjectId: 'PRJ-001',
        defaultMachineName: 'R1底盘',
        lastUsedVersion: 'V2.0',
        preferredTemplate: 'v2',
      }));
      
      const input: SubmitReviewInput = {
        drawingFiles: [{ name: 'test.pdf', token: 'test-token' }],
      };
      
      const defaults = await service.getDefaultSubmissionValues(input, 'user-123');
      
      expect(defaults.projectId).toBe('PRJ-001');
      expect(defaults.machineName).toBe('R1底盘');
      expect(defaults.drawingVersion).toBe('V2.0');
    });

    it('should read legacy preferences only when the module-scoped key misses', async () => {
      mockEnv.REGISTRY.get.mockImplementation(async (key: string) =>
        key === KV_KEYS.legacyUserPrefs('user-123')
          ? JSON.stringify({ defaultProjectId: 'PRJ-LEGACY', defaultMachineName: ' legacy-machine ' })
          : null
      );

      const defaults = await service.getDefaultSubmissionValues({
        drawingFiles: [{ name: 'test.pdf', token: 'test-token' }],
      }, 'user-123');

      expect(defaults.projectId).toBe('PRJ-LEGACY');
      expect(mockEnv.REGISTRY.get.mock.calls.map(([key]) => key)).toEqual([
        KV_KEYS.userPrefs('dr', 'user-123'),
        KV_KEYS.legacyUserPrefs('user-123'),
      ]);
    });
  });

  describe('表单验证', () => {
    it('should validate required fields', async () => {
      const input: SubmitReviewInput = {
        drawingFiles: [],
      };
      
      await expect(service.submit(input, 'user-123')).rejects.toThrow(
        '项目编号、机型名称和图纸文件为必填项'
      );
    });

    it('should validate project ID and machine name', async () => {
      const input: SubmitReviewInput = {
        drawingFiles: [{ name: 'test.pdf', token: 'test-token' }],
      };
      
      await expect(service.submit(input, 'user-123')).rejects.toThrow(
        '项目编号、机型名称和图纸文件为必填项'
      );
    });
  });
});

describe('库存手动导入兜底（PRD §13.7）', () => {
  let inventoryService: InventoryService;
  const mockInventoryAdapter = {
    listInventoryByReview: vi.fn(),
    createInventoryRow: vi.fn(),
    updateInventoryRow: vi.fn(),
    createRecord: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    inventoryService = new InventoryService(mockInventoryAdapter as any);
    mockInventoryAdapter.listInventoryByReview.mockResolvedValue([]);
    mockInventoryAdapter.createInventoryRow.mockImplementation(async (row: any) => ({
      recordId: `rec-${row.materialCode}`,
      ...row,
    }));
    mockInventoryAdapter.updateInventoryRow.mockImplementation(async (recordId: string, row: any) => ({
      recordId,
      ...row,
    }));
    mockInventoryAdapter.createRecord.mockResolvedValue({ record_id: 'rec-event' });
  });

  it('导入成功：逐行写入 inventory 表，来源固定「手动导入」，并写事件日志', async () => {
    const rows = [
      { materialCode: 'M-001', materialName: '铝型材 4040', spec: '4040-L500', quantity: 10, unit: '根', warehouse: '主仓', location: 'A-01' },
      { materialCode: 'M-002', materialName: 'M6 螺栓', quantity: 200, unit: '颗' },
    ];

    const result = await inventoryService.importRows('DR-001', rows, 'user-123');

    expect(result).toEqual({ ok: true, imported: 2, skipped: 0, errors: [] });
    expect(mockInventoryAdapter.createInventoryRow).toHaveBeenCalledTimes(2);
    const firstRow = mockInventoryAdapter.createInventoryRow.mock.calls[0][0];
    expect(firstRow.source).toBe(MANUAL_IMPORT_SOURCE);
    expect(firstRow.reviewId).toBe('DR-001');
    expect(firstRow.importedBy).toBe('user-123');
    expect(firstRow.specification).toBe('4040-L500');
    // 事件日志：inventory_import
    expect(mockInventoryAdapter.createRecord).toHaveBeenCalledWith(
      'events',
      expect.objectContaining({ 关联评审单: 'DR-001', 动作: 'inventory_import', 操作人: 'user-123' }),
    );
  });

  it('必填校验：缺物料名称 / quantity<=0 的行被跳过并记入 errors，不阻断整批', async () => {
    const rows = [
      { materialCode: 'M-001', materialName: '铝型材', quantity: 5 },
      { materialCode: 'M-002', materialName: '', quantity: 3 },
      { materialCode: 'M-003', materialName: '螺栓', quantity: 0 },
      { materialName: '无编码', quantity: 1 },
    ];

    const result = await inventoryService.importRows('DR-001', rows, 'user-123');

    expect(result.ok).toBe(true);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(3);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.map((e) => e.index)).toEqual([1, 2, 3]);
    expect(mockInventoryAdapter.createInventoryRow).toHaveBeenCalledTimes(1);
  });

  it('幂等：同评审单 + 同物料编码重复导入时更新数量而非重复建行', async () => {
    mockInventoryAdapter.listInventoryByReview.mockResolvedValue([
      {
        recordId: 'rec-existing',
        materialCode: 'M-001',
        materialName: '铝型材 4040',
        quantity: 10,
        source: MANUAL_IMPORT_SOURCE,
        reviewId: 'DR-001',
      },
    ]);

    const rows = [{ materialCode: 'M-001', materialName: '铝型材 4040', quantity: 25 }];

    const result = await inventoryService.importRows('DR-001', rows, 'user-123');

    expect(result).toEqual({ ok: true, imported: 1, skipped: 0, errors: [] });
    expect(mockInventoryAdapter.createInventoryRow).not.toHaveBeenCalled();
    expect(mockInventoryAdapter.updateInventoryRow).toHaveBeenCalledWith(
      'rec-existing',
      expect.objectContaining({ materialCode: 'M-001', quantity: 25, source: MANUAL_IMPORT_SOURCE }),
    );
  });

  it('单行写入失败不阻断整批，失败行进入 errors', async () => {
    mockInventoryAdapter.createInventoryRow
      .mockRejectedValueOnce(new Error('bitable 写入超时'))
      .mockImplementationOnce(async (row: any) => ({ recordId: 'rec-ok', ...row }));

    const rows = [
      { materialCode: 'M-001', materialName: '铝型材', quantity: 5 },
      { materialCode: 'M-002', materialName: '螺栓', quantity: 100 },
    ];

    const result = await inventoryService.importRows('DR-001', rows, 'user-123');

    expect(result.ok).toBe(true);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([
      { index: 0, materialCode: 'M-001', message: 'bitable 写入超时' },
    ]);
  });

  it('事件日志写入失败不影响导入结果', async () => {
    mockInventoryAdapter.createRecord.mockRejectedValue(new Error('events 表不可用'));

    const rows = [{ materialCode: 'M-001', materialName: '铝型材', quantity: 5 }];

    const result = await inventoryService.importRows('DR-001', rows, 'user-123');

    expect(result).toEqual({ ok: true, imported: 1, skipped: 0, errors: [] });
  });
});
