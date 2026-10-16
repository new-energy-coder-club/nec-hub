/**
 * 飞书登录回调 /auth/feishu：服务端签发 state 的一次性校验（oauth:state:<state>）
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleFeishuAuth } from "../auth/feishu-auth";
import { createMockEnv } from "./mock-env";

function kvBackedEnv() {
  const env = createMockEnv();
  const store = new Map<string, string>();
  env.REGISTRY.get.mockImplementation((key: string, type?: string) => {
    const v = store.get(key);
    if (v == null) return Promise.resolve(null);
    return Promise.resolve(type === "json" ? JSON.parse(v) : v);
  });
  env.REGISTRY.put.mockImplementation((key: string, value: string) => {
    store.set(key, value);
    return Promise.resolve();
  });
  env.REGISTRY.delete.mockImplementation((key: string) => {
    store.delete(key);
    return Promise.resolve();
  });
  return { env: env as unknown as Env, store };
}

function authRequest(body: Record<string, unknown>): Request {
  return new Request("https://hub.test/auth/feishu", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const FEISHU_OK = {
  "/auth/v3/app_access_token/internal": { code: 0, app_access_token: "app-tok", expire: 7200 },
  "/authen/v1/oidc/access_token": {
    code: 0,
    data: { access_token: "u-tok", refresh_token: "r-tok", expires_in: 7200, refresh_expires_in: 2592000 },
  },
  "/authen/v1/user_info": { code: 0, data: { name: "张三", open_id: "ou_test", avatar_url: "" } },
};

function mockFeishu(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string | URL | Request) => {
      const u = String(url instanceof Request ? url.url : url);
      for (const [k, v] of Object.entries(routes)) {
        if (u.includes(k)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(v) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ code: 404, msg: "not mocked" }) });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("POST /auth/feishu 请求体容错", () => {
  it("非法 JSON 请求体：400 而非 500", async () => {
    const { env } = kvBackedEnv();
    const req = new Request("https://hub.test/auth/feishu", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    const res = await handleFeishuAuth(req, env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("JSON");
  });
});

describe("/auth/feishu CORS 白名单", () => {
  function preflight(origin?: string): Request {
    return new Request("https://hub.test/auth/feishu", {
      method: "OPTIONS",
      headers: origin ? { origin } : {},
    });
  }

  it("白名单源（*.newenergycoder.club / 本地端口）原样回显", async () => {
    const { env } = kvBackedEnv();
    for (const origin of ["https://hub.newenergycoder.club", "https://demo.newenergycoder.club", "https://newenergycoder.club", "http://localhost:8787", "http://127.0.0.1:5173"]) {
      const res = await handleFeishuAuth(preflight(origin), env);
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    }
  });

  it("白名单外的源与缺失 origin：回退固定门户域", async () => {
    const { env } = kvBackedEnv();
    for (const req of [preflight("https://evil.example.com"), preflight("http://newenergycoder.club"), preflight("https://newenergycoder.club.evil.com"), preflight()]) {
      const res = await handleFeishuAuth(req, env);
      expect(res.headers.get("access-control-allow-origin")).toBe("https://hub.newenergycoder.club");
    }
  });
});

describe("POST /auth/feishu state 校验", () => {
  it("带 state 但 KV 中不存在：400 且不发起任何飞书兑换", async () => {
    const { env } = kvBackedEnv();
    mockFeishu(FEISHU_OK);
    const res = await handleFeishuAuth(authRequest({ code: "c1", state: "forged-state" }), env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("state");
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("带 state 且 KV 命中：放行兑换并用后删除 state", async () => {
    const { env, store } = kvBackedEnv();
    store.set("oauth:state:s-1", JSON.stringify({ openId: "ou_test", createdAt: Date.now() }));
    mockFeishu(FEISHU_OK);
    const res = await handleFeishuAuth(authRequest({ code: "c1", state: "s-1" }), env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { open_id: string }).open_id).toBe("ou_test");
    expect(store.has("oauth:state:s-1")).toBe(false);
  });

  it("state 已消费过一次：同一 state 重放返回 400", async () => {
    const { env, store } = kvBackedEnv();
    store.set("oauth:state:s-2", JSON.stringify({ openId: "ou_test", createdAt: Date.now() }));
    mockFeishu(FEISHU_OK);
    const first = await handleFeishuAuth(authRequest({ code: "c1", state: "s-2" }), env);
    expect(first.status).toBe(200);
    const replay = await handleFeishuAuth(authRequest({ code: "c1", state: "s-2" }), env);
    expect(replay.status).toBe(400);
  });

  it("不带 state：保持门户前端 sessionStorage 校验的旧行为，正常兑换", async () => {
    const { env } = kvBackedEnv();
    mockFeishu(FEISHU_OK);
    const res = await handleFeishuAuth(authRequest({ code: "c1" }), env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { open_id: string }).open_id).toBe("ou_test");
  });
});
