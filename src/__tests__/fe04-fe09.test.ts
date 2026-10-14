/**
 * FE-04 / FE-05 / FE-09 测试：
 *   · update_progress — goal 关键词唯一匹配写回 / 多匹配返回候选 / 清 goals 缓存 / record_id 兼容
 *   · buildDashboard goals 区块 — 逾期识别、按组聚合、未配置时 configured=false
 *   · validate_bitable / GET /api/validate — 权限（MCP_TOKEN 放行、all 仅队长/组长、mine 需用户身份）
 *   · GET /api/todos — 逾期判定、角色过滤、审批 API 降级、5 分钟缓存
 *
 * mock 风格沿用 dr-test-utils.ts：内存 KV + fetch 路由（另加 fields / user_info / approval 端点）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BitableRecord } from "../feishu/bitable";
import { buildDashboard } from "../dashboard";
import { toolUpdateProgress } from "../mcp/implementations";
import { handleTodos } from "../todos";
import { handleValidateQuery, toolValidateBitable } from "../validation/handlers";

const BASE = "appMockBase";
const T = { members: "tblM", tasks: "tblT", inventory: "tblI", finance: "tblF", goals: "tblG" } as const;

const GOAL_FIELDS = [
  { field_name: "目标", ui_type: "Text" },
  { field_name: "完成度", ui_type: "Number" },
  { field_name: "状态", ui_type: "Text" },
  { field_name: "备注", ui_type: "Text" },
];

/** user_token → 飞书用户（validateUserToken 用） */
const USER_TOKENS: Record<string, { open_id: string; name: string }> = {
  "tok-member": { open_id: "ou-member", name: "张三" },
  "tok-captain": { open_id: "ou-captain", name: "张队" },
};

interface Ctx {
  env: Env;
  kv: Map<string, string>;
  tables: Record<string, BitableRecord[]>;
  fetchMock: ReturnType<typeof vi.fn>;
  seed(tableId: string, fields: Record<string, unknown>, recordId?: string): BitableRecord;
}

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function createCtx(opts: { withGoals?: boolean } = {}): Ctx {
  const kv = new Map<string, string>();
  const tables: Record<string, BitableRecord[]> = {};
  let seq = 0;

  const tablesCfg: Record<string, string> = { members: T.members, tasks: T.tasks, inventory: T.inventory, finance: T.finance };
  if (opts.withGoals !== false) tablesCfg.goals = T.goals;
  kv.set("dashboard:config", JSON.stringify({ base: BASE, tables: tablesCfg, updatedAt: new Date().toISOString() }));
  kv.set("session:sid-member", JSON.stringify({ name: "张三", open_id: "ou-member", createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3 }));
  kv.set("session:sid-captain", JSON.stringify({ name: "张队", open_id: "ou-captain", createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3 }));

  const ctx: Ctx = {
    kv,
    tables,
    fetchMock: undefined as unknown as Ctx["fetchMock"],
    env: undefined as unknown as Env,
    seed(tableId, fields, recordId) {
      const rec: BitableRecord = { record_id: recordId ?? `rec-${++seq}`, fields };
      (tables[tableId] ??= []).push(rec);
      return rec;
    },
  };

  ctx.fetchMock = vi.fn(async (input: unknown, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.includes("/auth/v3/tenant_access_token/internal")) {
      return jsonResp({ code: 0, tenant_access_token: "mock-token", expire: 7200 });
    }
    if (url.includes("/authen/v1/user_info")) {
      const token = String(init?.headers?.authorization ?? "").replace(/^Bearer\s+/i, "");
      const u = USER_TOKENS[token];
      return u ? jsonResp({ code: 0, data: u }) : jsonResp({ code: 99991663, msg: "invalid user access token" });
    }
    if (url.includes("/approval/v4/")) {
      // 审批 API scope 未开通：模拟权限不足，FE-09 应静默降级
      return jsonResp({ code: 99991672, msg: "approval scope not granted" });
    }
    const mf = url.match(/\/bitable\/v1\/apps\/([^/]+)\/tables\/([^/?]+)\/fields/);
    if (mf) return jsonResp({ code: 0, data: { items: GOAL_FIELDS, has_more: false } });
    const m = url.match(/\/bitable\/v1\/apps\/([^/]+)\/tables\/([^/?]+)\/records(?:\/([^/?]+))?/);
    if (!m) return jsonResp({ code: 404, msg: `not mocked: ${url}` });
    const [, , tableId, recordId] = m;
    const method = (init?.method ?? "GET").toUpperCase();
    const items = (tables[tableId] ??= []);
    if (method === "GET") return jsonResp({ code: 0, data: { items, has_more: false } });
    if (method === "PUT" && recordId) {
      const rec = items.find((r) => r.record_id === recordId);
      if (!rec) return jsonResp({ code: 1254045, msg: "record not found" });
      Object.assign(rec.fields, JSON.parse(init!.body!).fields);
      return jsonResp({ code: 0, data: { record: rec } });
    }
    return jsonResp({ code: 400, msg: `unsupported ${method}` });
  });
  vi.stubGlobal("fetch", ctx.fetchMock);

  ctx.env = {
    REGISTRY: {
      get: vi.fn(async (key: string, type?: string) => {
        if (key === "feishu:tenant_access_token") return { token: "mock-token", expireAt: Date.now() + 3600e3 };
        const v = kv.get(key);
        return v == null ? null : type === "json" ? JSON.parse(v) : v;
      }),
      put: vi.fn(async (key: string, value: string) => { kv.set(key, value); }),
      delete: vi.fn(async (key: string) => { kv.delete(key); }),
    },
    FEISHU_APP_ID: "mock-app-id",
    FEISHU_APP_SECRET: "mock-app-secret",
  } as unknown as Env;
  return ctx;
}

