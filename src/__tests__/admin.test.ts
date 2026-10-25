/**
 * 管理后台 API 测试（/api/admin/*）——两个子集合并：
 * A. 门户「管理」Tab：GET /api/admin/overview · GET /api/admin/sessions · POST /api/admin/sessions/revoke
 *    POST /api/admin/config/<dashboard|flows> · POST /api/auth/logout-all
 * B. Cloudflare 运维 + 本地账号：/api/admin/cf/*（DNS/缓存/探测）· /api/admin/accounts*
 * mock 风格沿用 dr-test-utils.ts / role.test.ts：内存 KV（支持 list 分页）+ fetch 路由（飞书 / Cloudflare / 探测目标）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BitableRecord } from "../feishu/bitable";
import {
  handleAdmin,
  handleAdminConfig,
  handleAdminOverview,
  handleAdminRevokeSessions,
  handleAdminSessions,
} from "../admin";
import { handleLogoutAll } from "../auth/handlers";
import { KV_KEYS } from "../shared/kv-keys";

const MEMBERS_TABLE = "tblMembers";

interface Ctx {
  env: Env;
  kv: Map<string, string>;
  members: BitableRecord[];
  cfCalls: Array<{ method: string; url: string; body?: Record<string, unknown> }>;
  probeResp: Response | null;
}

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function makeCtx(opts: { dashboard?: boolean; withCf?: boolean; withSessions?: boolean } = {}): Ctx {
  const kv = new Map<string, string>();
  const members: BitableRecord[] = [];
  const cfCalls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
  // B 区（CF/账号）门禁用会话与角色缓存：open_id 命中 CONFIG_ADMIN 的角色名单。
  // 仅在 withCf/withSessions 时注入——A 区（overview/sessions）的计数断言要求会话列表干净
  if (opts.withCf || opts.withSessions) {
    kv.set(
      "session:sid-a",
      JSON.stringify({ name: "管理员甲", open_id: "ou-admin", createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3 }),
    );
    kv.set(
      "session:sid-b",
      JSON.stringify({ name: "队员乙", open_id: "ou-member", createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3 }),
    );
    kv.set(
      "session:sid-c",
      JSON.stringify({ name: "维护者丙", open_id: "ou-maintainer", createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3 }),
    );
    kv.set(
      "session:sid-root",
      JSON.stringify({ name: "兜底丁", open_id: "ou-root", createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3 }),
    );
    kv.set("role:ou-admin", JSON.stringify({ role: "队长", group: "电控", matched: true }));
    kv.set("role:ou-member", JSON.stringify({ role: "队员", group: "电控", matched: true }));
    kv.set("role:ou-maintainer", JSON.stringify({ role: "维护者", group: "指导", matched: true }));
  }
  if (opts.dashboard) {
    kv.set(
      KV_KEYS.dashboardConfig,
      JSON.stringify({ base: "appMockBase", tables: { members: MEMBERS_TABLE }, updatedAt: new Date().toISOString() }),
    );
  }
  const ctx: Ctx = { env: {} as Env, kv, members, cfCalls, probeResp: null };
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.includes("api.cloudflare.com")) {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      cfCalls.push({ method: init?.method ?? "GET", url, body });
      if (url.includes("/purge_cache")) {
        // 模拟 Zone.DNS-only token：purge 权限不足
        return jsonResp({ success: false, errors: [{ code: 10000, message: "Authentication error" }], result: null }, 403);
      }
      if ((init?.method ?? "GET") === "POST") {
        return jsonResp({ success: true, errors: [], result: { id: "rec-1", name: body?.name, type: body?.type, content: body?.content, proxied: body?.proxied } });
      }
      if (init?.method === "DELETE") return jsonResp({ success: true, errors: [], result: { id: "rec-1" } });
      return jsonResp({ success: true, errors: [], result: [{ id: "rec-9", name: "mes.newenergycoder.club", type: "AAAA", content: "100::", proxied: true }] });
    }
    if (url.includes("example.com")) return ctx.probeResp ?? jsonResp({});
    if (url.includes("/auth/v3/tenant_access_token/internal")) {
      return jsonResp({ code: 0, tenant_access_token: "mock-token", expire: 7200 });
    }
    if (url.includes(`/tables/${MEMBERS_TABLE}/records`)) {
      return jsonResp({ code: 0, data: { items: members, has_more: false } });
    }
    return jsonResp({ code: 404, msg: `not mocked: ${url}` });
  });
  vi.stubGlobal("fetch", fetchMock);
  const env = {
    REGISTRY: {
      get: vi.fn(async (key: string, type?: string) => {
        if (key === KV_KEYS.feishuTenantAccessToken) return { token: "mock-token", expireAt: Date.now() + 3600e3 };
        const v = kv.get(key);
        if (v == null) return null;
        return type === "json" ? JSON.parse(v) : v;
      }),
      put: vi.fn(async (key: string, value: string) => void kv.set(key, value)),
      delete: vi.fn(async (key: string) => void kv.delete(key)),
      // 内存版 KV list：按 prefix 过滤 + 字典序排序 + limit/cursor 分页（对齐云端语义）
      list: vi.fn(async (opts?: { prefix?: string; limit?: number; cursor?: string }) => {
        const prefix = opts?.prefix ?? "";
        const limit = opts?.limit ?? 1000;
        const all = [...kv.keys()].filter((k) => k.startsWith(prefix)).sort();
        const start = opts?.cursor ? Number(opts.cursor) : 0;
        const slice = all.slice(start, start + limit);
        const complete = start + limit >= all.length;
        return { keys: slice.map((name) => ({ name })), list_complete: complete, cursor: complete ? "" : String(start + limit) };
      }),
    },
    FEISHU_APP_ID: "cli_test123456",
    FEISHU_APP_SECRET: "mock-app-secret",
    MCP_TOKEN: "mock-mcp-token",
    HUB_NAME: "NEC 团队 AI 中台",
    DOMAIN_ZONE: "newenergycoder.club",
    ...(opts.withCf ? { CF_API_TOKEN: "cf-token", CF_ZONE_ID: "zone-1" } : {}),
  } as unknown as Env;
  ctx.env = env;
  return ctx;
}

function member(name: string, openId: string | null, role = "队员", group = "机械"): BitableRecord {
  return { record_id: `rec-${name}`, fields: { 姓名: name, 权限角色: role, 组别: group, 飞书ID: openId } };
}

function seedSession(kv: Map<string, string>, sid: string, openId: string, name: string) {
  kv.set(
    KV_KEYS.session(sid),
    JSON.stringify({ name, open_id: openId, createdAt: new Date().toISOString(), expiresAt: Date.now() + 3600e3 }),
  );
}

function authedRequest(path: string, sid: string, method = "GET"): Request {
  return new Request(`https://hub.test${path}`, {
    method,
    headers: { cookie: `nec_session=${sid}` },
  });
}

/** B 区（CF/账号）用：支持 JSON body 的请求构造 */
function cfReq(path: string, opts: { method?: string; sid?: string; body?: unknown } = {}): Request {
  return new Request(`https://hub.newenergycoder.club${path}`, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.sid ? { cookie: `nec_session=${opts.sid}` } : {}),
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("GET /api/admin/overview", () => {
  it("未登录 → 401", async () => {
    const { env } = makeCtx({ dashboard: true });
    const res = await handleAdminOverview(new Request("https://hub.test/api/admin/overview"), env);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toContain("请先登录");
  });

  it("登录但角色为「队员」→ 403（带当前角色）", async () => {
    const ctx = makeCtx({ dashboard: true });
    ctx.members.push(member("李四", "ou_lisi", "队员"));
    seedSession(ctx.kv, "sid-lisi", "ou_lisi", "李四");
    const res = await handleAdminOverview(authedRequest("/api/admin/overview", "sid-lisi"), ctx.env);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("权限不足");
    expect(body.error).toContain("当前角色：队员");
  });

  it("角色为「队长」→ 200：appId 掩码、会话计数、成员聚合正确", async () => {
    const ctx = makeCtx({ dashboard: true });
    ctx.members.push(
      member("张三", "ou_zhangsan", "队长", "运营"),
      member("王五", null, "队员"),
      member("赵六", "ou_zhaoliu", "队长"),
    );
    seedSession(ctx.kv, "sid-zs", "ou_zhangsan", "张三");
    seedSession(ctx.kv, "sid-zl", "ou_zhaoliu", "赵六");
    ctx.kv.set(KV_KEYS.flowsConfig, "{}"); // 干扰项：计数不得混入非 session 前缀
    const res = await handleAdminOverview(authedRequest("/api/admin/overview", "sid-zs"), ctx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.tenant.hubName).toBe("NEC 团队 AI 中台");
    expect(body.tenant.feishuAppId).toBe("cli_te***");
    expect(JSON.stringify(body)).not.toContain("cli_test123456");
    expect(JSON.stringify(body)).not.toContain("mock-app-secret");
    expect(JSON.stringify(body)).not.toContain("mock-mcp-token");
    expect(body.tenant.loginEnabled).toBe(true);
    expect(body.tenant.mcpEnabled).toBe(true);
    expect(body.sessions.active).toBe(2);
    expect(body.members).toEqual({ total: 3, withOpenId: 2, missingOpenId: 1, roleCounts: { 队长: 2, 队员: 1 } });
    expect(body.modules.dashboard).toEqual({ configured: true, tables: ["members"] });
    expect(body.modules.validateRules).toBe("default");
  });

  it("dashboard:config 未配置 → members 为 null 且 dashboard.configured=false", async () => {
    const ctx = makeCtx({ dashboard: false });
    // 名单未配置时角色解析为「队员」：直接种角色缓存模拟队长身份
    ctx.kv.set(KV_KEYS.role("ou_boss"), JSON.stringify({ role: "队长", group: "运营", matched: true }));
    seedSession(ctx.kv, "sid-boss", "ou_boss", "老板");
    const res = await handleAdminOverview(authedRequest("/api/admin/overview", "sid-boss"), ctx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.members).toBeNull();
    expect(body.modules.dashboard.configured).toBe(false);
    expect(body.modules.dashboard.tables).toEqual([]);
  });

  it("flows:config 部分配置时布尔正确；validate:rules 存在时标记 custom", async () => {
    const ctx = makeCtx({ dashboard: false });
    ctx.kv.set(KV_KEYS.role("ou_boss"), JSON.stringify({ role: "管理员", group: "", matched: true }));
    seedSession(ctx.kv, "sid-boss", "ou_boss", "管理员甲");
    ctx.kv.set(
      KV_KEYS.flowsConfig,
      JSON.stringify({ reimburse: { tableId: "tblR", base: "appR" }, drawing: { tableId: "tblD" } }),
    );
    ctx.kv.set(KV_KEYS.validateRules, JSON.stringify([{ id: "r1" }]));
    const res = await handleAdminOverview(authedRequest("/api/admin/overview", "sid-boss"), ctx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.modules.flows).toEqual({ reimburse: true, drawing: false, hardware: false, compliance: false });
    expect(body.modules.validateRules).toBe("custom");
  });
});

describe("POST /api/auth/logout-all", () => {
  it("未登录 → 401", async () => {
    const { env } = makeCtx();
    const res = await handleLogoutAll(new Request("https://hub.test/api/auth/logout-all", { method: "POST" }), env);
    expect(res.status).toBe(401);
  });

  it("删除本人全部会话、保留他人，revoked=2 且清 Cookie", async () => {
    const ctx = makeCtx();
    seedSession(ctx.kv, "sid-a", "ou_me", "我");
    seedSession(ctx.kv, "sid-b", "ou_me", "我");
    seedSession(ctx.kv, "sid-c", "ou_other", "别人");
    const res = await handleLogoutAll(authedRequest("/api/auth/logout-all", "sid-a", "POST"), ctx.env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean; revoked: number }).revoked).toBe(2);
    expect(ctx.kv.has(KV_KEYS.session("sid-a"))).toBe(false);
    expect(ctx.kv.has(KV_KEYS.session("sid-b"))).toBe(false);
    expect(ctx.kv.has(KV_KEYS.session("sid-c"))).toBe(true);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("nec_session=");
    expect(cookie).toContain("Max-Age=0");
  });

  it("非 POST → 405", async () => {
    const { env } = makeCtx();
    const res = await handleLogoutAll(new Request("https://hub.test/api/auth/logout-all"), env);
    expect(res.status).toBe(405);
  });
});

