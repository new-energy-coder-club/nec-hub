/**
 * CLA 签署测试 — /api/cla（名单脱敏/限 100 条）· /api/cla/sign（校验/幂等/会话绑定/IP 限流）· /api/cla/status
 *
 * mock 风格沿用 approvals.test.ts：内存 Map 模拟 KV（含 list 前缀查询）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { handleCla, CLA_VERSION } from "../cla";
import { KV_KEYS } from "../shared/kv-keys";

interface Ctx {
  env: Env;
  kv: Map<string, string>;
}

function createCtx(): Ctx {
  const kv = new Map<string, string>();
  const env = {
    REGISTRY: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
      list: async (opts: { prefix?: string }) => ({
        keys: [...kv.keys()].filter((k) => k.startsWith(opts.prefix ?? "")).sort().map((name) => ({ name })),
        list_complete: true,
        cursor: "",
      }),
    },
  } as unknown as Env;
  return { env, kv };
}

function signRequest(body: unknown, opts: { cookie?: string; ip?: string } = {}): Request {
  return new Request("https://hub.test/api/cla/sign", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": opts.ip ?? "203.0.113.1",
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function call(ctx: Ctx, req: Request, pathname: string): Promise<Response> {
  const res = await handleCla(req, ctx.env, pathname);
  if (!res) throw new Error(`no handler matched ${pathname}`);
  return res;
}

const VALID = { name: "张三", github: "Octo-Cat", email: "z@nec.dev", org: "常州工学院", agree: true };

describe("CLA 签署", () => {
  let ctx: Ctx;
  beforeEach(() => { ctx = createCtx(); });

  it("GET /api/cla 初始为空名单", async () => {
    const res = await call(ctx, new Request("https://hub.test/api/cla"), "/api/cla");
    const data = await res.json() as { count: number; signatures: unknown[]; agreement: { version: string } };
    expect(data.count).toBe(0);
    expect(data.signatures).toEqual([]);
    expect(data.agreement.version).toBe(CLA_VERSION);
  });

  it("POST /api/cla/sign 签署成功并写入 KV；名单不含邮箱", async () => {
    const res = await call(ctx, signRequest(VALID), "/api/cla/sign");
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean; alreadySigned: boolean; count: number };
    expect(data).toMatchObject({ ok: true, alreadySigned: false, count: 1 });
    expect(ctx.kv.has(KV_KEYS.claSignature("octo-cat"))).toBe(true);

    const list = await call(ctx, new Request("https://hub.test/api/cla"), "/api/cla");
    const pub = await list.json() as { signatures: Array<Record<string, unknown>> };
    expect(pub.signatures).toHaveLength(1);
    expect(pub.signatures[0]).toMatchObject({ name: "张三", github: "Octo-Cat", version: CLA_VERSION });
    expect(pub.signatures[0]).not.toHaveProperty("email");
    expect(pub.signatures[0]).not.toHaveProperty("openId");
  });

  it("同一 GitHub 用户名（大小写不同）幂等，不重复计数", async () => {
    await call(ctx, signRequest(VALID), "/api/cla/sign");
    const res = await call(ctx, signRequest({ ...VALID, github: "octo-cat", name: "张三二" }), "/api/cla/sign");
    const data = await res.json() as { ok: boolean; alreadySigned: boolean; count: number };
    expect(data.alreadySigned).toBe(true);
    expect(data.count).toBe(1);
  });

  it("未勾选同意 / 非法 GitHub 用户名 / 缺姓名 / 非法邮箱 / org 超长 → 400", async () => {
    for (const body of [
      { ...VALID, agree: false },
      { ...VALID, github: "-bad-name" },
      { ...VALID, github: "" },
      { ...VALID, name: "" },
      { ...VALID, email: "not-an-email" },
      { ...VALID, email: "a@b.c" },
      { ...VALID, email: "a b@nec.dev" },
      { ...VALID, org: "x".repeat(61) },
    ]) {
      const res = await call(ctx, signRequest(body), "/api/cla/sign");
      expect(res.status).toBe(400);
    }
    expect([...ctx.kv.keys()].some((k) => k.startsWith(KV_KEYS.claSignature("")))).toBe(false);
  });

  it("每 IP 每小时限 10 次，第 11 次返回 429；换 IP 不受限", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await call(ctx, signRequest(VALID, { ip: "198.51.100.7" }), "/api/cla/sign");
      expect(res.status).toBe(200);
    }
    const blocked = await call(ctx, signRequest(VALID, { ip: "198.51.100.7" }), "/api/cla/sign");
    expect(blocked.status).toBe(429);
    const other = await call(ctx, signRequest(VALID, { ip: "198.51.100.8" }), "/api/cla/sign");
    expect(other.status).toBe(200);
  });

  it("登录会话签署自动绑定 open_id，status 对已登录用户返回 signed", async () => {
    ctx.kv.set(KV_KEYS.session("sid-1"), JSON.stringify({
      name: "张三", open_id: "ou-zhangsan",
      createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3,
    }));
    const res = await call(ctx, signRequest(VALID, { cookie: "nec_session=sid-1" }), "/api/cla/sign");
    expect(res.status).toBe(200);
    const stored = JSON.parse(ctx.kv.get(KV_KEYS.claSignature("octo-cat"))!) as { openId?: string };
    expect(stored.openId).toBe("ou-zhangsan");

    const status = await call(ctx, new Request("https://hub.test/api/cla/status", { headers: { cookie: "nec_session=sid-1" } }), "/api/cla/status");
    const s = await status.json() as { signed: boolean; authenticated: boolean };
    expect(s).toMatchObject({ signed: true, authenticated: true });
  });

  it("status 支持 ?github= 查询；未签署返回 signed=false", async () => {
    await call(ctx, signRequest(VALID), "/api/cla/sign");
    const hit = await call(ctx, new Request("https://hub.test/api/cla/status?github=OCTO-CAT"), "/api/cla/status");
    expect((await hit.json() as { signed: boolean }).signed).toBe(true);
    const miss = await call(ctx, new Request("https://hub.test/api/cla/status?github=nobody"), "/api/cla/status");
    expect((await miss.json() as { signed: boolean }).signed).toBe(false);
  });

  it("公开名单限最近 100 条，count 仍为总数", async () => {
    for (let i = 0; i < 105; i++) {
      const res = await call(ctx, signRequest({ ...VALID, github: `user-${String(i).padStart(3, "0")}` }, { ip: `10.0.${i >> 8}.${i & 255}` }), "/api/cla/sign");
      expect(res.status).toBe(200);
    }
    const res = await call(ctx, new Request("https://hub.test/api/cla"), "/api/cla");
    const data = await res.json() as { count: number; signatures: Array<{ github: string; signedAt: string }> };
    expect(data.count).toBe(105);
    expect(data.signatures).toHaveLength(100);
    expect(data.signatures.some((s) => s.github === "user-000")).toBe(false);
    expect(data.signatures.some((s) => s.github === "user-104")).toBe(true);
    const times = data.signatures.map((s) => s.signedAt);
    expect([...times].sort()).toEqual(times);
  });

  it("未知路径返回 null 交路由表继续匹配", async () => {
    expect(await handleCla(new Request("https://hub.test/api/cla/nope"), ctx.env, "/api/cla/nope")).toBeNull();
  });
});