function seedMembers(ctx: Ctx) {
  ctx.seed(T.members, { 姓名: "张三", 飞书ID: "ou-member", 权限角色: "队员", 组别: "机械组" });
  ctx.seed(T.members, { 姓名: "张队", 飞书ID: "ou-captain", 权限角色: "队长", 组别: "管理组" });
  ctx.seed(T.members, { 姓名: "李四", 飞书ID: "ou-other", 权限角色: "队员", 组别: "电控组" });
}

const DAY = 86400000;
const daysFromNow = (n: number) => Date.now() + n * DAY;

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("update_progress（FE-04）", () => {
  it("goal 关键词唯一匹配：写回完成度 + 备注，并清 goals 看板缓存", async () => {
    const ctx = createCtx();
    ctx.seed(T.goals, { 目标: "中期检查", 完成度: 30, 状态: "进行中" }, "rec-g1");
    ctx.seed(T.goals, { 目标: "报名截止", 完成度: 100, 状态: "已完成" }, "rec-g2");
    ctx.kv.set("dashboard:cache:goals", JSON.stringify({ data: [], cachedAt: Date.now() }));

    const res = await toolUpdateProgress({ goal: "中期", progress: 60, note: "场地已约" }, ctx.env, true);
    const text = res.content[0].text;
    expect(text).toContain("✅");
    expect(text).toContain("record_id=rec-g1");
    expect(ctx.tables[T.goals][0].fields["完成度"]).toBe(60);
    expect(ctx.tables[T.goals][0].fields["备注"]).toBe("场地已约");
    expect(ctx.kv.has("dashboard:cache:goals")).toBe(false);
    // 未匹配的记录不受影响
    expect(ctx.tables[T.goals][1].fields["完成度"]).toBe(100);
  });

  it("goal 多匹配：返回候选列表且不写入", async () => {
    const ctx = createCtx();
    ctx.seed(T.goals, { 目标: "机械组中期检查", 完成度: 30 }, "rec-g1");
    ctx.seed(T.goals, { 目标: "电控组中期检查", 完成度: 40 }, "rec-g2");
    const res = await toolUpdateProgress({ goal: "中期检查", progress: 60 }, ctx.env, true);
    expect(res.content[0].text).toContain("匹配到 2 条");
    expect(res.content[0].text).toContain("rec-g1");
    expect(res.content[0].text).toContain("rec-g2");
    expect(ctx.tables[T.goals][0].fields["完成度"]).toBe(30);
  });

  it("goal 无匹配时报错；progress 越界报错", async () => {
    const ctx = createCtx();
    ctx.seed(T.goals, { 目标: "中期检查", 完成度: 30 }, "rec-g1");
    await expect(toolUpdateProgress({ goal: "不存在", progress: 60 }, ctx.env, true)).rejects.toThrow("未找到匹配");
    await expect(toolUpdateProgress({ goal: "中期", progress: 120 }, ctx.env, true)).rejects.toThrow("0-100");
    await expect(toolUpdateProgress({ progress: 60 }, ctx.env, true)).rejects.toThrow("至少填一个");
  });

  it("record_id 路径保持兼容；无 MCP_TOKEN 且无 user_token 时拒绝", async () => {
    const ctx = createCtx();
    ctx.seed(T.goals, { 目标: "中期检查", 完成度: 30 }, "rec-g1");
    const res = await toolUpdateProgress({ record_id: "rec-g1", progress: 80, status: "进行中" }, ctx.env, true);
    expect(res.content[0].text).toContain("✅");
    expect(ctx.tables[T.goals][0].fields["完成度"]).toBe(80);
    await expect(toolUpdateProgress({ record_id: "rec-g1", progress: 10 }, ctx.env, false)).rejects.toThrow("user_token");
  });
});

