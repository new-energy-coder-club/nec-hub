import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CollectService, UserInputError } from '../collect.service';
import { handleSeasonGoals } from '../index';
import { PlanService } from '../plan.service';
import { SeasonGoalsConfig } from '../types';
import { mockGetRecordResponse, mockSearchResponse } from '../../__tests__/bitable-search-mock';

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

/**
 * 路由级权限测试：approve / reject / plan POST 需 队长/组长。
 * 内存 KV + 内存多维表格 mock（含字段元数据），同 drawing-review dr-test-utils 思路。
 */
describe('Season Goals 路由权限（approve/reject/plan POST 需 队长/组长）', () => {
  const SG_TABLES = { goals: 'tblGoals', collect: 'tblCollect', tasks: 'tblTasks' };

  interface SgRecord { record_id: string; fields: Record<string, unknown> }
  interface SgMock { env: Env; tables: Record<string, SgRecord[]> }

  const FIELD_METAS = [
    { field_name: '目标', ui_type: 'Text' },
    { field_name: '关键结果', ui_type: 'Text' },
    { field_name: '负责组', ui_type: 'Text' },
    { field_name: '截止日期', ui_type: 'DateTime' },
    { field_name: '完成度', ui_type: 'Number' },
    { field_name: '状态', ui_type: 'SingleSelect' },
    { field_name: '来源', ui_type: 'SingleSelect' },
    { field_name: '备注', ui_type: 'Text' },
    { field_name: '提交人', ui_type: 'Text' },
    { field_name: '任务', ui_type: 'Text' },
  ];

  function createSgMock(session: { sid: string; openId: string; name: string }, role?: string): SgMock {
    const kv = new Map<string, string>();
    const tables: Record<string, SgRecord[]> = {};
    let seq = 0;

    kv.set('season-goals:config', JSON.stringify({ base: 'appMockBase', tables: { ...SG_TABLES }, updatedAt: '' }));
    kv.set(`session:${session.sid}`, JSON.stringify({
      name: session.name,
      open_id: session.openId,
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + 3600e3,
    }));
    if (role !== undefined) {
      kv.set('dashboard:config', JSON.stringify({ base: 'appMockBase', tables: { members: 'tblMembers' }, updatedAt: '' }));
      (tables['tblMembers'] ??= []).push({ record_id: 'rec-member-1', fields: { open_id: session.openId, 姓名: session.name, 权限角色: role } });
    }

    const jsonResp = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = String((input as { url?: string })?.url ?? input);
      if (url.includes('/auth/v3/tenant_access_token/internal')) {
        return jsonResp({ code: 0, tenant_access_token: 'mock-token', expire: 7200 });
      }
      if (/\/bitable\/v1\/apps\/[^/]+\/tables\/[^/?]+\/fields/.test(url)) {
        return jsonResp({ code: 0, data: { items: FIELD_METAS, has_more: false } });
      }
      const m = url.match(/\/bitable\/v1\/apps\/([^/]+)\/tables\/([^/?]+)\/records(?:\/([^/?]+))?/);
      if (!m) return jsonResp({ code: 404, msg: `not mocked: ${url}` });
      const [, , tableId, recordId] = m;
      const method = (init?.method ?? 'GET').toUpperCase();
      const items = (tables[tableId] ??= []);
      if (method === 'POST' && recordId === 'search') return mockSearchResponse(items, init?.body ?? '{}');
      if (method === 'GET' && recordId) return mockGetRecordResponse(items, recordId);
      if (method === 'GET') return jsonResp({ code: 0, data: { items, has_more: false } });
      if (method === 'POST' && !recordId) {
        const rec: SgRecord = { record_id: `rec-${++seq}`, fields: JSON.parse(init!.body!).fields };
        items.push(rec);
        return jsonResp({ code: 0, data: { record: rec } });
      }
      if (method === 'PUT' && recordId) {
        const rec = items.find((r) => r.record_id === recordId);
        if (!rec) return jsonResp({ code: 1254045, msg: 'record not found' });
        Object.assign(rec.fields, JSON.parse(init!.body!).fields);
        return jsonResp({ code: 0, data: { record: rec } });
      }
      return jsonResp({ code: 400, msg: `unsupported ${method}` });
    }));

    const env = {
      REGISTRY: {
        get: vi.fn(async (key: string, type?: string) => {
          if (key === 'feishu:tenant_access_token') return { token: 'mock-token', expireAt: Date.now() + 3600e3 };
          const v = kv.get(key);
          if (v == null) return null;
          return type === 'json' ? JSON.parse(v) : v;
        }),
        put: vi.fn(async (key: string, value: string) => { kv.set(key, value); }),
        delete: vi.fn(async (key: string) => { kv.delete(key); }),
      },
      FEISHU_APP_ID: 'mock-app-id',
      FEISHU_APP_SECRET: 'mock-app-secret',
    } as unknown as Env;

    return { env, tables };
  }

  function seedPendingSubmission(mock: SgMock) {
    (mock.tables[SG_TABLES.collect] ??= []).push({
      record_id: 'rec-c1',
      fields: { 目标: '完成底盘迭代', 关键结果: 'KR1 通过评审', 负责组: '硬件组', 截止日期: '2026-12-31', 状态: '待评审', 来源: '手工', 提交人: '张三' },
    });
  }

  function post(pathname: string, body: unknown, sid: string) {
    return new Request(`http://localhost${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `nec_session=${sid}` },
      body: JSON.stringify(body),
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('普通队员 approve 被 403 拒绝，且收集单未被修改', async () => {
    const mock = createSgMock({ sid: 'sid-member', openId: 'ou-member', name: '测试用户' }, '队员');
    seedPendingSubmission(mock);

    const res = await handleSeasonGoals(post('/api/season-goals/collect/approve', { recordId: 'rec-c1' }, 'sid-member'), mock.env, '/api/season-goals/collect/approve');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    expect(mock.tables[SG_TABLES.collect][0].fields['状态']).toBe('待评审');
    expect(mock.tables[SG_TABLES.goals] ?? []).toHaveLength(0);
  });

  it('普通队员 reject 被 403 拒绝', async () => {
    const mock = createSgMock({ sid: 'sid-member', openId: 'ou-member', name: '测试用户' }, '队员');
    seedPendingSubmission(mock);

    const res = await handleSeasonGoals(post('/api/season-goals/collect/reject', { recordId: 'rec-c1' }, 'sid-member'), mock.env, '/api/season-goals/collect/reject');
    expect(res!.status).toBe(403);
    expect(mock.tables[SG_TABLES.collect][0].fields['状态']).toBe('待评审');
  });

  it('名单表未配置时 approve 同样 403（不做降级）', async () => {
    const mock = createSgMock({ sid: 'sid-any', openId: 'ou-any', name: '任意用户' });
    seedPendingSubmission(mock);

    const res = await handleSeasonGoals(post('/api/season-goals/collect/approve', { recordId: 'rec-c1' }, 'sid-any'), mock.env, '/api/season-goals/collect/approve');
    expect(res!.status).toBe(403);
    expect(mock.tables[SG_TABLES.collect][0].fields['状态']).toBe('待评审');
  });

  it('队长 approve 成功：写目标表并把收集单标记为已采纳', async () => {
    const mock = createSgMock({ sid: 'sid-lead', openId: 'ou-lead', name: '队长用户' }, '队长');
    seedPendingSubmission(mock);

    const res = await handleSeasonGoals(post('/api/season-goals/collect/approve', { recordId: 'rec-c1' }, 'sid-lead'), mock.env, '/api/season-goals/collect/approve');
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { goalRecordId: string };
    expect(body.goalRecordId).toBeTruthy();
    expect(mock.tables[SG_TABLES.collect][0].fields['状态']).toBe('已采纳');
    expect(mock.tables[SG_TABLES.goals]).toHaveLength(1);
    expect(mock.tables[SG_TABLES.goals][0].fields['状态']).toBe('进行中');
  });

  it('普通队员 plan POST 被 403 拒绝，不写收集单', async () => {
    const mock = createSgMock({ sid: 'sid-member', openId: 'ou-member', name: '测试用户' }, '队员');
    (mock.tables[SG_TABLES.tasks] ??= []).push({
      record_id: 'rec-t1',
      fields: { 任务: '设计图纸', 负责组: '硬件组', 截止日期: '2026-11-01', 状态: '进行中' },
    });

    const res = await handleSeasonGoals(post('/api/season-goals/plan', {}, 'sid-member'), mock.env, '/api/season-goals/plan');
    expect(res!.status).toBe(403);
    expect(mock.tables[SG_TABLES.collect] ?? []).toHaveLength(0);
  });

  it('组长 plan POST 成功：按任务生成收集单草稿', async () => {
    const mock = createSgMock({ sid: 'sid-lead', openId: 'ou-lead', name: '组长用户' }, '组长');
    (mock.tables[SG_TABLES.tasks] ??= []).push({
      record_id: 'rec-t1',
      fields: { 任务: '设计图纸', 负责组: '硬件组', 截止日期: '2026-11-01', 状态: '进行中' },
    });

    const res = await handleSeasonGoals(post('/api/season-goals/plan', {}, 'sid-lead'), mock.env, '/api/season-goals/plan');
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { created: number };
    expect(body.created).toBe(1);
    expect(mock.tables[SG_TABLES.collect]).toHaveLength(1);
    expect(mock.tables[SG_TABLES.collect][0].fields['来源']).toBe('自动规划');
    expect(mock.tables[SG_TABLES.collect][0].fields['状态']).toBe('待评审');
  });
});
