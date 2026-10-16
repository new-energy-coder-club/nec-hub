/**
 * 资料页 MCP 工具：publish_doc / remove_docs
 */

import { DOCS_REGISTRY_KEY, type DocEntry } from "../../docs";
import { readIndex } from "../../hosting";
import { NAME_RE, type McpToolDef } from "./shared";

export async function toolPublishDoc(args: Record<string, unknown>, env: Env) {
  const id = String(args.id ?? "").trim();
  if (!NAME_RE.test(id)) {
    throw new Error("资料 id 不合法：仅允许小写字母/数字/连字符（2-41 字符），如 nec-vi、reimburse-sop");
  }
  const title = String(args.title ?? "").trim();
  const description = String(args.description ?? "").trim();
  const category = String(args.category ?? "").trim();
  const url = String(args.url ?? "").trim();
  const visibility = String(args.visibility ?? "all").trim();
  const maintainer = String(args.maintainer ?? "").trim();

  if (!title) throw new Error("title 不能为空");
  if (!["brand", "template", "sop", "training"].includes(category)) {
    throw new Error("category 必须是 brand / template / sop / training");
  }
  if (!url) throw new Error("url 不能为空");

  const entry: DocEntry = {
    id,
    title,
    description,
    category: category as DocEntry["category"],
    url,
    visibility,
    maintainer,
    updatedAt: new Date().toISOString(),
    source: "hub",
  };

  const list = await readIndex<DocEntry>(env, DOCS_REGISTRY_KEY);
  const idx = list.findIndex((d) => d.id === id);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  await env.REGISTRY.put(DOCS_REGISTRY_KEY, JSON.stringify(list));

  return {
    content: [
      {
        type: "text",
        text: `✅ 资料已${idx >= 0 ? "更新" : "发布"}：${title}（${category}）\nid=${id} · 维护人=${maintainer || "未填"}\n打开 ${url} 或刷新门户「资料页」查看。`,
      },
    ],
  };
}

/** remove_docs：按资料 id 批量移除（只删索引，不动资料本体） */
export async function toolRemoveDocs(args: Record<string, unknown>, env: Env) {
  const ids = new Set(((args.ids ?? []) as unknown[]).map((n) => String(n)));
  if (ids.size === 0) throw new Error("ids 不能为空");
  const list = await readIndex<DocEntry>(env, DOCS_REGISTRY_KEY);
  const kept = list.filter((d) => !ids.has(d.id));
  const removed = list.length - kept.length;
  await env.REGISTRY.put(DOCS_REGISTRY_KEY, JSON.stringify(kept));
  return {
    content: [{ type: "text", text: `✅ 已移除 ${removed} 条资料，资料页剩余 ${kept.length} 条。` }],
  };
}

export const publishDocTool: McpToolDef = {
  name: "publish_doc",
  description:
    "发布/更新一条资料页条目（品牌规范、文档模板、制度 SOP、培训材料）。用于 Agent 提交资料更新。",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "资料唯一标识，小写连字符，如 nec-vi、reimburse-sop" },
      title: { type: "string", description: "展示标题" },
      description: { type: "string", description: "一句话说明" },
      category: {
        type: "string",
        enum: ["brand", "template", "sop", "training"],
        description: "brand=品牌规范 template=文档模板 sop=制度SOP training=培训材料",
      },
      url: { type: "string", description: "链接（飞书文档、站内页面或本地下载）" },
      visibility: { type: "string", description: "可见范围：all 或组别名，默认 all" },
      maintainer: { type: "string", description: "维护人" },
    },
    required: ["id", "title", "category", "url"],
  },
  impl: (args, env) => toolPublishDoc(args, env),
};

export const removeDocsTool: McpToolDef = {
  name: "remove_docs",
  description: "从资料页移除指定资料（只删索引，不动资料本体）。",
  inputSchema: {
    type: "object",
    properties: {
      ids: { type: "array", items: { type: "string" }, description: "要移除的资料 id 列表" },
    },
    required: ["ids"],
  },
  impl: (args, env) => toolRemoveDocs(args, env),
};
