/**
 * shared/module-gateway 单元测试：配置接口 / 503 / 401 / 角色门禁 / 500 兜底 / 续期 Cookie / null fallthrough
 * 内存 KV，无网络依赖（角色门禁在未配置看板时 resolveUserRole 降级为默认「队员」，不拉飞书）。
 */
import { describe, expect, it } from "vitest";
import { withModuleGate, type ModuleRouteContext } from "../shared/module-gateway";
import { json } from "../shared/http";

interface TestCfg {
  base: string;
  tables: Record<string, string>;
  updatedAt: string;
}

function makeEnv(kv = new Map<string, string>()): Env {
  return {
    REGISTRY: {
      get: async (key: string, type?: string) => {
        const v = kv.get(key);
        return v == null ? null : type === "json" ? JSON.parse(v) : v;
      },
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    },
  } as unknown as Env;
}

function seedSession(kv: Map<string, string>, sid: string, expiresInMs = 6 * 24 * 3600e3) {
  kv.set(
    `session:${sid}`,
    JSON.stringify({ name: "张三", open_id: "ou-test", createdAt: new Date().toISOString(), expiresAt: Date.now() + expiresInMs }),
  );
}

const CFG: TestCfg = { base: "appTestBase00", tables: { reviews: "tblTest" }, updatedAt: "2026-01-01" };

function makeSpec(kv: Map<string, string>, opts: { withCfg?: boolean; roles?: RegExp; handler?: (ctx: ModuleRouteContext<TestCfg>) => Promise<Response | null> } = {}) {
  const { withCfg = true, roles, handler } = opts;
  if (withCfg) kv.set("test:config", JSON.stringify(CFG));
  return {
    configPath: "/api/test/config",
    label: "测试流程",
    logTag: "test",
    getConfig: async (env: Env) => {
      const raw = await env.REGISTRY.get("test:config");
      return raw ? (JSON.parse(raw) as TestCfg) : null;
    },
    handleConfig: async () => json({ ok: true, from: "handleConfig" }),
    handler: handler ?? (async () => json({ ok: true, from: "handler" })),
    ...(roles ? { roles } : {}),
  };
}

describe("module-gateway：配置接口（免登录）", () => {
  it("GET 未配置 → configured:false", async () => {
    const kv = new Map<string, string>();
    const res = await withModuleGate(makeSpec(kv, { withCfg: false }), new Request("http://x/api/test/config"), makeEnv(kv), "/api/test/config");
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ configured: false, base: null, tables: {} });
  });

  it("GET 已配置 → configured:true + base/tables", async () => {
    const kv = new Map<string, string>();
    const res = await withModuleGate(makeSpec(kv), new Request("http://x/api/test/config"), makeEnv(kv), "/api/test/config");
    const body = (await res!.json()) as { configured: boolean; base: string };
    expect(body.configured).toBe(true);
    expect(body.base).toBe("appTestBase00");
  });

  it("POST 委托 handleConfig；PUT → 405", async () => {
    const kv = new Map<string, string>();
    const post = await withModuleGate(makeSpec(kv), new Request("http://x/api/test/config", { method: "POST" }), makeEnv(kv), "/api/test/config");
    expect(((await post!.json()) as { from: string }).from).toBe("handleConfig");
    const put = await withModuleGate(makeSpec(kv), new Request("http://x/api/test/config", { method: "PUT" }), makeEnv(kv), "/api/test/config");
    expect(put!.status).toBe(405);
  });
});

describe("module-gateway：门禁链", () => {
  it("未配置 → 503 友好提示", async () => {
    const kv = new Map<string, string>();
    const res = await withModuleGate(makeSpec(kv, { withCfg: false }), new Request("http://x/api/test/anything"), makeEnv(kv), "/api/test/anything");
    expect(res!.status).toBe(503);
    expect(await res!.json()).toEqual({
      error: "测试流程尚未配置",
      hint: "请先调用 POST /api/test/config 设置 base 与 tables",
    });
  });

  it("无会话 → 401；handler 不被调用", async () => {
    const kv = new Map<string, string>();
    let called = false;
    const spec = makeSpec(kv, { handler: async () => { called = true; return json({}); } });
    const res = await withModuleGate(spec, new Request("http://x/api/test/x"), makeEnv(kv), "/api/test/x");
    expect(res!.status).toBe(401);
    expect(await res!.json()).toEqual({ error: "请先登录" });
    expect(called).toBe(false);
  });

  it("已登录 → handler 收到 cfg/session/pathname", async () => {
    const kv = new Map<string, string>();
    seedSession(kv, "sid-1");
    const res = await withModuleGate(makeSpec(kv), new Request("http://x/api/test/x", { headers: { cookie: "nec_session=sid-1" } }), makeEnv(kv), "/api/test/x");
    expect(((await res!.json()) as { from: string }).from).toBe("handler");
  });

  it("handler 返回 null → 网关原样返回 null（入口 fallthrough 语义）", async () => {
    const kv = new Map<string, string>();
    seedSession(kv, "sid-1");
    const res = await withModuleGate(makeSpec(kv, { handler: async () => null }), new Request("http://x/api/test/x", { headers: { cookie: "nec_session=sid-1" } }), makeEnv(kv), "/api/test/x");
    expect(res).toBeNull();
  });

  it("handler 抛错 → 500 + 错误消息（不抛出）", async () => {
    const kv = new Map<string, string>();
    seedSession(kv, "sid-1");
    const spec = makeSpec(kv, { handler: async () => { throw new Error("业务炸了"); } });
    const res = await withModuleGate(spec, new Request("http://x/api/test/x", { headers: { cookie: "nec_session=sid-1" } }), makeEnv(kv), "/api/test/x");
    expect(res!.status).toBe(500);
    expect(await res!.json()).toEqual({ error: "业务炸了" });
  });

  it("滑动续期：剩余不足一半 TTL 时响应带新 sid 的 set-cookie，旧 sid 作废", async () => {
    const kv = new Map<string, string>();
    seedSession(kv, "sid-old", 3600e3); // 1 小时 < 3.5 天阈值 → 触发续期
    const res = await withModuleGate(makeSpec(kv), new Request("http://x/api/test/x", { headers: { cookie: "nec_session=sid-old" } }), makeEnv(kv), "/api/test/x");
    expect(res!.status).toBe(200);
    const cookie = res!.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("nec_session=");
    expect(cookie).not.toContain("nec_session=sid-old;");
    expect(kv.has("session:sid-old")).toBe(false);
  });

  it("角色门禁（可选）：role 不匹配 → 403 既有形状；匹配 → 放行", async () => {
    const kv = new Map<string, string>();
    seedSession(kv, "sid-1");
    const req = () => new Request("http://x/api/test/x", { headers: { cookie: "nec_session=sid-1" } });
    // 未配置看板 → resolveUserRole 降级默认「队员」
    const denied = await withModuleGate(makeSpec(kv, { roles: /队长|组长/ }), req(), makeEnv(kv), "/api/test/x");
    expect(denied!.status).toBe(403);
    const deniedBody = (await denied!.json()) as { error: string };
    expect(deniedBody.error).toContain("权限不足");
    expect(deniedBody.error).toContain("当前角色：队员");
    const allowed = await withModuleGate(makeSpec(kv, { roles: /队员/ }), req(), makeEnv(kv), "/api/test/x");
    expect(allowed!.status).toBe(200);
  });
});
