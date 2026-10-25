/**
 * FE-06/07 首页布局：白名单校验、三层回退（个人 > 组 > 默认）、KV 存取、MCP 工具权限分支
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HOME_LAYOUT,
  HOME_WIDGET_META,
  MAX_HOME_WIDGETS,
  groupHomeKey,
  parseHomeLayout,
  personalHomeKey,
  resolveHomeLayout,
} from "../home/layout";
import { deleteHomeLayout, getResolvedHome, saveHomeLayout } from "../home/service";
import { handleGetHome, handleGetHomeDefaults, toolSetHomeLayout } from "../home/handlers";
import { KV_KEYS } from "../shared/kv-keys";
import { createMockEnv, type MockEnv } from "./mock-env";

/** Map Backed 的 REGISTRY.get(key, "json") 模拟 */
function kvBackedEnv() {
  const env = createMockEnv();
  const store = new Map<string, unknown>();
  env.REGISTRY.get.mockImplementation((key: string) => Promise.resolve(store.get(key) ?? null));
  env.REGISTRY.put.mockImplementation((key: string, value: string) => {
    store.set(key, JSON.parse(value));
    return Promise.resolve();
  });
  env.REGISTRY.delete.mockImplementation((key: string) => {
    store.delete(key);
    return Promise.resolve();
  });
  return { env: env as unknown as Env, raw: env, store };
}

describe("parseHomeLayout（白名单校验）", () => {
  it("接受 id 字符串与 {id,title} 对象，保留顺序", () => {
    const l = parseHomeLayout(["inventory", { id: "my-tasks", title: "我的待办" }]);
    expect(l?.widgets).toEqual([{ id: "inventory" }, { id: "my-tasks", title: "我的待办" }]);
  });

  it("非白名单组件被丢弃（禁止自由 HTML），去重", () => {
    const l = parseHomeLayout(["goals", "<script>alert(1)</script>", "goals", "docs"]);
    expect(l?.widgets.map((w) => w.id)).toEqual(["goals", "docs"]);
  });

  it("接受 { widgets: [...] } 包装形式", () => {
    const l = parseHomeLayout({ widgets: ["my-apps"] });
    expect(l?.widgets.map((w) => w.id)).toEqual(["my-apps"]);
  });

  it("截断到 MAX_HOME_WIDGETS", () => {
    const many = Array.from({ length: 30 }, (_, i) => Object.keys(HOME_WIDGET_META)[i % 6]);
    const l = parseHomeLayout(many);
    expect(l?.widgets.length).toBeLessThanOrEqual(MAX_HOME_WIDGETS);
  });

  it("形状不对或过滤后为空返回 null", () => {
    expect(parseHomeLayout(null)).toBeNull();
    expect(parseHomeLayout("my-tasks")).toBeNull();
    expect(parseHomeLayout({ widgets: "nope" })).toBeNull();
    expect(parseHomeLayout([])).toBeNull();
    expect(parseHomeLayout(["unknown-widget"])).toBeNull();
  });
});

describe("resolveHomeLayout（三层回退：个人 > 组 > 默认）", () => {
  const get = (kv: Record<string, unknown>) => (key: string) => kv[key] ?? null;

  it("个人配置优先", async () => {
    const r = await resolveHomeLayout(
      get({ [personalHomeKey("ou_a")]: { widgets: ["inventory"] }, [groupHomeKey("机械组")]: { widgets: ["goals"] } }),
      "ou_a",
      "机械组",
    );
    expect(r.source).toBe("personal");
    expect(r.layout.widgets[0].id).toBe("inventory");
  });

  it("无个人配置回落到组配置", async () => {
    const r = await resolveHomeLayout(get({ [groupHomeKey("机械组")]: { widgets: ["goals"] } }), "ou_a", "机械组");
    expect(r.source).toBe("group");
    expect(r.group).toBe("机械组");
    expect(r.layout.widgets[0].id).toBe("goals");
  });

  it("个人配置损坏时静默回落到组配置", async () => {
    const r = await resolveHomeLayout(
      get({ [personalHomeKey("ou_a")]: { widgets: ["freedom-html"] }, [groupHomeKey("机械组")]: { widgets: ["docs"] } }),
      "ou_a",
      "机械组",
    );
    expect(r.source).toBe("group");
  });

  it("两层都没有时用全员默认；无组别时直接默认", async () => {
    const r1 = await resolveHomeLayout(get({}), "ou_a", "机械组");
    expect(r1.source).toBe("default");
    expect(r1.layout).toEqual(DEFAULT_HOME_LAYOUT);
    const r2 = await resolveHomeLayout(get({ [groupHomeKey("机械组")]: { widgets: ["goals"] } }), "ou_b", "");
    expect(r2.source).toBe("default"); // ou_b 不属于机械组，组配置不外溢
  });
});

