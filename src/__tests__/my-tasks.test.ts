/**
 * 我的任务：登录门禁、绑定/解绑、Task v2 同步拉取、user token 续期
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleGetMyTasks, handleUnbindMyTasks } from "../my-tasks";
import { createMockEnv } from "./mock-env";

/** Map Backed 的 KV 模拟：get(key) 返回原文，get(key,"json") 解析（贴近真实 KV 语义，会话存取依赖原文） */
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
  return { env: env as unknown as Env, raw: env, store };
}

function authedRequest(store: Map<string, string>, path = "/api/my-tasks"): Request {
  store.set(
    "session:sid-test",
    JSON.stringify({
      name: "张三",
      open_id: "ou_test",
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
    }),
  );
  return new Request("https://hub.test" + path, { headers: { cookie: "nec_session=sid-test" } });
}

function seedUserToken(store: Map<string, string>, expiresInMs = 3600e3): void {
  store.set(
    "feishu:user_token:ou_test",
    JSON.stringify({
      user_access_token: "u-tok-1",
      refresh_token: "r-tok-1",
      expires_at: Date.now() + expiresInMs,
      refresh_expires_at: Date.now() + 30 * 24 * 3600e3,
    }),
  );
}

/** 按 URL 片段路由的飞书 fetch mock */
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

