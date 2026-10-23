/**
 * 域名分发系统测试
 *
 * 覆盖：validateSubdomain / validateTarget 纯函数校验 · handleDomains 申请/占用/限额/释放/重试
 * mock 风格沿用 fe04-fe09.test.ts：内存 KV + fetch 路由（Cloudflare DNS records）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleDomains } from "../domains";
import { validateSubdomain, validateTarget, DOMAINS_INDEX_KEY, DOMAIN_REC_PREFIX } from "../domains/service";
import { handleAppSubdomain } from "../domains/wildcard";
import type { DomainEntry } from "../domains/types";
import { KV_KEYS } from "../shared/kv-keys";

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

interface Ctx {
  env: Env;
  kv: Map<string, string>;
  meta: Map<string, unknown>;
  cfCalls: Array<{ method: string; url: string; body?: Record<string, unknown> }>;
  cfFailNext: boolean;
  cfExisting: Record<string, unknown> | null;
}

function createCtx(opts: { withCf?: boolean } = {}): Ctx {
  const kv = new Map<string, string>();
  const meta = new Map<string, unknown>();
  kv.set(
    KV_KEYS.session("sid-a"),
    JSON.stringify({ name: "小明", open_id: "ou-a", createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3 }),
  );
  kv.set(
    KV_KEYS.session("sid-b"),
    JSON.stringify({ name: "小红", open_id: "ou-b", createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3 }),
  );

  const ctx: Ctx = { env: {} as Env, kv, meta, cfCalls: [], cfFailNext: false, cfExisting: null };
  ctx.env = {
    REGISTRY: {
      get: async (key: string) => kv.get(key) ?? null,
      put: async (key: string, value: string, opts?: { metadata?: unknown }) => {
        kv.set(key, value);
        if (opts?.metadata !== undefined) meta.set(key, opts.metadata);
      },
      delete: async (key: string) => {
        kv.delete(key);
        meta.delete(key);
      },
      list: async (opts: { prefix: string }) => ({
        keys: [...kv.keys()].filter((k) => k.startsWith(opts.prefix)).map((name) => ({ name, metadata: meta.get(name) })),
        list_complete: true,
        cursor: "",
      }),
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
      return jsonResp({ success: true, errors: [], result: ctx.cfExisting ? [ctx.cfExisting] : [] });
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

/** 读取全部域名记录（新存储：domains:rec:<subdomain> 单 key） */
function readRecs(ctx: Ctx): DomainEntry[] {
  return [...ctx.kv.entries()]
    .filter(([k]) => k.startsWith(DOMAIN_REC_PREFIX))
    .map(([, v]) => JSON.parse(v) as DomainEntry);
}

