/**
 * 管理端 MCP 工具鉴权闸门与 deploy_app 上传限额测试（安全加固回归）。
 *
 * 覆盖：此前未接入 hasMcpToken 的管理工具在 fail-closed 下必须拒绝；
 * deploy_app 单文件 / 总量限额在副作用（R2 上传）发生前拦截。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  toolConfigDashboard,
  toolDeployApp,
  toolImportSkills,
  toolPublishDoc,
  toolRegisterApp,
  toolRemoveDocs,
  toolRemoveSkills,
  toolSyncVercel,
} from "../mcp/implementations";
import { toolConfigValidateRules } from "../validation/handlers";
import { createMockEnv } from "./mock-env";

describe("管理工具鉴权闸门（fail-closed）", () => {
  it("未持 MCP_TOKEN 时全部拒绝，且不产生任何副作用", async () => {
    const env = createMockEnv();
    const req = new Request("https://hub.example.com/mcp");
    await expect(toolDeployApp({ name: "demo", files: [{ path: "index.html", text: "x" }] }, env as never, false, req)).rejects.toThrow("MCP_TOKEN");
    await expect(toolRegisterApp({ name: "demo", url: "https://x" }, env as never, false)).rejects.toThrow("MCP_TOKEN");
    await expect(toolSyncVercel({}, env as never, false)).rejects.toThrow("MCP_TOKEN");
    await expect(toolImportSkills({ skills: [{ name: "s1", url: "https://x" }] }, env as never, false)).rejects.toThrow("MCP_TOKEN");
    await expect(toolRemoveSkills({ names: ["s1"] }, env as never, false)).rejects.toThrow("MCP_TOKEN");
    await expect(toolConfigDashboard({ action: "get" }, env as never, false)).rejects.toThrow("MCP_TOKEN");
    await expect(toolPublishDoc({ id: "d1", title: "t", category: "sop", url: "https://x" }, env as never, false)).rejects.toThrow("MCP_TOKEN");
    await expect(toolRemoveDocs({ ids: ["d1"] }, env as never, false)).rejects.toThrow("MCP_TOKEN");
    await expect(toolConfigValidateRules({ action: "get" }, env as never, false)).rejects.toThrow("MCP_TOKEN");
    // 闸门在任何副作用之前生效：K 线无任何写入
    expect(env.REGISTRY.put).not.toHaveBeenCalled();
    expect(env.APPS_BUCKET.put).not.toHaveBeenCalled();
  });
});

describe("deploy_app 上传限额", () => {
  beforeEach(() => {
    vi.stubGlobal("caches", { default: { delete: vi.fn().mockResolvedValue(true) } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("单文件超过 2MB 拒绝（在 R2 上传前拦截）", async () => {
    const env = createMockEnv();
    const big = "a".repeat(2 * 1024 * 1024 + 1);
    await expect(
      toolDeployApp(
        { name: "oversize", files: [{ path: "index.html", text: "x" }, { path: "big.js", text: big }] },
        env as never,
        true,
        new Request("https://hub.example.com/mcp"),
      ),
    ).rejects.toThrow("单文件大小限制");
    expect(env.APPS_BUCKET.put).not.toHaveBeenCalled();
  });

  it("单文件未超限但总量超过 10MB 拒绝", async () => {
    const env = createMockEnv();
    const chunk = "b".repeat(1900 * 1024); // 1.86MB × 6 ≈ 11.4MB
    const files = Array.from({ length: 6 }, (_, i) => ({ path: `asset-${i}.js`, text: chunk }));
    files.push({ path: "index.html", text: "<h1>ok</h1>" });
    await expect(
      toolDeployApp({ name: "grand-total", files }, env as never, true, new Request("https://hub.example.com/mcp")),
    ).rejects.toThrow("总大小超过限制");
    expect(env.APPS_BUCKET.put).not.toHaveBeenCalled();
  });

  it("限额内的小应用正常上架", async () => {
    const env = createMockEnv();
    const res = await toolDeployApp(
      { name: "tiny-app", title: "小应用", files: [{ path: "index.html", text: "<h1>ok</h1>" }] },
      env as never,
      true,
      new Request("https://hub.example.com/mcp"),
    );
    expect(res.content[0].text).toContain("应用已上架：小应用");
    expect(env.APPS_BUCKET.put).toHaveBeenCalledWith("apps/tiny-app/index.html", "<h1>ok</h1>");
  });
});