describe("buildDashboard goals 区块（FE-04）", () => {
  it("未配置 goals 表时区块 configured=false", async () => {
    const ctx = createCtx({ withGoals: false });
    seedMembers(ctx);
    const d = (await buildDashboard(ctx.env, new Request("http://x/api/dashboard"))) as Record<string, any>;
    expect(d.goals.configured).toBe(false);
  });

  it("识别逾期未达标、按负责组聚合平均完成度", async () => {
    const ctx = createCtx();
    seedMembers(ctx);
    ctx.seed(T.goals, { 目标: "中期检查", 负责组: "机械组", 截止: daysFromNow(-1), 完成度: 50, 状态: "进行中" }, "rec-g1");
    ctx.seed(T.goals, { 目标: "报名", 负责组: "运营组", 截止: daysFromNow(-10), 完成度: 100, 状态: "已完成" }, "rec-g2");
    const d = (await buildDashboard(ctx.env, new Request("http://x/api/dashboard"))) as Record<string, any>;
    expect(d.goals.configured).toBe(true);
    expect(d.goals.total).toBe(2);
    const g1 = d.goals.items.find((it: any) => it.title === "中期检查");
    const g2 = d.goals.items.find((it: any) => it.title === "报名");
    expect(g1.overdue).toBe(true);
    expect(g1.link).toBe(`https://feishu.cn/base/${BASE}?table=${T.goals}&record=rec-g1`);
    expect(g2.done).toBe(true);
    expect(g2.overdue).toBe(false);
    expect(d.goals.overdueCount).toBe(1);
    const mech = d.goals.byGroup.find((b: any) => b.name === "机械组");
    expect(mech.avg).toBe(50);
  });
});

describe("validate_bitable / GET /api/validate 权限（FE-05）", () => {
  it("MCP_TOKEN 管理通道放行 scope=all", async () => {
    const ctx = createCtx();
    seedMembers(ctx);
    const res = await toolValidateBitable({ scope: "all" }, ctx.env, true);
    expect(res.content[0].text).toContain("全量校验完成");
  });

  it("MCP_TOKEN 通道下 scope=mine 拒绝（无法确定「我」）；无 token 无 user_token 拒绝", async () => {
    const ctx = createCtx();
    seedMembers(ctx);
    await expect(toolValidateBitable({ scope: "mine" }, ctx.env, true)).rejects.toThrow("user_token");
    await expect(toolValidateBitable({ scope: "mine" }, ctx.env, false)).rejects.toThrow("user_token");
  });

  it("user_token 队员 scope=all 拒绝，队长放行；队员 scope=mine 放行", async () => {
    const ctx = createCtx();
    seedMembers(ctx);
    await expect(toolValidateBitable({ scope: "all", user_token: "tok-member" }, ctx.env, false)).rejects.toThrow("队长/组长");
    const ok = await toolValidateBitable({ scope: "all", user_token: "tok-captain" }, ctx.env, false);
    expect(ok.content[0].text).toContain("全量校验完成");
    const mine = await toolValidateBitable({ scope: "mine", user_token: "tok-member" }, ctx.env, false);
    expect(mine.content[0].text).toContain("校验完成");
  });

  it("GET /api/validate：未登录 401；队员 scope=all 403；scope=mine 200", async () => {
    const ctx = createCtx();
    seedMembers(ctx);
    const anon = await handleValidateQuery(new Request("http://x/api/validate?scope=mine"), ctx.env);
    expect(anon.status).toBe(401);
    const forbidden = await handleValidateQuery(
      new Request("http://x/api/validate?scope=all", { headers: { cookie: "nec_session=sid-member" } }),
      ctx.env,
    );
    expect(forbidden.status).toBe(403);
    const mine = await handleValidateQuery(
      new Request("http://x/api/validate?scope=mine", { headers: { cookie: "nec_session=sid-member" } }),
      ctx.env,
    );
    expect(mine.status).toBe(200);
    const body = (await mine.json()) as Record<string, unknown>;
    expect(body.scope).toBe("mine");
  });
});