function seedEntry(subdomain: string, over: Partial<DomainEntry> = {}): DomainEntry {
  return {
    subdomain,
    fqdn: `${subdomain}.newenergycoder.club`,
    type: "CNAME",
    target: "x.pages.dev",
    proxied: false,
    description: "",
    owner: { name: "小明", open_id: "ou-a" },
    status: "active",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
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
    expect(readRecs(ctx)).toHaveLength(1);
    expect(ctx.cfCalls).toHaveLength(0);
  });

  it("配置 CF 后申请直接 active 并调用 API", async () => {
    const ctx = createCtx({ withCf: true });
    const res = await handleDomains(req("/api/domains", { method: "POST", sid: "sid-a", body: { subdomain: "demo", target: "demo.pages.dev" } }), ctx.env, "/api/domains");
    expect(res?.status).toBe(200);
    const data = (await res!.json()) as { entry: { status: string } };
    expect(data.entry.status).toBe("active");
    expect(ctx.cfCalls.some((c) => c.method === "POST" && c.body?.name === "demo.newenergycoder.club")).toBe(true);
    expect(readRecs(ctx)[0].cfRecordId).toBe("rec-1");
  });

  it("重复子域名返回 409", async () => {
    const ctx = createCtx();
    await handleDomains(req("/api/domains", { method: "POST", sid: "sid-a", body: { subdomain: "demo", target: "a.pages.dev" } }), ctx.env, "/api/domains");
    const res = await handleDomains(req("/api/domains", { method: "POST", sid: "sid-b", body: { subdomain: "demo", target: "b.pages.dev" } }), ctx.env, "/api/domains");
    expect(res?.status).toBe(409);
    expect(readRecs(ctx)).toHaveLength(1);
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
    expect(readRecs(ctx)).toHaveLength(1);

    const ok = await handleDomains(req("/api/domains/delete", { method: "POST", sid: "sid-a", body: { subdomain: "demo" } }), ctx.env, "/api/domains/delete");
    expect(ok?.status).toBe(200);
    expect(readRecs(ctx)).toHaveLength(0);
    expect(ctx.cfCalls.some((c) => c.method === "DELETE" && c.url.includes("/rec-1"))).toBe(true);
  });

  it("pending 记录配置 CF 后可 retry 补同步", async () => {
    const ctx = createCtx();
    await handleDomains(req("/api/domains", { method: "POST", sid: "sid-a", body: { subdomain: "demo", target: "demo.pages.dev" } }), ctx.env, "/api/domains");
    expect(readRecs(ctx)[0].status).toBe("pending");

    ctx.env.CF_API_TOKEN = "cf-token";
    ctx.env.CF_ZONE_ID = "zone-1";
    const res = await handleDomains(req("/api/domains/retry", { method: "POST", sid: "sid-a", body: { subdomain: "demo" } }), ctx.env, "/api/domains/retry");
    expect(res?.status).toBe(200);
    expect(readRecs(ctx)[0].status).toBe("active");
    expect(readRecs(ctx)[0].cfRecordId).toBe("rec-1");
  });

  it("CF 创建失败时记录为 failed 并返回 502", async () => {
    const ctx = createCtx({ withCf: true });
    ctx.cfFailNext = true;
    const res = await handleDomains(req("/api/domains", { method: "POST", sid: "sid-a", body: { subdomain: "demo", target: "demo.pages.dev" } }), ctx.env, "/api/domains");
    expect(res?.status).toBe(502);
    const entry = readRecs(ctx)[0];
    expect(entry.status).toBe("failed");
    expect(entry.error).toContain("81057");
  });

  it("retry 创建冲突时按 fqdn 找回已存在记录并恢复 active", async () => {
    const ctx = createCtx();
    await handleDomains(req("/api/domains", { method: "POST", sid: "sid-a", body: { subdomain: "demo", target: "demo.pages.dev" } }), ctx.env, "/api/domains");
    expect(readRecs(ctx)[0].status).toBe("pending");

    ctx.env.CF_API_TOKEN = "cf-token";
    ctx.env.CF_ZONE_ID = "zone-1";
    ctx.cfFailNext = true; // POST 报 81057 已存在
    ctx.cfExisting = { id: "rec-9", name: "demo.newenergycoder.club", type: "CNAME", content: "demo.pages.dev" };
    const res = await handleDomains(req("/api/domains/retry", { method: "POST", sid: "sid-a", body: { subdomain: "demo" } }), ctx.env, "/api/domains/retry");
    expect(res?.status).toBe(200);
    const entry = readRecs(ctx)[0];
    expect(entry.status).toBe("active");
    expect(entry.cfRecordId).toBe("rec-9");
    expect(ctx.cfCalls.some((c) => c.method === "GET" && c.url.includes("name=demo.newenergycoder.club"))).toBe(true);
  });

  it("retry 创建失败且按 fqdn 找不回记录 → failed 并返回 502", async () => {
    const ctx = createCtx();
    await handleDomains(req("/api/domains", { method: "POST", sid: "sid-a", body: { subdomain: "demo", target: "demo.pages.dev" } }), ctx.env, "/api/domains");

    ctx.env.CF_API_TOKEN = "cf-token";
    ctx.env.CF_ZONE_ID = "zone-1";
    ctx.cfFailNext = true;
    const res = await handleDomains(req("/api/domains/retry", { method: "POST", sid: "sid-a", body: { subdomain: "demo" } }), ctx.env, "/api/domains/retry");
    expect(res?.status).toBe(502);
    const entry = readRecs(ctx)[0];
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
    expect(readRecs(ctx)[0].proxied).toBe(false); // 请求传了 true，被强制关掉
  });
});

describe("存储迁移与每域名单 key", () => {
  it("旧整表 domains:index 自动迁移为 domains:rec:* 并删除旧 key", async () => {
    const ctx = createCtx();
    ctx.kv.set(DOMAINS_INDEX_KEY, JSON.stringify([seedEntry("old-a"), seedEntry("old-b", { status: "pending" })]));
    const res = await handleDomains(req("/api/domains"), ctx.env, "/api/domains");
    expect(res?.status).toBe(200);
    expect(ctx.kv.has(DOMAINS_INDEX_KEY)).toBe(false);
    expect(readRecs(ctx).map((e) => e.subdomain).sort()).toEqual(["old-a", "old-b"]);
    // 迁移后新申请与存量共存，互不影响
    await handleDomains(req("/api/domains", { method: "POST", sid: "sid-b", body: { subdomain: "new-c", target: "x.pages.dev" } }), ctx.env, "/api/domains");
    expect(readRecs(ctx).map((e) => e.subdomain).sort()).toEqual(["new-c", "old-a", "old-b"]);
  });

  it("申请只写单 key：不动其他域名的记录（无整表 read-modify-write）", async () => {
    const ctx = createCtx();
    await handleDomains(req("/api/domains", { method: "POST", sid: "sid-a", body: { subdomain: "d1", target: "x.pages.dev" } }), ctx.env, "/api/domains");
    const before = ctx.kv.get(`${DOMAIN_REC_PREFIX}d1`);
    await handleDomains(req("/api/domains", { method: "POST", sid: "sid-b", body: { subdomain: "d2", target: "y.pages.dev" } }), ctx.env, "/api/domains");
    expect(ctx.kv.get(`${DOMAIN_REC_PREFIX}d1`)).toBe(before);
    expect(ctx.kv.has(DOMAINS_INDEX_KEY)).toBe(false);
  });
});

