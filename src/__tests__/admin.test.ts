/**
 * 管理总览（GET /api/admin/overview）与退出所有设备（POST /api/auth/logout-all）
 * mock 风格沿用 dr-test-utils.ts / role.test.ts：内存 KV（本文件补 list 实现）+ fetch 路由。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BitableRecord } from "../feishu/bitable";
import { handleAdminOverview } from "../admin";
import { handleLogoutAll } from "../auth/handlers";
import { KV_KEYS } from "../shared/kv-keys";

const MEMBERS_TABLE = "tblMembers";

interface Ctx {
  env: Env;
  kv: Map<string, string>;
  members: BitableRecord[];
}

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function makeCtx(opts: { dashboard?: boolean } = {}): Ctx {
  const kv = new Map<string, string>();
  const members: BitableRecord[] = [];
  if (opts.dashboard) {
    kv.set(
      KV_KEYS.dashboardConfig,
      JSON.stringify({ base: "appMockBase", tables: { members: MEMBERS_TABLE }, updatedAt: new Date().toISOString() }),
    );
  }
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String((input as { url?: string })?.url ?? input);
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
  } as unknown as Env;
  return { env, kv, members };
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
