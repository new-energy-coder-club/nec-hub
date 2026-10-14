import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CollectService, UserInputError } from '../collect.service';
import { PlanService } from '../plan.service';
import { SeasonGoalsConfig } from '../types';

const mockEnv = {
  REGISTRY: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
};

const mockAdapter = {
  listGoals: vi.fn(),
  listSubmissions: vi.fn(),
  getSubmission: vi.fn(),
  createSubmission: vi.fn(),
  updateSubmission: vi.fn(),
  createGoal: vi.fn(),
  listTasks: vi.fn(),
};

const mockConfig: SeasonGoalsConfig = {
  base: 'test-base',
  tables: {
    goals: 'tbl-goals',
    collect: 'tbl-collect',
    tasks: 'tbl-tasks',
  },
  updatedAt: new Date().toISOString(),
};

describe('Season Goals - CollectService', () => {
  let service: CollectService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CollectService(mockAdapter as any);
    mockAdapter.createSubmission.mockImplementation(async (fields: any) => ({ record_id: 'rec-collect-1', fields }));
    mockAdapter.createGoal.mockImplementation(async (fields: any) => ({ record_id: 'rec-goal-1', fields }));
  });

  describe('submit 校验', () => {
    it('缺少目标标题时抛错', async () => {
      await expect(service.submit('张三', { krs: 'KR1', group: '硬件组', deadline: '2026-12-31' }))
        .rejects.toThrow('请填写目标');
    });

    it('缺少关键结果时抛错', async () => {
      await expect(service.submit('张三', { title: '目标', group: '硬件组', deadline: '2026-12-31' }))
        .rejects.toThrow('请填写关键结果');
    });

    it('缺少负责组时抛错', async () => {
      await expect(service.submit('张三', { title: '目标', krs: 'KR1', deadline: '2026-12-31' }))
        .rejects.toThrow('请填写负责组');
    });

    it('缺少截止日期时抛错', async () => {
      await expect(service.submit('张三', { title: '目标', krs: 'KR1', group: '硬件组' }))
        .rejects.toThrow('请选择截止日期');
    });

    it('截止日期格式非法时抛错', async () => {
      await expect(service.submit('张三', { title: '目标', krs: 'KR1', group: '硬件组', deadline: '2026/12/31' }))
        .rejects.toThrow('请选择截止日期');
    });

    it('校验失败抛出 UserInputError（路由层按 400 返回）', async () => {
      await expect(service.submit('张三', {})).rejects.toBeInstanceOf(UserInputError);
    });
  });

  describe('submit 成功', () => {
    it('写入收集单：状态=待评审，来源=手工，提交人=当前用户', async () => {
      const result = await service.submit('张三', {
        title: '完成底盘迭代',
        krs: 'KR1 通过评审',
        group: '硬件组',
        deadline: '2026-12-31',
        note: '备注',
      });

      expect(result.recordId).toBe('rec-collect-1');
      expect(mockAdapter.createSubmission).toHaveBeenCalledWith({
        title: '完成底盘迭代',
        krs: 'KR1 通过评审',
        group: '硬件组',
        deadline: '2026-12-31',
        note: '备注',
        status: '待评审',
        source: '手工',
        submitter: '张三',
      });
    });
  });

  describe('approve 采纳', () => {
    it('创建目标（进行中/完成度0）并把收集单标记为已采纳', async () => {
      mockAdapter.getSubmission.mockResolvedValue({
        recordId: 'rec-collect-1',
        title: '完成底盘迭代',
        krs: 'KR1',
        group: '硬件组',
        deadline: '2026-12-31',
        note: '',
        source: '手工',
        submitter: '张三',
        status: '待评审',
      });

      const result = await service.approve('rec-collect-1');

      expect(result.goalRecordId).toBe('rec-goal-1');
      expect(mockAdapter.createGoal).toHaveBeenCalledWith({
        title: '完成底盘迭代',
        krs: 'KR1',
        group: '硬件组',
        deadline: '2026-12-31',
        status: '进行中',
        progress: 0,
        source: '手工',
      });
      expect(mockAdapter.updateSubmission).toHaveBeenCalledWith('rec-collect-1', { status: '已采纳' });
    });

    it('收集单不存在时抛错', async () => {
      mockAdapter.getSubmission.mockResolvedValue(null);
      await expect(service.approve('rec-x')).rejects.toThrow('不存在');
    });

    it('非待评审状态不能重复采纳', async () => {
      mockAdapter.getSubmission.mockResolvedValue({ recordId: 'rec-1', status: '已采纳' });
      await expect(service.approve('rec-1')).rejects.toThrow('不能重复采纳');
      expect(mockAdapter.createGoal).not.toHaveBeenCalled();
    });
  });

  describe('reject 拒绝', () => {
    it('待评审收集单标记为已拒绝', async () => {
      mockAdapter.getSubmission.mockResolvedValue({ recordId: 'rec-1', status: '待评审' });
      const result = await service.reject('rec-1');
      expect(result.recordId).toBe('rec-1');
      expect(mockAdapter.updateSubmission).toHaveBeenCalledWith('rec-1', { status: '已拒绝' });
    });

    it('非待评审状态不能拒绝', async () => {
      mockAdapter.getSubmission.mockResolvedValue({ recordId: 'rec-1', status: '已采纳' });
      await expect(service.reject('rec-1')).rejects.toThrow('不能拒绝');
    });
  });
});

