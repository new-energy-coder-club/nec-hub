/**
 * /api/apps 合并视图测试（listPortalApps）：builtin manifest + KV 注册表合并、source 标注、shadows 遮蔽标记
 */
import { describe, expect, it, vi } from "vitest";
import { listPortalApps, type AppEntry } from "../hosting";
import { KV_KEYS } from "../shared/kv-keys";
import { createMockEnv, type MockEnv } from "./mock-env";

const BUILTIN = [
  { name: "reimburse", title: "报销助手", desc: "费用报销单", icon: "💰", group: "standalone" },
  { name: "drawing-review", title: "新增机图纸评审", desc: "提交 · 评审", icon: "📐", group: "core" },
];

const REGISTRY: AppEntry[] = [
  { name: "inventory-check", title: "物资盘点", author: "张三", visibility: "all", version: "0.1.0", updatedAt: "2026-10-01T00:00:00Z", url: "https://hub/apps/inventory-check/" },
  { name: "reimburse", title: "报销助手 R2 版", author: "李四", visibility: "all", version: "9.9.9", updatedAt: "2026-10-02T00:00:00Z", url: "https://hub/apps/reimburse/" },
  { name: "mes-warehouse", title: "MES 仓库", author: "王五", visibility: "all", version: "1.0.0", updatedAt: "2026-10-03T00:00:00Z", url: "https://mes.example.com", external: true },
];

type EnvWithAssets = MockEnv & { ASSETS: { fetch: ReturnType<typeof vi.fn> } };

function envWith(opts: { builtin?: unknown; registry?: AppEntry[] | null }): Env {
  const env = createMockEnv() as EnvWithAssets;
  env.ASSETS = {
    fetch: vi.fn().mockImplementation(async () =>
      opts.builtin === null || opts.builtin === undefined
        ? new Response("not found", { status: 404 })
        : new Response(JSON.stringify(opts.builtin), { status: 200 }),
    ),
  };
  (env.REGISTRY.get as ReturnType<typeof vi.fn>).mockImplementation(async (key: unknown) => {
    if (String(key) === KV_KEYS.appsIndex) return opts.registry === null ? null : JSON.stringify(opts.registry ?? REGISTRY);
    return null;
  });
  return env as unknown as Env;
}

describe("listPortalApps", () => {
  it("合并 builtin 与注册表：builtin 在前并标 source", async () => {
    const env = envWith({ builtin: BUILTIN });
    const apps = await listPortalApps(env, new Request("https://hub/api/apps"));
    expect(apps.slice(0, 2).map((a) => a.name)).toEqual(["reimburse", "drawing-review"]);
    expect(apps[0].source).toBe("builtin");
    expect(apps[0].group).toBe("standalone");
    expect(apps[0].icon).toBe("💰");
    expect(apps.map((a) => a.name)).toContain("inventory-check");
    expect(apps.find((a) => a.name === "inventory-check")?.source).toBe("r2");
    expect(apps.find((a) => a.name === "mes-warehouse")?.source).toBe("external");
  });

  it("同名 r2 应用标 shadows=true 且 url 改写为独立域名，builtin 与外链不标", async () => {
    const env = envWith({ builtin: BUILTIN });
    const apps = await listPortalApps(env, new Request("https://hub/api/apps"));
    const r2Shadow = apps.find((a) => a.name === "reimburse" && a.source === "r2");
    expect(r2Shadow?.shadows).toBe(true);
    // /apps/<name>/ 由平台资产层服务仓内版本，R2 版只在独立域名可达，卡片链接须指向后者
    expect(r2Shadow?.url).toBe("https://reimburse.newenergycoder.club/");
    expect(apps.find((a) => a.name === "reimburse" && a.source === "builtin")?.shadows).toBeUndefined();
    expect(apps.find((a) => a.name === "inventory-check")?.shadows).toBeUndefined();
  });

  it("manifest 缺失/不可读时降级为仅注册表", async () => {
    const env = envWith({ builtin: null });
    const apps = await listPortalApps(env, new Request("https://hub/api/apps"));
    expect(apps.map((a) => a.name).sort()).toEqual(["inventory-check", "mes-warehouse", "reimburse"]);
    expect(apps.every((a) => a.source !== "builtin")).toBe(true);
  });

  it("manifest 非数组时降级为仅注册表", async () => {
    const env = envWith({ builtin: { broken: true } });
    const apps = await listPortalApps(env, new Request("https://hub/api/apps"));
    expect(apps.length).toBe(REGISTRY.length);
  });

  it("注册表为空时仍返回 builtin 列表", async () => {
    const env = envWith({ builtin: BUILTIN, registry: null });
    const apps = await listPortalApps(env, new Request("https://hub/api/apps"));
    expect(apps.map((a) => a.name)).toEqual(["reimburse", "drawing-review"]);
  });
});