describe("GET /api/todos（FE-09）", () => {
  function seedTodos(ctx: Ctx) {
    seedMembers(ctx);
    ctx.seed(T.tasks, { 任务: "修小车底盘", 负责人: "张三", 状态: "进行中", 截止: daysFromNow(-2) }, "rec-t1");
    ctx.seed(T.tasks, { 任务: "写周报", 负责人: "张三", 状态: "已完成", 截止: daysFromNow(-3) }, "rec-t2");
    ctx.seed(T.tasks, { 任务: "买螺丝", 负责人: "李四", 状态: "进行中", 截止: daysFromNow(-1) }, "rec-t3");
    ctx.seed(T.tasks, { 任务: "明天的活", 负责人: "张三", 状态: "进行中", 截止: daysFromNow(1) }, "rec-t4");
    ctx.seed(T.finance, { 事项: "元器件采购", 金额: 100, 申请人: "张三", 状态: "待确认" }, "rec-f1");
    ctx.seed(T.finance, { 事项: "打印海报", 金额: 50, 申请人: "李四", 状态: "进行中" }, "rec-f2");
    ctx.seed(T.finance, { 事项: "老报销", 金额: 30, 申请人: "张三", 状态: "已完成" }, "rec-f3");
  }

  it("未登录 401", async () => {
    const ctx = createCtx();
    const res = await handleTodos(new Request("http://x/api/todos"), ctx.env);
    expect(res.status).toBe(401);
  });

  it("队员：逾期任务只含自己的未完成项；报销只见自己的待处理；审批 API 降级不报错", async () => {
    const ctx = createCtx();
    seedTodos(ctx);
    const res = await handleTodos(new Request("http://x/api/todos", { headers: { cookie: "nec_session=sid-member" } }), ctx.env);
    expect(res.status).toBe(200);
    const d = (await res.json()) as Record<string, any>;
    expect(d.tasks.map((t: any) => t.title)).toEqual(["修小车底盘"]);
    expect(d.tasks[0].daysOverdue).toBeGreaterThanOrEqual(1);
    expect(d.tasks[0].link).toBe(`https://feishu.cn/base/${BASE}?table=${T.tasks}&record=rec-t1`);
    expect(d.finance.scope).toBe("mine");
    expect(d.finance.count).toBe(1);
    expect(d.finance.items[0].name).toBe("元器件采购");
    expect(d.approvals.count).toBe(0);
    expect(d.warnings.some((w: string) => w.includes("审批"))).toBe(true);
    expect(d.total).toBe(2);
  });

  it("队长：报销待处理见全部（scope=all）", async () => {
    const ctx = createCtx();
    seedTodos(ctx);
    const res = await handleTodos(new Request("http://x/api/todos", { headers: { cookie: "nec_session=sid-captain" } }), ctx.env);
    const d = (await res.json()) as Record<string, any>;
    expect(d.finance.scope).toBe("all");
    expect(d.finance.count).toBe(2);
    expect(d.tasks).toEqual([]); // 张队名下无任务
  });

  it("5 分钟缓存：第二次请求命中缓存，不再拉飞书", async () => {
    const ctx = createCtx();
    seedTodos(ctx);
    const req = () => new Request("http://x/api/todos", { headers: { cookie: "nec_session=sid-member" } });
    await handleTodos(req(), ctx.env);
    const callsAfterFirst = ctx.fetchMock.mock.calls.length;
    const res = await handleTodos(req(), ctx.env);
    const d = (await res.json()) as Record<string, any>;
    expect(d.cached).toBe(true);
    expect(ctx.fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });
});
