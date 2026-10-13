import { describe, it, expect, vi } from "vitest";
import { inferSkillCategory, normalizeSkillCategory, normalizeSkillTags } from "../hosting";
import { toolImportSkills, toolPublishSkill } from "../mcp/implementations";
import { createMockEnv } from "./mock-env";

vi.stubGlobal("caches", { default: { delete: vi.fn().mockResolvedValue(true) } });

describe("skill 分类推断", () => {
  it("按名称与描述关键词命中分类", () => {
    expect(inferSkillCategory("lark-base", "操作飞书多维表格")).toBe("lark");
    expect(inferSkillCategory("ai-video-clipper", "自动剪辑视频")).toBe("media");
    expect(inferSkillCategory("frontend-design", "落地页设计")).toBe("design");
    expect(inferSkillCategory("pptx", "制作演示文稿")).toBe("docs");
    expect(inferSkillCategory("data-analysis", "Excel 数据分析")).toBe("data");
    expect(inferSkillCategory("github-skill", "管理仓库")).toBe("dev");
    expect(inferSkillCategory("mcp-builder", "构建 MCP server")).toBe("agent");
    expect(inferSkillCategory("weather-advisor", "天气查询")).toBe("life");
    expect(inferSkillCategory("zzz", "")).toBe("other");
  });

  it("normalizeSkillCategory 只接受受支持的值", () => {
    expect(normalizeSkillCategory("DEV")).toBe("dev");
    expect(normalizeSkillCategory(" 媒体 ")).toBeUndefined();
    expect(normalizeSkillCategory(undefined)).toBeUndefined();
  });

  it("normalizeSkillTags 去空并截断到 8 个", () => {
    expect(normalizeSkillTags(["a", " ", "b"])).toEqual(["a", "b"]);
    expect(normalizeSkillTags(Array.from({ length: 12 }, (_, i) => `t${i}`))).toHaveLength(8);
    expect(normalizeSkillTags([])).toBeUndefined();
    expect(normalizeSkillTags("x")).toBeUndefined();
  });
});

describe("toolImportSkills", () => {
  it("未提供 category 时自动推断并写入 KV，tags 持久化", async () => {
    const env = createMockEnv();
    await toolImportSkills(
      { skills: [{ name: "lark-doc", description: "飞书云文档", url: "https://x", tags: ["飞书", "文档"] }], source: "gitee" },
      env as never,
    );
    const [, raw] = env.REGISTRY.put.mock.calls[0];
    const list = JSON.parse(raw as string);
    expect(list[0]).toMatchObject({ name: "lark-doc", category: "lark", tags: ["飞书", "文档"], source: "gitee" });
  });

  it("显式 category 优先，非法值回落到推断", async () => {
    const env = createMockEnv();
    await toolImportSkills(
      { skills: [
        { name: "a-tool", description: "视频剪辑", category: "design" },
        { name: "b-tool", description: "视频剪辑", category: "bogus" },
      ] },
      env as never,
    );
    const [, raw] = env.REGISTRY.put.mock.calls[0];
    const list = JSON.parse(raw as string);
    expect(list.find((s: { name: string }) => s.name === "a-tool").category).toBe("design");
    expect(list.find((s: { name: string }) => s.name === "b-tool").category).toBe("media");
  });

  it("source=hub 的既有条目不被外部导入覆盖（含分类）", async () => {
    const env = createMockEnv();
    env.REGISTRY.get.mockResolvedValue(JSON.stringify([
      { name: "nec-ppt", description: "答辩 PPT", source: "hub", category: "design", updatedAt: "2026-01-01" },
    ]));
    const res = await toolImportSkills(
      { skills: [{ name: "nec-ppt", description: "被覆盖", category: "media" }], source: "gitee" },
      env as never,
    );
    expect(res.content[0].text).toContain("跳过 1");
    const [, raw] = env.REGISTRY.put.mock.calls[0];
    const list = JSON.parse(raw as string);
    expect(list[0]).toMatchObject({ description: "答辩 PPT", category: "design" });
  });
});

describe("toolPublishSkill", () => {
  it("上架时推断分类并写 R2 + KV", async () => {
    const env = createMockEnv();
    const req = new Request("https://hub.example.com/mcp");
    await toolPublishSkill(
      { name: "my-doc-tool", description: "生成 Word 文档", content: "---\nname: my-doc-tool\n---\n", tags: ["office"] },
      env as never,
      req,
    );
    expect(env.APPS_BUCKET.put).toHaveBeenCalledWith("skills/my-doc-tool/SKILL.md", expect.stringContaining("my-doc-tool"));
    const [, raw] = env.REGISTRY.put.mock.calls[0];
    const list = JSON.parse(raw as string);
    expect(list[0]).toMatchObject({ name: "my-doc-tool", source: "hub", category: "docs", tags: ["office"] });
  });
});