const TASK_PAGE = {
  code: 0,
  data: {
    items: [
      {
        guid: "g1",
        summary: "画 R1 底盘图纸",
        due: { timestamp: "1893456000000", is_all_day: false },
        completed_at: "0",
        url: "https://feishu.cn/task/g1",
        members: [{ id: "ou_test", type: "user", role: "assignee" }],
      },
      { guid: "g2", summary: "无截止任务", completed_at: "0", url: "", members: [] },
    ],
    has_more: false,
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("GET /api/my-tasks", () => {
  it("未登录返回 401", async () => {
    const { env } = kvBackedEnv();
    const res = await handleGetMyTasks(new Request("https://hub.test/api/my-tasks"), env);
    expect(res.status).toBe(401);
  });

  it("已登录未绑定：bound=false 且 authorizeUrl 带任务 scope", async () => {
    const { env, store } = kvBackedEnv();
    const res = await handleGetMyTasks(authedRequest(store), env);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { bound: boolean; authorizeUrl: string };
    expect(data.bound).toBe(false);
    expect(data.authorizeUrl).toContain("app_id=test-app-id");
    expect(data.authorizeUrl).toContain("task%3Atask%3Aread");
    expect(data.authorizeUrl).toContain("task%3Atasklist%3Aread");
  });

  it("已绑定：同步拉取 Task v2 并缓存", async () => {
    const { env, store } = kvBackedEnv();
    seedUserToken(store);
    mockFeishu({ "/task/v2/tasks": TASK_PAGE });
    const res = await handleGetMyTasks(authedRequest(store), env);
    const data = (await res.json()) as { bound: boolean; tasks: Array<{ guid: string; dueTimestamp: number | null }>; syncedAt: string };
    expect(data.bound).toBe(true);
    expect(data.tasks.map((t) => t.guid)).toEqual(["g1", "g2"]);
    expect(data.tasks[0].dueTimestamp).toBe(1893456000000);
    expect(data.tasks[1].dueTimestamp).toBeNull();
    expect(data.syncedAt).toBeTruthy();
    expect(store.has("my-tasks:ou_test")).toBe(true);
    // user_access_token 随请求发出
    const taskCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).includes("/task/v2/tasks"));
    expect(taskCall?.[1]?.headers?.authorization).toBe("Bearer u-tok-1");
  });

  it("命中 5 分钟缓存时不回源；?refresh=1 强制刷新", async () => {
    const { env, store } = kvBackedEnv();
    seedUserToken(store);
    store.set(
      "my-tasks:ou_test",
      JSON.stringify({ data: { tasks: [{ guid: "cached", summary: "缓存任务" }], syncedAt: "2026-10-14T00:00:00Z" } as unknown, cachedAt: Date.now() }),
    );
    mockFeishu({ "/task/v2/tasks": TASK_PAGE });
    const res1 = await handleGetMyTasks(authedRequest(store), env);
    const d1 = (await res1.json()) as { cached: boolean; tasks: Array<{ guid: string }> };
    expect(d1.cached).toBe(true);
    expect(d1.tasks[0].guid).toBe("cached");
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes("/task/v2/tasks"))).toHaveLength(0);

    const res2 = await handleGetMyTasks(authedRequest(store, "/api/my-tasks?refresh=1"), env);
    const d2 = (await res2.json()) as { cached: boolean; tasks: Array<{ guid: string }> };
    expect(d2.cached).toBe(false);
    expect(d2.tasks[0].guid).toBe("g1");
  });

  it("token 临期：走 refresh 续期、回写 KV、用新 token 拉任务", async () => {
    const { env, store } = kvBackedEnv();
    seedUserToken(store, 60e3); // 1 分钟后过期 → 触发 refresh
    mockFeishu({
      "/auth/v3/app_access_token/internal": { code: 0, app_access_token: "app-tok", expire: 7200 },
      "/authen/v1/oidc/refresh_access_token": {
        code: 0,
        data: { access_token: "u-tok-2", refresh_token: "r-tok-2", expires_in: 7200, refresh_expires_in: 2592000 },
      },
      "/task/v2/tasks": TASK_PAGE,
    });
    const res = await handleGetMyTasks(authedRequest(store), env);
    const data = (await res.json()) as { bound: boolean; tasks: unknown[] };
    expect(data.bound).toBe(true);
    expect(data.tasks).toHaveLength(2);
    const saved = JSON.parse(store.get("feishu:user_token:ou_test")!);
    expect(saved.user_access_token).toBe("u-tok-2");
    expect(saved.refresh_token).toBe("r-tok-2");
    const taskCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).includes("/task/v2/tasks"));
    expect(taskCall?.[1]?.headers?.authorization).toBe("Bearer u-tok-2");
  });

  it("refresh_token 已过期：视为未绑定并清除", async () => {
    const { env, store } = kvBackedEnv();
    seedUserToken(store, -1); // token 与 refresh 均过期
    const rec = JSON.parse(store.get("feishu:user_token:ou_test")!);
    rec.refresh_expires_at = Date.now() - 1000;
    store.set("feishu:user_token:ou_test", JSON.stringify(rec));
    const res = await handleGetMyTasks(authedRequest(store), env);
    const data = (await res.json()) as { bound: boolean };
    expect(data.bound).toBe(false);
    expect(store.has("feishu:user_token:ou_test")).toBe(false);
  });

  it("Task v2 返回 99991663（token 失效）：清绑定并引导重新授权", async () => {
    const { env, store } = kvBackedEnv();
    seedUserToken(store);
    mockFeishu({ "/task/v2/tasks": { code: 99991663, msg: "user access token invalid" } });
    const res = await handleGetMyTasks(authedRequest(store), env);
    const data = (await res.json()) as { bound: boolean; rebind?: boolean; authorizeUrl?: string };
    expect(data.bound).toBe(false);
    expect(data.rebind).toBe(true);
    expect(data.authorizeUrl).toContain("task%3Atask%3Aread");
    expect(store.has("feishu:user_token:ou_test")).toBe(false);
  });
});

describe("POST /api/my-tasks/unbind", () => {
  it("未登录返回 401", async () => {
    const { env } = kvBackedEnv();
    const res = await handleUnbindMyTasks(new Request("https://hub.test/api/my-tasks/unbind", { method: "POST" }), env);
    expect(res.status).toBe(401);
  });

  it("解绑清除授权 token 与任务缓存", async () => {
    const { env, store } = kvBackedEnv();
    seedUserToken(store);
    store.set("my-tasks:ou_test", JSON.stringify({ data: { tasks: [], syncedAt: "" }, cachedAt: Date.now() }));
    const res = await handleUnbindMyTasks(authedRequest(store, "/api/my-tasks/unbind"), env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(store.has("feishu:user_token:ou_test")).toBe(false);
    expect(store.has("my-tasks:ou_test")).toBe(false);
  });
});
