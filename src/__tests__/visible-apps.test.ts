/**
 * A5 应用广场按角色过滤测试（visibleApps）
 */
import { describe, expect, it, vi } from "vitest";
import { visibleApps, type AppEntry } from "../hosting";
import { KV_KEYS } from "../shared/kv-keys";
import { createMockEnv, type MockEnv } from "./mock-env";

const APPS: AppEntry[] = [
  { name: "a1", title: "公开应用", author: "他人", visibility: "all", version: "1.0.0", updatedAt: "", url: "/apps/a1" },
  { name: "a2", title: "机械组应用", author: "他人", visibility: "机械", version: "1.0.0", updatedAt: "", url: "/apps/a2" },
  { name: "a3", title: "队长专属应用", author: "他人", visibility: "队长", version: "1.0.0", updatedAt: "", url: "/apps/a3" },
  { name: "a4", title: "我发布的应用", author: "张三", visibility: "运营", version: "1.0.0", updatedAt: "", url: "/apps/a4" },
  { name: "a5", title: "视觉组应用", author: "他人", visibility: "视觉", version: "1.0.0", updatedAt: "", url: "/apps/a5" },
];

type KvGetMock = ReturnType<typeof vi.fn>;

function envWith(appsKey: string | null, role: unknown = null, session: string | null = null): Env {
  const env = createMockEnv() as MockEnv;
  (env.REGISTRY.get as KvGetMock).mockImplementation(async (key: unknown, type?: unknown) => {
    const k = String(key);
    if (k === KV_KEYS.appsIndex) return appsKey;
    if (k === KV_KEYS.session("sid1")) return session;
    if (k === KV_KEYS.role("ou_1")) {
      if (role === null) return null;
      return type === "json" ? role : JSON.stringify(role);
    }
    return null;
  });
  return env as unknown as Env;
}

function reqWithSession(): Request {
  return new Request("http://x/api/apps", { headers: { cookie: "nec_session=sid1" } });
}

const SESSION = JSON.stringify({ name: "张三", open_id: "ou_1", createdAt: "2026-10-14T08:00:00Z", expiresAt: Date.now() + 3600e3 });

describe("visibleApps", () => {
  it("未登录：仅可见 visibility=all", async () => {
    const env = envWith(JSON.stringify(APPS));
    const apps = await visibleApps(env, new Request("http://x/api/apps"));
    expect(apps.map((a) => a.name)).toEqual(["a1"]);
  });

  it("登录（队长/机械组）：可见 all + 本组 + 本角色 + 本人 authored", async () => {
    const env = envWith(JSON.stringify(APPS), { role: "队长", group: "机械", matched: true }, SESSION);
    const apps = await visibleApps(env, reqWithSession());
    expect(apps.map((a) => a.name)).toEqual(["a1", "a2", "a3", "a4"]);
  });

  it("名单外（external）：仅可见 visibility=all", async () => {
    const env = envWith(JSON.stringify(APPS), { role: "external", group: "", matched: false }, SESSION);
    const apps = await visibleApps(env, reqWithSession());
    expect(apps.map((a) => a.name)).toEqual(["a1"]);
  });

  it("注册表为空：任何角色都返回空列表", async () => {
    const env = envWith(null, { role: "队长", group: "机械", matched: true }, SESSION);
    const apps = await visibleApps(env, reqWithSession());
    expect(apps).toEqual([]);
  });
});