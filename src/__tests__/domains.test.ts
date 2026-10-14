/**
 * 域名分发系统测试
 *
 * 覆盖：validateSubdomain / validateTarget 纯函数校验 · handleDomains 申请/占用/限额/释放/重试
 * mock 风格沿用 fe04-fe09.test.ts：内存 KV + fetch 路由（Cloudflare DNS records）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleDomains } from "../domains";
import { validateSubdomain, validateTarget, DOMAINS_INDEX_KEY } from "../domains/service";
import type { DomainEntry } from "../domains/types";

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

interface Ctx {
  env: Env;
  kv: Map<string, string>;
  cfCalls: Array<{ method: string; url: string; body?: Record<string, unknown> }>;
  cfFailNext: boolean;
}

function createCtx(opts: { withCf?: boolean } = {}): Ctx {
  const kv = new Map<string, string>();
  kv.set(
    "session:sid-a",
    JSON.stringify({ name: "小明", open_id: "ou-a", createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3 }),
  );
  kv.set(
    "session:sid-b",
    JSON.stringify({ name: "小红", open_id: "ou-b", createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3 }),
  );

  const ctx: Ctx = { env: {} as Env, kv, cfCalls: [], cfFailNext: false };
  ctx.env = {
    REGISTRY: {
      get: async (key: string) => kv.get(key) ?? null,
      put: async (key: string, value: string) => void kv.set(key, value),
      delete: async (key: string) => void kv.delete(key),
    },
    ...(opts.withCf ? { CF_API_TOKEN: "cf-token", CF_ZONE_ID: "zone-1" } : {}),
  } as unknown as Env;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("api.cloudflare.com")) {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      ctx.cfCalls.push({ method: init?.method ?? "GET", url, body });
      if (ctx.cfFailNext) {
        ctx.cfFailNext = false;
        return jsonResp({ success: false, errors: [{ code: 81057, message: "Record already exists" }], result: null });
      }
      if ((init?.method ?? "GET") === "POST") {
        return jsonResp({ success: true, errors: [], result: { id: "rec-1", name: body?.name, type: body?.type, content: body?.content } });
      }
      if (init?.method === "DELETE") {
        return jsonResp({ success: true, errors: [], result: { id: "rec-1" } });
      }
      return jsonResp({ success: true, errors: [], result: [] });
    }
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

function readIndex(ctx: Ctx): DomainEntry[] {
  const raw = ctx.kv.get(DOMAINS_INDEX_KEY);
  return raw ? (JSON.parse(raw) as DomainEntry[]) : [];
}

beforeEach(() => vi.unstubAllGlobals());

describe("validateSubdomain", () => {
  it("接受合法子域名并转小写", () => {
    expect(validateSubdomain("My-App01")).toBe("my-app01");
  });
  it("接受多级子域名（四级域名）", () => {
    expect(validateSubdomain("My-App.Dev")).toBe("my-app.dev");
    expect(validateSubdomain("aa.bb.cc")).toBe("aa.bb.cc");
  });
  it("拒绝非法字符与过短名称", () => {
    for (const bad of ["", "a", "-abc", "abc-", "a_b", "中文", "a".repeat(64), "a..b", ".ab", "a.b.c.d", "aa.b"]) {
      expect(() => validateSubdomain(bad)).toThrow();
    }
  });
  it("拒绝保留子域名（首标签全量校验，深级标签拦高危词）", () => {
    for (const r of ["hub", "www", "api", "docs", "kimi", "erp", "hub.dev", "my.hub", "aa.login"]) {
      expect(() => validateSubdomain(r)).toThrow(/保留/);
    }
  });
});

describe("validateTarget", () => {
  const zone = "newenergycoder.club";
  it("CNAME 接受主机名", () => {
    expect(validateTarget("CNAME", "my-app.pages.dev", zone)).toEqual({ type: "CNAME", target: "my-app.pages.dev" });
  });
  it("CNAME 拒绝 IP 与指向根域自身", () => {
    expect(() => validateTarget("CNAME", "1.2.3.4", zone)).toThrow();
    expect(() => validateTarget("CNAME", "hub.newenergycoder.club", zone)).toThrow(/回环/);
  });
  it("A 校验 IPv4", () => {
    expect(validateTarget("A", "1.2.3.4", zone).type).toBe("A");
    expect(() => validateTarget("A", "999.1.1.1", zone)).toThrow();
    expect(() => validateTarget("A", "example.com", zone)).toThrow();
  });
  it("不支持的类型报错", () => {
    expect(() => validateTarget("TXT", "abc", zone)).toThrow();
  });
});

describe("handleDomains", () => {
  it("GET /api/domains 公开目录无需登录且只含 active", async () => {
    const ctx = createCtx();
    ctx.kv.set(
      DOMAINS_INDEX_KEY,
      JSON.stringify([
        { subdomain: "a1", fqdn: "a1.newenergycoder.club", type: "CNAME", target: "x.pages.dev", proxied: false, description: "", owner: { name: "小明", open_id: "ou-a" }, status: "active", createdAt: "", updatedAt: "" },
        { subdomain: "b1", fqdn: "b1.newenergycoder.club", type: "CNAME", target: "y.pages.dev", proxied: false, description: "", owner: { name: "小红", open_id: "ou-b" }, status: "pending", createdAt: "", updatedAt: "" },
      ]),
    );
    const res = await handleDomains(req("/api/domains"), ctx.env, "/api/domains");
    expect(res?.status).toBe(200);
    const data = (await res!.json()) as { domains: Array<{ subdomain: string; owner: string }> };
    expect(data.domains.map((d) => d.subdomain)).toEqual(["a1"]);
    expect(data.domains[0].owner).toBe("小明"); // 脱敏：只有名字，无 open_id
    expect(JSON.stringify(data)).not.toContain("ou-a");
  });

  it("未登录申请返回 401", async () => {
    const ctx = createCtx();
    const res = await handleDomains(req("/api/domains", { method: "POST", body: { subdomain: "x1", target: "x.pages.dev" } }), ctx.env, "/api/domains");
    expect(res?.status).toBe(401);
  });

  it("未配置 CF 凭证时申请保存为 pending", async () => {
    const ctx = createCtx();
    const res = await handleDomains(req("/api/domains", { method: "POST", sid: "sid-a", body: { subdomain: "demo", target: "demo.pages.dev" } }), ctx.env, "/api/domains");
    expect(res?.status).toBe(200);
    const data = (await res!.json()) as { ok: boolean; entry: { status: string; fqdn: string } };
    expect(data.ok).toBe(true);
    expect(data.entry.status).toBe("pending");
    expect(data.entry.fqdn).toBe("demo.newenergycoder.club");
    expect(readIndex(ctx)).toHaveLength(1);
    expect(ctx.cfCalls).toHaveLength(0);
  });

  it("配置 CF 后申请直接 active 并调用 API", async () => {
    const ctx = createCtx({ withCf: true });
    const res = await handleDomains(req("/api/domains", { method: "POST", sid: "sid-a", body: { subdomain: "demo", target: "demo.pages.dev" } }), ctx.env, "/api/domains");
    expect(res?.status).toBe(200);
    const data = (await res!.json()) as { entry: { status: string } };
    expect(data.entry.status).toBe("active");
    expect(ctx.cfCalls.some((c) => c.method === "POST" && c.body?.name === "demo.newenergycoder.club")).toBe(true);
    expect(readIndex(ctx)[0].cfRecordId).toBe("rec-1");
  });

  it("重复子域名返回 409", async () => {
    const ctx = createCtx();
    await handleDomains(req("/api/domains", { method: "POST", sid: "sid-a", body: { subdomain: "demo", target: "a.pages.dev" } }), ctx.env, "/api/domains");
    const res = await handleDomains(req("/api/domains", { method: "POST", sid: "sid-b", body: { subdomain: "demo", target: "b.pages.dev" } }), ctx.env, "/api/domains");
    expect(res?.status).toBe(409);
    expect(readIndex(ctx)).toHaveLength(1);
  });

  it("超出每成员限额返回 429", async () => {
    const ctx = createCtx();
    for (const sub of ["d1", "d2", "d3"]) {
      await handleDomains(req("/api/domains", { method: "POST", sid: "sid-a", body: { subdomain: sub, target: "x.pages.dev" } }), ctx.env, "/api/domains");
    }
    const res = await handleDomains(req("/api/domains", { method: "POST", sid: "sid-a", body: { subdomain: "d4", target: "x.pages.dev" } }), ctx.env, "/api/domains");
    expect(res?.status).toBe(429);
  });

  it("只能释放自己的域名；释放 active 域名会调用 CF 删除", async () => {
    const ctx = createCtx({ withCf: true });
    await handleDomains(req("/api/domains", { method: "POST", sid: "sid-a", body: { subdomain: "demo", target: "demo.pages.dev" } }), ctx.env, "/api/domains");

    const forbidden = await handleDomains(req("/api/domains/delete", { method: "POST", sid: "sid-b", body: { subdomain: "demo" } }), ctx.env, "/api/domains/delete");
    expect(forbidden?.status).toBe(403);
    expect(readIndex(ctx)).toHaveLength(1);

    const ok = await handleDomains(req("/api/domains/delete", { method: "POST", sid: "sid-a", body: { subdomain: "demo" } }), ctx.env, "/api/domains/delete");
    expect(ok?.status).toBe(200);
    expect(readIndex(ctx)).toHaveLength(0);
    expect(ctx.cfCalls.some((c) => c.method === "DELETE" && c.url.includes("/rec-1"))).toBe(true);
  });

  it("pending 记录配置 CF 后可 retry 补同步", async () => {
    const ctx = createCtx();
    await handleDomains(req("/api/domains", { method: "POST", sid: "sid-a", body: { subdomain: "demo", target: "demo.pages.dev" } }), ctx.env, "/api/domains");
    expect(readIndex(ctx)[0].status).toBe("pending");

    ctx.env.CF_API_TOKEN = "cf-token";
    ctx.env.CF_ZONE_ID = "zone-1";
    const res = await handleDomains(req("/api/domains/retry", { method: "POST", sid: "sid-a", body: { subdomain: "demo" } }), ctx.env, "/api/domains/retry");
    expect(res?.status).toBe(200);
    expect(readIndex(ctx)[0].status).toBe("active");
    expect(readIndex(ctx)[0].cfRecordId).toBe("rec-1");
  });

  it("CF 创建失败时记录为 failed 并返回 502", async () => {
    const ctx = createCtx({ withCf: true });
    ctx.cfFailNext = true;
    const res = await handleDomains(req("/api/domains", { method: "POST", sid: "sid-a", body: { subdomain: "demo", target: "demo.pages.dev" } }), ctx.env, "/api/domains");
    expect(res?.status).toBe(502);
    const entry = readIndex(ctx)[0];
    expect(entry.status).toBe("failed");
    expect(entry.error).toContain("81057");
  });

  it("四级域名：申请成功且强制仅 DNS（proxied=false），hint 给出证书提示", async () => {
    const ctx = createCtx();
    const res = await handleDomains(
      req("/api/domains", { method: "POST", sid: "sid-a", body: { subdomain: "my-app.dev", target: "demo.pages.dev", proxied: true } }),
      ctx.env,
      "/api/domains",
    );
    expect(res?.status).toBe(200);
    const data = (await res!.json()) as { entry: { fqdn: string; deep: boolean }; hint: string };
    expect(data.entry.fqdn).toBe("my-app.dev.newenergycoder.club");
    expect(data.entry.deep).toBe(true);
    expect(data.hint).toContain("仅 DNS");
    expect(readIndex(ctx)[0].proxied).toBe(false); // 请求传了 true，被强制关掉
  });
});