/** 种一条指定时间的会话（聚合排序测试用） */
function seedSessionAt(kv: Map<string, string>, sid: string, openId: string, name: string, createdAt: string, expiresAt: number) {
  kv.set(KV_KEYS.session(sid), JSON.stringify({ name, open_id: openId, createdAt, expiresAt }));
}

/** 种管理员身份（角色缓存 + 会话），返回带 Cookie 的请求构造器 */
function seedAdmin(ctx: Ctx, sid = "sid-admin", openId = "ou_admin", name = "管理员甲") {
  ctx.kv.set(`role:${openId}`, JSON.stringify({ role: "队长", group: "运营", matched: true }));
  seedSession(ctx.kv, sid, openId, name);
  return (path: string, init?: { method?: string; body?: unknown }) =>
    new Request(`https://hub.test${path}`, {
      method: init?.method ?? "GET",
      headers: { cookie: `nec_session=${sid}`, ...(init?.body ? { "content-type": "application/json" } : {}) },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    });
}

describe("GET /api/admin/sessions", () => {
  it("未登录 → 401；登录队员 → 403", async () => {
    const { env } = makeCtx();
    const res = await handleAdminSessions(new Request("https://hub.test/api/admin/sessions"), env);
    expect(res.status).toBe(401);

    const ctx = makeCtx({ dashboard: true });
    ctx.members.push(member("李四", "ou_lisi", "队员"));
    seedSession(ctx.kv, "sid-lisi", "ou_lisi", "李四");
    const res2 = await handleAdminSessions(authedRequest("/api/admin/sessions", "sid-lisi"), ctx.env);
    expect(res2.status).toBe(403);
    expect(((await res2.json()) as { error: string }).error).toContain("当前角色：队员");
  });

  it("按 open_id 分组聚合、latestExpiresAt 倒序、坏记录跳过", async () => {
    const ctx = makeCtx();
    const req = seedAdmin(ctx);
    const now = Date.now();
    // 管理员自己的会话由 seedAdmin 种入（resolveSession 滑动续期后 expiresAt ≈ now+7d）；
    // 以下种子会话到期时间设在 7 天之外，保证排序断言稳定
    seedSessionAt(ctx.kv, "sid-a1", "ou_a", "用户A", "2026-10-20T08:00:00.000Z", now + 9 * 86400e3);
    seedSessionAt(ctx.kv, "sid-a2", "ou_a", "用户A", "2026-10-23T09:00:00.000Z", now + 9 * 86400e3);
    seedSessionAt(ctx.kv, "sid-b1", "ou_b", "用户B", "2026-10-22T10:00:00.000Z", now + 10 * 86400e3);
    ctx.kv.set(KV_KEYS.session("sid-bad"), "{not-json"); // 坏记录
    const res = await handleAdminSessions(req("/api/admin/sessions"), ctx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: Array<any>; total: number };
    expect(body.total).toBe(4); // admin 1 + A×2 + B×1
    expect(body.users.map((u) => u.open_id)).toEqual(["ou_b", "ou_a", "ou_admin"]); // latestExpiresAt 倒序
    const a = body.users.find((u) => u.open_id === "ou_a");
    expect(a.sessions).toBe(2);
    expect(a.latestCreatedAt).toBe("2026-10-23T09:00:00.000Z");
    expect(a.latestExpiresAt).toBe(now + 9 * 86400e3);
    expect(a.name).toBe("用户A");
  });
});