describe("home service（KV 存取）", () => {
  it("save → getResolvedHome 命中个人层；delete 后回落默认", async () => {
    const { env } = kvBackedEnv();
    await saveHomeLayout(env, "user", "ou_a", parseHomeLayout(["inventory", "my-tasks"])!);
    let r = await getResolvedHome(env, "ou_a", "");
    expect(r.source).toBe("personal");
    expect(r.layout.widgets.map((w) => w.id)).toEqual(["inventory", "my-tasks"]);
    expect(r.layout.updatedAt).toBeTruthy();

    await deleteHomeLayout(env, "user", "ou_a");
    r = await getResolvedHome(env, "ou_a", "");
    expect(r.source).toBe("default");
  });

  it("组配置写 home:group:<组名>，只影响该组成员", async () => {
    const { env } = kvBackedEnv();
    await saveHomeLayout(env, "group", "机械组", parseHomeLayout(["goals"])!);
    expect((await getResolvedHome(env, "ou_a", "机械组")).source).toBe("group");
    expect((await getResolvedHome(env, "ou_b", "视觉组")).source).toBe("default");
  });

  it("save 对全非法组件抛错", async () => {
    const { env } = kvBackedEnv();
    await expect(saveHomeLayout(env, "user", "ou_a", { version: 1, widgets: [{ id: "evil" as never }] })).rejects.toThrow();
  });
});

describe("GET /api/home", () => {
  it("返回后端默认布局与组件元数据，供门户避免维护第二份默认清单", async () => {
    const { env, store } = kvBackedEnv();
    store.set(KV_KEYS.session("sid-home"), JSON.stringify({
      name: "张三",
      open_id: "ou_a",
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
    }));
    store.set(KV_KEYS.role("ou_a"), { role: "队员", group: "", matched: true });

    const res = await handleGetHome(
      new Request("https://hub.test/api/home", { headers: { cookie: "nec_session=sid-home" } }),
      env,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { defaults?: typeof DEFAULT_HOME_LAYOUT; widgets?: unknown };
    expect(data.defaults).toEqual(DEFAULT_HOME_LAYOUT);
    expect(data.widgets).toEqual(HOME_WIDGET_META);
  });

  it("公开默认布局端点不要求登录，且返回同一份后端默认值", async () => {
    const res = handleGetHomeDefaults();
    expect(res.status).toBe(200);
    const data = (await res.json()) as { defaults?: typeof DEFAULT_HOME_LAYOUT; widgets?: unknown };
    expect(data.defaults).toEqual(DEFAULT_HOME_LAYOUT);
    expect(data.widgets).toEqual(HOME_WIDGET_META);
  });

  it("未登录读取生效布局仍返回 401", async () => {
    const { env } = kvBackedEnv();
    const res = await handleGetHome(new Request("https://hub.test/api/home"), env);
    expect(res.status).toBe(401);
  });
});

describe("toolSetHomeLayout（MCP 工具鉴权分支）", () => {
  beforeEach(() => {
    // validateUserToken 走 /authen/v1/user_info，这里 stub 成合法用户
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ code: 0, data: { open_id: "ou_zhangsan", name: "张三" } }),
      }),
    );
  });

  it("无 user_token 且无 MCP_TOKEN 时拒绝", async () => {
    const { env } = kvBackedEnv();
    await expect(toolSetHomeLayout({ action: "set", widgets: ["goals"] }, env, false)).rejects.toThrow(/user_token/);
  });

  it("user_token 绑定本人写入 home:<open_id>", async () => {
    const { env, store } = kvBackedEnv();
    const res = await toolSetHomeLayout(
      { action: "set", widgets: ["inventory", "my-tasks"], user_token: "u-token" },
      env,
      false,
    );
    expect(res.content[0].text).toContain("✅");
    expect(store.has(personalHomeKey("ou_zhangsan"))).toBe(true);
  });

  it("widgets 全非法时报白名单错误", async () => {
    const { env } = kvBackedEnv();
    await expect(
      toolSetHomeLayout({ action: "set", widgets: ["free-html"], user_token: "u-token" }, env, false),
    ).rejects.toThrow(/白名单/);
  });

  it("scope=group 需要组长/队长角色（队员被拒）", async () => {
    const { env } = kvBackedEnv(); // 无 dashboard:config → 角色解析为「队员」
    await expect(
      toolSetHomeLayout({ action: "set", scope: "group", widgets: ["goals"], user_token: "u-token" }, env, false),
    ).rejects.toThrow(/权限不足/);
  });

  it("action=reset 删除个人布局", async () => {
    const { env, store } = kvBackedEnv();
    await saveHomeLayout(env, "user", "ou_zhangsan", parseHomeLayout(["goals"])!);
    const res = await toolSetHomeLayout({ action: "reset", user_token: "u-token" }, env, false);
    expect(res.content[0].text).toContain("恢复默认");
    expect(store.has(personalHomeKey("ou_zhangsan"))).toBe(false);
  });

  it("管理端 MCP_TOKEN 可用 open_id 指定用户", async () => {
    const { env, store } = kvBackedEnv();
    await toolSetHomeLayout({ action: "set", widgets: ["docs"], open_id: "ou_admin_target" }, env, true);
    expect(store.has(personalHomeKey("ou_admin_target"))).toBe(true);
  });
});