describe("MCP 工具 apply_domain / release_domain", () => {
  it("非管理端 token 被拒绝", async () => {
    const { toolApplyDomain } = await import("../mcp/tools/domains");
    const ctx = createCtx();
    await expect(toolApplyDomain({ subdomain: "demo", target: "x.pages.dev" }, ctx.env, false)).rejects.toThrow(/MCP_TOKEN/);
  });

  it("管理端代申请成功并落 KV（未配置 webhook 时公示降级不报错）", async () => {
    const { toolApplyDomain, toolReleaseDomain } = await import("../mcp/tools/domains");
    const ctx = createCtx();
    const res = await toolApplyDomain({ subdomain: "demo", target: "demo.pages.dev", applicant_name: "张三" }, ctx.env, true);
    expect(res.content[0].text).toContain("demo.newenergycoder.club");
    expect(res.content[0].text).toContain("未配置 webhook");
    expect(readRecs(ctx)[0].owner.name).toBe("张三");

    const rel = await toolReleaseDomain({ subdomain: "demo", applicant_name: "张三" }, ctx.env, true);
    expect(rel.content[0].text).toContain("已释放");
    expect(readRecs(ctx)).toHaveLength(0);
  });
});

describe("泛域名应用直达（handleAppSubdomain）", () => {
  function wildcardCtx(opts: { hasApp?: boolean; registered?: boolean } = {}) {
    const ctx = createCtx();
    if (opts.registered) {
      const e = seedEntry("demo");
      ctx.kv.set(`${DOMAIN_REC_PREFIX}demo`, JSON.stringify(e));
      ctx.meta.set(`${DOMAIN_REC_PREFIX}demo`, e);
    }
    (ctx.env as unknown as Record<string, unknown>).APPS_BUCKET = {
      get: async (key: string) => (opts.hasApp && key === "apps/demo/index.html" ? { body: "<html>demo app</html>" } : null),
    };
    (ctx.env as unknown as Record<string, unknown>).ASSETS = {
      fetch: async () => new Response("not found", { status: 404 }),
    };
    vi.stubGlobal("caches", { default: { match: async () => undefined, put: async () => {}, delete: async () => true } });
    return ctx;
  }
  const fakeCtx = { waitUntil: () => {} } as unknown as ExecutionContext;

  it("hub 主域与非本域 Host 不拦截（返回 null 走常规路由）", async () => {
    const ctx = wildcardCtx({ hasApp: true });
    expect(await handleAppSubdomain(new Request("https://hub.newenergycoder.club/api/health"), ctx.env, fakeCtx)).toBeNull();
    expect(await handleAppSubdomain(new Request("https://example.com/"), ctx.env, fakeCtx)).toBeNull();
    expect(await handleAppSubdomain(new Request("https://newenergycoder.club/"), ctx.env, fakeCtx)).toBeNull();
  });

  it("<app>.<zone> 根路径服务 R2 里的应用 index.html", async () => {
    const ctx = wildcardCtx({ hasApp: true });
    const res = await handleAppSubdomain(new Request("https://demo.newenergycoder.club/"), ctx.env, fakeCtx);
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toContain("text/html");
    expect(await res?.text()).toBe("<html>demo app</html>");
  });

  it("应用不存在时返回 404 引导（含 deploy_app 提示）", async () => {
    const ctx = wildcardCtx();
    const res = await handleAppSubdomain(new Request("https://ghost.newenergycoder.club/"), ctx.env, fakeCtx);
    expect(res?.status).toBe(404);
    const data = (await res!.json()) as { hint: string };
    expect(data.hint).toContain("deploy_app");
  });

  it("已登记外部目标的域名透传回源，不劫持", async () => {
    const ctx = wildcardCtx({ registered: true });
    vi.stubGlobal("fetch", async () => new Response("origin-ok"));
    const res = await handleAppSubdomain(new Request("https://demo.newenergycoder.club/"), ctx.env, fakeCtx);
    expect(await res?.text()).toBe("origin-ok");
  });

  it("保留子域名透传回源（不劫持平台基础设施）", async () => {
    const ctx = wildcardCtx();
    vi.stubGlobal("fetch", async () => new Response("origin-docs"));
    const res = await handleAppSubdomain(new Request("https://docs.newenergycoder.club/"), ctx.env, fakeCtx);
    expect(await res?.text()).toBe("origin-docs");
  });
});