describe("POST /api/admin/sessions/revoke", () => {
  it("未登录 → 401；登录队员 → 403", async () => {
    const { env } = makeCtx();
    const res = await handleAdminRevokeSessions(
      new Request("https://hub.test/api/admin/sessions/revoke", { method: "POST" }),
      env,
    );
    expect(res.status).toBe(401);

    const ctx = makeCtx({ dashboard: true });
    ctx.members.push(member("李四", "ou_lisi", "队员"));
    seedSession(ctx.kv, "sid-lisi", "ou_lisi", "李四");
    const res2 = await handleAdminRevokeSessions(authedRequest("/api/admin/sessions/revoke", "sid-lisi", "POST"), ctx.env);
    expect(res2.status).toBe(403);
  });

  it("缺 open_id → 400", async () => {
    const ctx = makeCtx();
    const req = seedAdmin(ctx);
    const res = await handleAdminRevokeSessions(req("/api/admin/sessions/revoke", { method: "POST", body: {} }), ctx.env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("open_id");
  });

  it("只删目标用户的全部会话，他人与管理员自己的保留", async () => {
    const ctx = makeCtx();
    const req = seedAdmin(ctx);
    seedSession(ctx.kv, "sid-t1", "ou_target", "目标");
    seedSession(ctx.kv, "sid-t2", "ou_target", "目标");
    seedSession(ctx.kv, "sid-o", "ou_other", "别人");
    const res = await handleAdminRevokeSessions(
      req("/api/admin/sessions/revoke", { method: "POST", body: { open_id: "ou_target" } }),
      ctx.env,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { revoked: number }).revoked).toBe(2);
    expect(ctx.kv.has(KV_KEYS.session("sid-t1"))).toBe(false);
    expect(ctx.kv.has(KV_KEYS.session("sid-t2"))).toBe(false);
    expect(ctx.kv.has(KV_KEYS.session("sid-o"))).toBe(true);
    expect(ctx.kv.has(KV_KEYS.session("sid-admin"))).toBe(true); // 管理员踢别人不影响自己
  });

  it("允许踢自己：revoked 含当前会话", async () => {
    const ctx = makeCtx();
    const req = seedAdmin(ctx);
    const res = await handleAdminRevokeSessions(
      req("/api/admin/sessions/revoke", { method: "POST", body: { open_id: "ou_admin" } }),
      ctx.env,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { revoked: number }).revoked).toBe(1);
    expect(ctx.kv.has(KV_KEYS.session("sid-admin"))).toBe(false);
  });
});

