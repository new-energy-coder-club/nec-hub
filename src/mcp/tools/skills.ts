/**
 * Skill 中心 MCP 工具：import_skills / remove_skills / publish_skill
 */

import { inferSkillCategory, normalizeSkillCategory, normalizeSkillTags, readIndex, upsertIndex, type SkillEntry } from "../../hosting";
import { KV_KEYS } from "../../shared/kv-keys";
import { NAME_RE, type McpToolDef } from "./shared";

export async function toolImportSkills(args: Record<string, unknown>, env: Env) {
  const skills = (args.skills ?? []) as Array<{ name?: string; description?: string; url?: string; category?: string; tags?: unknown[] }>;
  if (!Array.isArray(skills) || skills.length === 0) throw new Error("skills 不能为空");
  if (skills.length > 200) throw new Error("单次最多导入 200 个");
  const source = String(args.source ?? "external");
  const list = await readIndex<SkillEntry>(env, KV_KEYS.skillsIndex);
  const byName = new Map(list.map((s) => [s.name, s]));
  let added = 0, updated = 0, skipped = 0;
  for (const s of skills) {
    const name = String(s.name ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!NAME_RE.test(name)) { skipped++; continue; }
    const existing = byName.get(name);
    if (existing && existing.source === "hub") { skipped++; continue; } // 不覆盖中台自托管的 Skill
    const description = String(s.description ?? existing?.description ?? "");
    const entry: SkillEntry = {
      name,
      description,
      url: s.url ? String(s.url) : existing?.url,
      source,
      updatedAt: new Date().toISOString(),
      category: normalizeSkillCategory(s.category) ?? existing?.category ?? inferSkillCategory(name, description),
      tags: normalizeSkillTags(s.tags) ?? existing?.tags,
    };
    if (existing) { byName.set(name, entry); updated++; }
    else { byName.set(name, entry); added++; }
  }
  await env.REGISTRY.put(KV_KEYS.skillsIndex, JSON.stringify([...byName.values()]));
  return {
    content: [
      {
        type: "text",
        text: `✅ 批量导入完成（来源：${source}）：新增 ${added}，更新 ${updated}，跳过 ${skipped}。Skill 中心现有 ${byName.size} 个。`,
      },
    ],
  };
}

export async function toolRemoveSkills(args: Record<string, unknown>, env: Env) {
  const names = new Set(((args.names ?? []) as unknown[]).map((n) => String(n)));
  if (names.size === 0) throw new Error("names 不能为空");
  const list = await readIndex<SkillEntry>(env, KV_KEYS.skillsIndex);
  const kept: SkillEntry[] = [];
  let removed = 0;
  const protectedNames: string[] = [];
  for (const s of list) {
    if (names.has(s.name)) {
      if (s.source === "hub" || (!s.source && !s.url)) { protectedNames.push(s.name); kept.push(s); }
      else removed++;
    } else kept.push(s);
  }
  await env.REGISTRY.put(KV_KEYS.skillsIndex, JSON.stringify(kept));
  return {
    content: [
      {
        type: "text",
        text: `✅ 已下架 ${removed} 个 Skill，Skill 中心剩余 ${kept.length} 个。` +
          (protectedNames.length ? `（${protectedNames.join("、")} 为中台自托管，受保护未删除）` : ""),
      },
    ],
  };
}

export async function toolPublishSkill(args: Record<string, unknown>, env: Env, request: Request) {
  const skillName = String(args.name ?? "");
  if (!NAME_RE.test(skillName)) throw new Error("Skill 名不合法：小写字母/数字/连字符");
  const content = String(args.content ?? "");
  if (!content.includes("---")) throw new Error("content 看起来不是合法的 SKILL.md（缺少 frontmatter）");
  await env.APPS_BUCKET.put(`skills/${skillName}/SKILL.md`, content);
  // 让边缘缓存里的旧版本立即失效
  const origin = new URL(request.url).origin;
  await caches.default.delete(new Request(`${origin}/skills/${skillName}/SKILL.md`, { method: "GET" }));
  const description = String(args.description ?? "");
  const entry: SkillEntry = {
    name: skillName,
    description,
    source: "hub", // 标记为中台自托管，import_skills 同步外部来源时不覆盖
    updatedAt: new Date().toISOString(),
    category: normalizeSkillCategory(args.category) ?? inferSkillCategory(skillName, description),
    tags: normalizeSkillTags(args.tags),
  };
  const list = await upsertIndex(env, KV_KEYS.skillsIndex, entry);
  return {
    content: [
      {
        type: "text",
        text: `✅ Skill 已上架：${skillName}\nSkill 中心现有 ${list.length} 个 Skill。`,
      },
    ],
  };
}

export const importSkillsTool: McpToolDef = {
  name: "import_skills",
  description:
    "批量导入外部 Skill 到 Skill 中心（只登记名称/描述/链接，不托管文件）。典型用法：从团队 Gitee/GitHub 仓库批量同步。",
  inputSchema: {
    type: "object",
    properties: {
      skills: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Skill 名（会自动转为小写连字符）" },
            description: { type: "string" },
            url: { type: "string", description: "SKILL.md 的外部链接" },
            category: { type: "string", description: "分类：dev/docs/design/media/data/lark/agent/life/other；缺省自动推断" },
            tags: { type: "array", items: { type: "string" }, description: "标签，最多 8 个" },
          },
          required: ["name"],
        },
      },
      source: { type: "string", description: "来源标识，如 gitee，默认 external" },
    },
    required: ["skills"],
  },
  impl: (args, env) => toolImportSkills(args, env),
};

export const removeSkillsTool: McpToolDef = {
  name: "remove_skills",
  description:
    "按名称批量下架 Skill。安全约束：只能删除外部登记来源（如 gitee 同步）的 Skill，中台自托管（source=hub）的不受影响。",
  inputSchema: {
    type: "object",
    properties: {
      names: { type: "array", items: { type: "string" }, description: "要下架的 Skill 名列表" },
    },
    required: ["names"],
  },
  impl: (args, env) => toolRemoveSkills(args, env),
};

export const publishSkillTool: McpToolDef = {
  name: "publish_skill",
  description: "把一个 SKILL.md 上架到 NEC 团队 Skill 中心，供其他队员一键安装到自己的 Agent。",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Skill 名，小写连字符，如 nec-tech-report" },
      description: { type: "string", description: "一句话描述" },
      content: { type: "string", description: "SKILL.md 完整 Markdown 内容" },
      category: { type: "string", description: "分类：dev/docs/design/media/data/lark/agent/life/other；缺省自动推断" },
      tags: { type: "array", items: { type: "string" }, description: "标签，最多 8 个" },
    },
    required: ["name", "content"],
  },
  impl: (args, env, ctx) => toolPublishSkill(args, env, ctx.request),
};

export const tools: McpToolDef[] = [importSkillsTool, removeSkillsTool, publishSkillTool];
