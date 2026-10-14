/**
 * MCP whoami / send_notice 工具测试（主线移植收尾 C 组 + B 组）：
 * 身份识别三条路径（管理端 / user_token / 无法识别）、角色带组输出、
 * 名单外 external 提示、TOOLS 注册存在性。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toolWhoami } from "../mcp/implementations";
import { TOOLS } from "../mcp/tools";

function makeEnv(kv = new Map<string, string>()): Env {
  return {
    REGISTRY: {
      get: async (key: string, type?: string) => {
        const raw = kv.get(key) ?? null;
        if (raw === null) return null;
        return type === "json" ? JSON.parse(raw) : raw;
      },
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    },
  } as unknown as Env;
}

function jsonFetch(data: unknown): unknown {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }),
  );
}

const textOf = (result: { content: Array<{ type: string; text: string }> }): string =>
  result.content.map((c) => c.text).join("\n");

describe("toolWhoami", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("管理端：MCP_TOKEN 持有者直接识别为 admin", async () => {
    const result = await toolWhoami({}, makeEnv(), true);
    expect(textOf(result)).toContain("MCP_TOKEN 持有者");
  });

  it("既无 MCP_TOKEN 又无 user_token → 无法识别身份", async () => {
    await expect(toolWhoami({}, makeEnv(), false)).rejects.toThrow("无法识别身份");
  });

  it("user_token 有效：返回姓名/open_id/角色（含组别）", async () => {
    const kv = new Map<string, string>([
      ["role:ou_zhangsan", JSON.stringify({ role: "队员", group: "机械", matched: true })],
    ]);
    vi.stubGlobal(
      "fetch",
      jsonFetch({ code: 0, msg: "success", data: { open_id: "ou_zhangsan", name: "张三" } }),
    );
    const result = await toolWhoami({ user_token: "u-test-token" }, makeEnv(kv), false);
    expect(textOf(result)).toContain("张三（open_id: ou_zhangsan）");
    expect(textOf(result)).toContain("角色：队员 · 机械");
  });

  it("user_token 无效（飞书返回非 0）→ 抛 user_token 校验失败", async () => {
    vi.stubGlobal("fetch", jsonFetch({ code: 99991663, msg: "invalid access token" }));
    await expect(toolWhoami({ user_token: "u-bad-token" }, makeEnv(), false)).rejects.toThrow(
      "user_token 校验失败",
    );
  });

  it("名单外用户：角色按 external 处理并给出提示", async () => {
    const kv = new Map<string, string>([["role:ou_wai", JSON.stringify({ role: "external", group: "", matched: false })]]);
    vi.stubGlobal("fetch", jsonFetch({ code: 0, msg: "success", data: { open_id: "ou_wai", name: "校友甲" } }));
    const result = await toolWhoami({ user_token: "u-ext" }, makeEnv(kv), false);
    expect(textOf(result)).toContain("角色：external");
    expect(textOf(result)).toContain("未在队员名单表匹配到");
  });
});

describe("TOOLS 注册", () => {
  it("whoami 与 send_notice 均已注册", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain("whoami");
    expect(names).toContain("send_notice");
  });
});