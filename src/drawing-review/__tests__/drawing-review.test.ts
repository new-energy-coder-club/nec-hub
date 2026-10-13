import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReviewFlowService, SubmitReviewInput } from '../flow.service';
import { DrawingReviewAdapter } from '../adapter';
import { DrawingReviewConfig } from '../types';

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
        'user-prefs:user-123',
        expect.stringContaining('defaultProjectId')
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