describe("POST /api/admin/config/dashboard", () => {
  it("base 不合法 → 400（复用 config_dashboard 校验口径）", async () => {
    const ctx = makeCtx();
    const req = seedAdmin(ctx);
    const res = await handleAdminConfig(
      req("/api/admin/config/dashboard", { method: "POST", body: { base: "short", tables: { members: "tblM1" } } }),
      ctx.env,
      undefined,
      "dashboard",
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("base 不合法");
  });

  it("合法配置 → 写入 dashboard:config 并清看板缓存", async () => {
    const ctx = makeCtx();
    const req = seedAdmin(ctx);
    ctx.kv.set(KV_KEYS.dashboardCache("members"), JSON.stringify({ data: [], cachedAt: 1 }));
    const res = await handleAdminConfig(
      req("/api/admin/config/dashboard", { method: "POST", body: { base: "appBase123456", tables: { members: "tblMembers", tasks: "tblTasks" } } }),
      ctx.env,
      undefined,
      "dashboard",
    );
    expect(res.status).toBe(200);
    const cfg = JSON.parse(ctx.kv.get(KV_KEYS.dashboardConfig)!);
    expect(cfg.base).toBe("appBase123456");
    expect(cfg.tables).toEqual({ members: "tblMembers", tasks: "tblTasks" });
    expect(ctx.kv.has(KV_KEYS.dashboardCache("members"))).toBe(false); // 缓存已失效
  });

  it("登录队员 → 403", async () => {
    const ctx = makeCtx({ dashboard: true });
    ctx.members.push(member("李四", "ou_lisi", "队员"));
    seedSession(ctx.kv, "sid-lisi", "ou_lisi", "李四");
    const res = await handleAdminConfig(authedRequest("/api/admin/config/dashboard", "sid-lisi", "POST"), ctx.env, undefined, "dashboard");
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/config/flows", () => {
  it("部分流程补丁深合并写入 flows:config", async () => {
    const ctx = makeCtx();
    const req = seedAdmin(ctx);
    const res = await handleAdminConfig(
      req("/api/admin/config/flows", { method: "POST", body: { reimburse: { tableId: "tblReim1", base: "appBase123456" } } }),
      ctx.env,
      undefined,
      "flows",
    );
    expect(res.status).toBe(200);
    const cfg = JSON.parse(ctx.kv.get(KV_KEYS.flowsConfig)!);
    expect(cfg.reimburse.tableId).toBe("tblReim1");
    expect(cfg.reimburse.base).toBe("appBase123456");
    expect(cfg.reimburse.approvers).toBeTruthy(); // 深合并保留了默认审批人配置
    expect(cfg.hardware.tableId).toBeFalsy(); // 未触及的流程仍是默认空 tableId
  });

  it("tableId 不以 tbl 开头 → 400", async () => {
    const ctx = makeCtx();
    const req = seedAdmin(ctx);
    const res = await handleAdminConfig(
      req("/api/admin/config/flows", { method: "POST", body: { drawing: { tableId: "bad-id", base: "appBase123456" } } }),
      ctx.env,
      undefined,
      "flows",
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("tbl");
  });
});
describe("handleAdmin 门禁", () => {
  it("未登录 → 401", async () => {
    const ctx = makeCtx({ withCf: true });
    const res = await handleAdmin(cfReq("/api/admin/cf/status"), ctx.env, "/api/admin/cf/status");
    expect(res?.status).toBe(401);
  });
  it("非管理员 → 403", async () => {
    const ctx = makeCtx({ withCf: true });
    const res = await handleAdmin(cfReq("/api/admin/cf/status", { sid: "sid-b" }), ctx.env, "/api/admin/cf/status");
    expect(res?.status).toBe(403);
  });
  it("维护者 → 200（CONFIG_ADMIN 含维护者）", async () => {
    const ctx = makeCtx({ withCf: true });
    const res = await handleAdmin(cfReq("/api/admin/cf/status", { sid: "sid-c" }), ctx.env, "/api/admin/cf/status");
    expect(res?.status).toBe(200);
  });
  it("ADMIN_OPEN_IDS 兜底（无名单缓存）→ 200", async () => {
    const ctx = makeCtx({ withCf: true });
    (ctx.env as unknown as Record<string, string>).ADMIN_OPEN_IDS = "ou-other, ou-root";
    const res = await handleAdmin(cfReq("/api/admin/cf/status", { sid: "sid-root" }), ctx.env, "/api/admin/cf/status");
    expect(res?.status).toBe(200);
  });
  it("不在 ADMIN_OPEN_IDS 且无名单缓存 → 403", async () => {
    const ctx = makeCtx({ withCf: true });
    (ctx.env as unknown as Record<string, string>).ADMIN_OPEN_IDS = "ou-other";
    const res = await handleAdmin(cfReq("/api/admin/cf/status", { sid: "sid-root" }), ctx.env, "/api/admin/cf/status");
    expect(res?.status).toBe(403);
  });
  it("管理员 → 200（不回显 token）", async () => {
    const ctx = makeCtx({ withCf: true });
    const res = await handleAdmin(cfReq("/api/admin/cf/status", { sid: "sid-a" }), ctx.env, "/api/admin/cf/status");
    expect(res?.status).toBe(200);
    const data = (await res!.json()) as { configured: boolean; zoneId: string };
    expect(data.configured).toBe(true);
    expect(data.zoneId).toContain("…");
  });
});

describe("CF 凭证状态", () => {
  it("未配置凭证 → configured=false 且带配置提示", async () => {
    const ctx = makeCtx({ withSessions: true });
    const res = await handleAdmin(cfReq("/api/admin/cf/status", { sid: "sid-a" }), ctx.env, "/api/admin/cf/status");
    const data = (await res!.json()) as { configured: boolean; hint?: string };
    expect(data.configured).toBe(false);
    expect(data.hint).toContain("wrangler secret put");
  });
});

describe("DNS 记录", () => {
  it("未配置凭证时查询 → 503", async () => {
    const ctx = makeCtx({ withSessions: true });
    const res = await handleAdmin(cfReq("/api/admin/cf/dns", { sid: "sid-a" }), ctx.env, "/api/admin/cf/dns");
    expect(res?.status).toBe(503);
  });
  it("列表透传 Cloudflare API", async () => {
    const ctx = makeCtx({ withCf: true });
    const res = await handleAdmin(cfReq("/api/admin/cf/dns?name=mes.newenergycoder.club", { sid: "sid-a" }), ctx.env, "/api/admin/cf/dns");
    expect(res?.status).toBe(200);
    const data = (await res!.json()) as { records: Array<{ name: string }> };
    expect(data.records[0].name).toBe("mes.newenergycoder.club");
    expect(ctx.cfCalls[0].url).toContain("dns_records?name=mes.newenergycoder.club");
  });
  it("新增：拒绝非法类型与越界名称", async () => {
    const ctx = makeCtx({ withCf: true });
    for (const body of [
      { type: "SOA", name: "x.newenergycoder.club", content: "y" },
      { type: "A", name: "evil-example.com", content: "1.2.3.4" },
      { type: "A", name: "ok.newenergycoder.club", content: "" },
    ]) {
      const res = await handleAdmin(cfReq("/api/admin/cf/dns", { method: "POST", sid: "sid-a", body }), ctx.env, "/api/admin/cf/dns");
      expect(res?.status).toBe(400);
    }
    expect(ctx.cfCalls.length).toBe(0);
  });
  it("新增：允许泛解析 *（补建直达泛域名的关键操作）", async () => {
    const ctx = makeCtx({ withCf: true });
    const res = await handleAdmin(
      cfReq("/api/admin/cf/dns", { method: "POST", sid: "sid-a", body: { type: "AAAA", name: "*", content: "100::", proxied: true } }),
      ctx.env,
      "/api/admin/cf/dns",
    );
    expect(res?.status).toBe(200);
    expect(ctx.cfCalls[0].body).toMatchObject({ type: "AAAA", name: "*", content: "100::", proxied: true });
  });
  it("删除：调用 Cloudflare DELETE 且需 id", async () => {
    const ctx = makeCtx({ withCf: true });
    const miss = await handleAdmin(cfReq("/api/admin/cf/dns/delete", { method: "POST", sid: "sid-a", body: {} }), ctx.env, "/api/admin/cf/dns/delete");
    expect(miss?.status).toBe(400);
    const res = await handleAdmin(cfReq("/api/admin/cf/dns/delete", { method: "POST", sid: "sid-a", body: { id: "rec-9" } }), ctx.env, "/api/admin/cf/dns/delete");
    expect(res?.status).toBe(200);
    expect(ctx.cfCalls[0].method).toBe("DELETE");
  });
});

describe("缓存清除", () => {
  it("非 https URL 被拒", async () => {
    const ctx = makeCtx({ withCf: true });
    const res = await handleAdmin(cfReq("/api/admin/cf/purge", { method: "POST", sid: "sid-a", body: { files: ["ftp://x/"] } }), ctx.env, "/api/admin/cf/purge");
    expect(res?.status).toBe(400);
    expect(ctx.cfCalls.length).toBe(0);
  });
  it("purge_everything 必须输入域名确认", async () => {
    const ctx = makeCtx({ withCf: true });
    const res = await handleAdmin(cfReq("/api/admin/cf/purge", { method: "POST", sid: "sid-a", body: { purge_everything: true } }), ctx.env, "/api/admin/cf/purge");
    expect(res?.status).toBe(400);
    const data = (await res!.json()) as { error: string };
    expect(data.error).toContain("newenergycoder.club");
  });
  it("purge_everything 确认后调用 API；token 权限不足时错误原样透出", async () => {
    const ctx = makeCtx({ withCf: true });
    const res = await handleAdmin(
      cfReq("/api/admin/cf/purge", { method: "POST", sid: "sid-a", body: { purge_everything: true, confirm: "newenergycoder.club" } }),
      ctx.env,
      "/api/admin/cf/purge",
    );
    expect(res?.status).toBe(502);
    const data = (await res!.json()) as { error: string; upstream: boolean };
    expect(data.error).toContain("10000");
    expect(data.upstream).toBe(true);
    expect(ctx.cfCalls[0].url).toContain("/purge_cache");
  });
  it("按前缀清除", async () => {
    const ctx = makeCtx({ withCf: true });
    const res = await handleAdmin(
      cfReq("/api/admin/cf/purge", { method: "POST", sid: "sid-a", body: { prefixes: ["https://mes.newenergycoder.club/"] } }),
      ctx.env,
      "/api/admin/cf/purge",
    );
    expect(res?.status).toBe(502); // mock 固定模拟权限不足；关键是请求体正确
    expect(ctx.cfCalls[0].body).toEqual({ prefixes: ["https://mes.newenergycoder.club/"] });
  });
});

describe("服务端探测", () => {
  it("拒绝内网/链路本地地址", async () => {
    const ctx = makeCtx({ withCf: true });
    for (const url of ["http://169.254.169.254/latest", "http://127.0.0.1:8787/", "http://localhost/"]) {
      const res = await handleAdmin(cfReq(`/api/admin/probe?url=${encodeURIComponent(url)}`, { sid: "sid-a" }), ctx.env, "/api/admin/probe");
      expect(res?.status).toBe(400);
    }
  });
  it("返回状态/关键头/title", async () => {
    const ctx = makeCtx({ withCf: true });
    ctx.probeResp = new Response("<html><title>MES 页</title></html>", {
      status: 200,
      headers: { "content-type": "text/html", "cf-cache-status": "HIT", "x-vercel-id": "lhr1::abc" },
    });
    const res = await handleAdmin(cfReq(`/api/admin/probe?url=${encodeURIComponent("https://example.com/")}`, { sid: "sid-a" }), ctx.env, "/api/admin/probe");
    expect(res?.status).toBe(200);
    const data = (await res!.json()) as { status: number; title: string; headers: Record<string, string> };
    expect(data.status).toBe(200);
    expect(data.title).toBe("MES 页");
    expect(data.headers["cf-cache-status"]).toBe("HIT");
    expect(data.headers["x-vercel-id"]).toBe("lhr1::abc");
  });
});