describe('Season Goals - PlanService', () => {
  let service: PlanService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PlanService(mockEnv as any, mockAdapter as any, mockConfig);
    mockEnv.REGISTRY.get.mockResolvedValue(null);
    mockAdapter.listGoals.mockResolvedValue([]);
    mockAdapter.createSubmission.mockImplementation(async (fields: any) => ({
      record_id: 'rec-auto-' + Math.floor(Math.random() * 1000),
      fields,
    }));
  });

  it('preview：按负责组聚合未完成任务，排除已完成任务', async () => {
    mockAdapter.listTasks.mockResolvedValue([
      { recordId: 't1', title: '设计图纸', group: '硬件组', deadline: '2026-11-01', status: '进行中' },
      { recordId: 't2', title: '加工零件', group: '硬件组', deadline: '2026-12-15', status: '' },
      { recordId: 't3', title: '旧任务', group: '硬件组', deadline: '2026-10-01', status: '已完成' },
      { recordId: 't4', title: '写代码', group: '软件组', deadline: '2026-11-20', status: '进行中' },
    ]);

    const result = await service.preview();

    expect(result.taskCount).toBe(3);
    expect(result.suggestions).toHaveLength(2);
    const hw = result.suggestions.find(s => s.group === '硬件组');
    expect(hw).toBeDefined();
    expect(hw!.title).toBe('硬件组 赛季目标（自动规划）');
    expect(hw!.basedOnTasks).not.toContain('旧任务');
  });

  it('preview：跳过已有进行中目标的组', async () => {
    mockAdapter.listTasks.mockResolvedValue([
      { recordId: 't1', title: '设计图纸', group: '硬件组', deadline: '2026-11-01', status: '进行中' },
      { recordId: 't2', title: '写代码', group: '软件组', deadline: '2026-11-20', status: '进行中' },
    ]);
    mockAdapter.listGoals.mockResolvedValue([
      { recordId: 'g1', title: '硬件组赛季目标', krs: '', group: '硬件组', deadline: '2026-12-31', progress: 50, status: '进行中', source: '手工', note: '' },
      { recordId: 'g2', title: '已完成目标', krs: '', group: '软件组', deadline: '2026-09-01', progress: 100, status: '已完成', source: '手工', note: '' },
    ]);

    const result = await service.preview();

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].group).toBe('软件组');
    expect(result.skipped).toEqual([{ group: '硬件组', reason: '该组已有进行中的目标，跳过' }]);
  });

  it('preview：截止日期取组内任务最晚截止', async () => {
    mockAdapter.listTasks.mockResolvedValue([
      { recordId: 't1', title: '任务A', group: '硬件组', deadline: '2026-11-01', status: '' },
      { recordId: 't2', title: '任务B', group: '硬件组', deadline: '2026-12-15', status: '' },
    ]);

    const result = await service.preview();

    expect(result.suggestions[0].deadline).toBe('2026-12-15');
  });

  it('preview：KR 上限 8 条', async () => {
    mockAdapter.listTasks.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        recordId: `t${i}`,
        title: `任务${i}`,
        group: '硬件组',
        deadline: `2026-11-${String(i + 1).padStart(2, '0')}`,
        status: '',
      })),
    );

    const result = await service.preview();

    expect(result.suggestions[0].basedOnTasks).toHaveLength(8);
    expect(result.suggestions[0].krs.split('\n')).toHaveLength(8);
    expect(result.suggestions[0].krs).toContain('• 任务0（截止 2026-11-01）');
  });

  it('preview：组内任务均无截止时默认今天 +90 天', async () => {
    mockAdapter.listTasks.mockResolvedValue([
      { recordId: 't1', title: '任务A', group: '硬件组', deadline: '', status: '' },
    ]);

    const result = await service.preview();

    expect(result.suggestions[0].deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('apply：每条建议写入收集单（来源=自动规划，状态=待评审）', async () => {
    mockAdapter.listTasks.mockResolvedValue([
      { recordId: 't1', title: '设计图纸', group: '硬件组', deadline: '2026-11-01', status: '' },
      { recordId: 't2', title: '写代码', group: '软件组', deadline: '2026-11-20', status: '' },
    ]);

    const result = await service.apply();

    expect(result.created).toBe(2);
    expect(result.recordIds).toHaveLength(2);
    expect(mockAdapter.createSubmission).toHaveBeenCalledTimes(2);
    for (const call of mockAdapter.createSubmission.mock.calls) {
      expect(call[0]).toMatchObject({
        status: '待评审',
        source: '自动规划',
        submitter: '系统自动规划',
      });
    }
  });
});
