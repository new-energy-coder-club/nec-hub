/**
 * 管理后台 API 测试（/api/admin/*）
 *
 * 覆盖：登录/角色门禁 · CF 凭证状态 · DNS 列表/新增校验（含泛解析 *）· 缓存清除二次确认 · 探测 SSRF 拦截
 * mock 风格沿用 domains.test.ts：内存 KV（支持 "json" 读取）+ fetch 路由（Cloudflare API / 探测目标）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleAdmin } from "../admin";

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

interface Ctx {
  env: Env;
  kv: Map<string, string>;
  cfCalls: Array<{ method: string; url: string; body?: Record<string, unknown> }>;
  probeResp: Response | null;
}

function createCtx(opts: { withCf?: boolean } = {}): Ctx {
  const kv = new Map<string, string>();
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
  // 角色走 KV 缓存短路 resolveUserRole，避免 mock 飞书 members 表
  kv.set("role:ou-admin", JSON.stringify({ role: "队长", group: "电控", matched: true }));
  kv.set("role:ou-member", JSON.stringify({ role: "队员", group: "电控", matched: true }));
  kv.set("role:ou-maintainer", JSON.stringify({ role: "维护者", group: "指导", matched: true }));

  const ctx: Ctx = { env: {} as Env, kv, cfCalls: [], probeResp: null };
  ctx.env = {
    REGISTRY: {
      get: async (key: string, format?: string) => {
        const v = kv.get(key);
        if (v == null) return null;
        return format === "json" ? (JSON.parse(v) as unknown) : v;
      },
      put: async (key: string, value: string) => void kv.set(key, value),
      delete: async (key: string) => void kv.delete(key),
      list: async () => ({ keys: [], list_complete: true, cursor: "" }),
    },
    HUB_NAME: "NEC 团队 AI 中台",
    DOMAIN_ZONE: "newenergycoder.club",
    ...(opts.withCf ? { CF_API_TOKEN: "cf-token", CF_ZONE_ID: "zone-1" } : {}),
  } as unknown as Env;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("api.cloudflare.com")) {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      ctx.cfCalls.push({ method: init?.method ?? "GET", url, body });
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
    throw new Error(`unexpected fetch: ${url}`);
  });
  return ctx;
}

function req(path: string, opts: { method?: string; sid?: string; body?: unknown } = {}): Request {
  return new Request(`https://hub.newenergycoder.club${path}`, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.sid ? { cookie: `nec_session=${opts.sid}` } : {}),
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

beforeEach(() => vi.unstubAllGlobals());

describe("handleAdmin 门禁", () => {
  it("未登录 → 401", async () => {
    const ctx = createCtx({ withCf: true });
    const res = await handleAdmin(req("/api/admin/cf/status"), ctx.env, "/api/admin/cf/status");
    expect(res?.status).toBe(401);
  });
  it("非管理员 → 403", async () => {
    const ctx = createCtx({ withCf: true });
    const res = await handleAdmin(req("/api/admin/cf/status", { sid: "sid-b" }), ctx.env, "/api/admin/cf/status");
    expect(res?.status).toBe(403);
  });
  it("维护者 → 200（CONFIG_ADMIN 含维护者）", async () => {
    const ctx = createCtx({ withCf: true });
    const res = await handleAdmin(req("/api/admin/cf/status", { sid: "sid-c" }), ctx.env, "/api/admin/cf/status");
    expect(res?.status).toBe(200);
  });
  it("ADMIN_OPEN_IDS 兜底（无名单缓存）→ 200", async () => {
    const ctx = createCtx({ withCf: true });
    (ctx.env as unknown as Record<string, string>).ADMIN_OPEN_IDS = "ou-other, ou-root";
    const res = await handleAdmin(req("/api/admin/cf/status", { sid: "sid-root" }), ctx.env, "/api/admin/cf/status");
    expect(res?.status).toBe(200);
  });
  it("不在 ADMIN_OPEN_IDS 且无名单缓存 → 403", async () => {
    const ctx = createCtx({ withCf: true });
    (ctx.env as unknown as Record<string, string>).ADMIN_OPEN_IDS = "ou-other";
    const res = await handleAdmin(req("/api/admin/cf/status", { sid: "sid-root" }), ctx.env, "/api/admin/cf/status");
    expect(res?.status).toBe(403);
  });
  it("管理员 → 200（不回显 token）", async () => {
    const ctx = createCtx({ withCf: true });
    const res = await handleAdmin(req("/api/admin/cf/status", { sid: "sid-a" }), ctx.env, "/api/admin/cf/status");
    expect(res?.status).toBe(200);
    const data = (await res!.json()) as { configured: boolean; zoneId: string };
    expect(data.configured).toBe(true);
    expect(data.zoneId).toContain("…");
  });
});

describe("CF 凭证状态", () => {
  it("未配置凭证 → configured=false 且带配置提示", async () => {
    const ctx = createCtx();
    const res = await handleAdmin(req("/api/admin/cf/status", { sid: "sid-a" }), ctx.env, "/api/admin/cf/status");
    const data = (await res!.json()) as { configured: boolean; hint?: string };
    expect(data.configured).toBe(false);
    expect(data.hint).toContain("wrangler secret put");
  });
});

describe("DNS 记录", () => {
  it("未配置凭证时查询 → 503", async () => {
    const ctx = createCtx();
    const res = await handleAdmin(req("/api/admin/cf/dns", { sid: "sid-a" }), ctx.env, "/api/admin/cf/dns");
    expect(res?.status).toBe(503);
  });
  it("列表透传 Cloudflare API", async () => {
    const ctx = createCtx({ withCf: true });
    const res = await handleAdmin(req("/api/admin/cf/dns?name=mes.newenergycoder.club", { sid: "sid-a" }), ctx.env, "/api/admin/cf/dns");
    expect(res?.status).toBe(200);
    const data = (await res!.json()) as { records: Array<{ name: string }> };
    expect(data.records[0].name).toBe("mes.newenergycoder.club");
    expect(ctx.cfCalls[0].url).toContain("dns_records?name=mes.newenergycoder.club");
  });
  it("新增：拒绝非法类型与越界名称", async () => {
    const ctx = createCtx({ withCf: true });
    for (const body of [
      { type: "SOA", name: "x.newenergycoder.club", content: "y" },
      { type: "A", name: "evil-example.com", content: "1.2.3.4" },
      { type: "A", name: "ok.newenergycoder.club", content: "" },
    ]) {
      const res = await handleAdmin(req("/api/admin/cf/dns", { method: "POST", sid: "sid-a", body }), ctx.env, "/api/admin/cf/dns");
      expect(res?.status).toBe(400);
    }
    expect(ctx.cfCalls.length).toBe(0);
  });
  it("新增：允许泛解析 *（补建直达泛域名的关键操作）", async () => {
    const ctx = createCtx({ withCf: true });
    const res = await handleAdmin(
      req("/api/admin/cf/dns", { method: "POST", sid: "sid-a", body: { type: "AAAA", name: "*", content: "100::", proxied: true } }),
      ctx.env,
      "/api/admin/cf/dns",
    );
    expect(res?.status).toBe(200);
    expect(ctx.cfCalls[0].body).toMatchObject({ type: "AAAA", name: "*", content: "100::", proxied: true });
  });
  it("删除：调用 Cloudflare DELETE 且需 id", async () => {
    const ctx = createCtx({ withCf: true });
    const miss = await handleAdmin(req("/api/admin/cf/dns/delete", { method: "POST", sid: "sid-a", body: {} }), ctx.env, "/api/admin/cf/dns/delete");
    expect(miss?.status).toBe(400);
    const res = await handleAdmin(req("/api/admin/cf/dns/delete", { method: "POST", sid: "sid-a", body: { id: "rec-9" } }), ctx.env, "/api/admin/cf/dns/delete");
    expect(res?.status).toBe(200);
    expect(ctx.cfCalls[0].method).toBe("DELETE");
  });
});

describe("缓存清除", () => {
  it("非 https URL 被拒", async () => {
    const ctx = createCtx({ withCf: true });
    const res = await handleAdmin(req("/api/admin/cf/purge", { method: "POST", sid: "sid-a", body: { files: ["ftp://x/"] } }), ctx.env, "/api/admin/cf/purge");
    expect(res?.status).toBe(400);
    expect(ctx.cfCalls.length).toBe(0);
  });
  it("purge_everything 必须输入域名确认", async () => {
    const ctx = createCtx({ withCf: true });
    const res = await handleAdmin(req("/api/admin/cf/purge", { method: "POST", sid: "sid-a", body: { purge_everything: true } }), ctx.env, "/api/admin/cf/purge");
    expect(res?.status).toBe(400);
    const data = (await res!.json()) as { error: string };
    expect(data.error).toContain("newenergycoder.club");
  });
  it("purge_everything 确认后调用 API；token 权限不足时错误原样透出", async () => {
    const ctx = createCtx({ withCf: true });
    const res = await handleAdmin(
      req("/api/admin/cf/purge", { method: "POST", sid: "sid-a", body: { purge_everything: true, confirm: "newenergycoder.club" } }),
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
    const ctx = createCtx({ withCf: true });
    const res = await handleAdmin(
      req("/api/admin/cf/purge", { method: "POST", sid: "sid-a", body: { prefixes: ["https://mes.newenergycoder.club/"] } }),
      ctx.env,
      "/api/admin/cf/purge",
    );
    expect(res?.status).toBe(502); // mock 固定模拟权限不足；关键是请求体正确
    expect(ctx.cfCalls[0].body).toEqual({ prefixes: ["https://mes.newenergycoder.club/"] });
  });
});

describe("服务端探测", () => {
  it("拒绝内网/链路本地地址", async () => {
    const ctx = createCtx({ withCf: true });
    for (const url of ["http://169.254.169.254/latest", "http://127.0.0.1:8787/", "http://localhost/"]) {
      const res = await handleAdmin(req(`/api/admin/probe?url=${encodeURIComponent(url)}`, { sid: "sid-a" }), ctx.env, "/api/admin/probe");
      expect(res?.status).toBe(400);
    }
  });
  it("返回状态/关键头/title", async () => {
    const ctx = createCtx({ withCf: true });
    ctx.probeResp = new Response("<html><title>MES 页</title></html>", {
      status: 200,
      headers: { "content-type": "text/html", "cf-cache-status": "HIT", "x-vercel-id": "lhr1::abc" },
    });
    const res = await handleAdmin(req(`/api/admin/probe?url=${encodeURIComponent("https://example.com/")}`, { sid: "sid-a" }), ctx.env, "/api/admin/probe");
    expect(res?.status).toBe(200);
    const data = (await res!.json()) as { status: number; title: string; headers: Record<string, string> };
    expect(data.status).toBe(200);
    expect(data.title).toBe("MES 页");
    expect(data.headers["cf-cache-status"]).toBe("HIT");
    expect(data.headers["x-vercel-id"]).toBe("lhr1::abc");
  });
});
