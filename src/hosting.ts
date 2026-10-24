/**
 * 应用 / Skill 托管与注册表（KV）
 *
 * /apps/<name>/* 与 /skills/<name>/SKILL.md 从 R2 回源，边缘缓存按 URL 缓存；
 * deploy_app / publish_skill 覆盖写入时按 URL 逐文件失效。
 */

import { json } from "./shared/http";
import { KV_KEYS } from "./shared/kv-keys";
import { resolveSession } from "./shared/session";
import { resolveUserRole } from "./auth/role";
import { domainZone } from "./domains/service";

/** 应用广场条目（KV key: apps:index） */
export interface AppEntry {
  name: string;
  title: string;
  author: string;
  visibility: string;
  version: string;
  updatedAt: string;
  url: string;
  /** true = 外部已部署应用的链接登记，文件不在本中台 R2 */
  external?: boolean;
  /** 一句话描述（应用广场卡片展示；发布时建议必填） */
  description?: string;
}

/** Skill 中心条目（KV key: skills:index） */
export interface SkillEntry {
  name: string;
  description: string;
  updatedAt: string;
  /** 外部 SKILL.md 链接（如 Gitee 页面）；为空则用本中台 /skills/<name>/SKILL.md */
  url?: string;
  /** 来源标识，如 gitee / hub */
  source?: string;
  /** 分类（见 SKILL_CATEGORY_LABELS）；缺省时由前端/导入逻辑按名称与描述推断 */
  category?: string;
  /** 自由标签，最多 8 个 */
  tags?: string[];
}

/** Skill 分类标签（value 存 KV，label 用于展示；前端 public/index.html 有一份对应副本） */
export const SKILL_CATEGORY_LABELS: Record<string, string> = {
  dev: "开发工具",
  docs: "文档办公",
  design: "设计创意",
  media: "音视频",
  data: "数据分析",
  lark: "飞书协同",
  agent: "Agent 基建",
  life: "生活效率",
  other: "其他",
};

export const SKILL_CATEGORY_ORDER = ["dev", "docs", "design", "media", "data", "lark", "agent", "life", "other"] as const;

// 推断规则按优先级从上到下命中即止；关键词同时匹配 name 与 description
const SKILL_CATEGORY_RULES: Array<[string, RegExp]> = [
  ["lark", /^lark-|飞书|多维表格|妙记/i],
  ["media", /video|audio|music|剪辑|视频|音频|音乐|字幕|ffmpeg|whisper|gif|混剪/i],
  ["design", /design|canvas|poster|brand|海报|视觉|排版|theme|插画/i],
  ["data", /data|analy|chart|sql|financial|数据|可视化|财报|股票|评分/i],
  ["docs", /docx|xlsx|excel|word|pdf|markdown|ppt|slide|文档|论文|thesis|paper|写作|手册/i],
  ["dev", /code|debug|git|review|test|deploy|refactor|代码|调试|commit|cli/i],
  ["agent", /mcp|skill|agent|persona|memory|claude|kimi|gemini|browser|prompt/i],
  ["life", /weather|travel|news|mail|todo|日程|天气|新闻|旅行|提醒|邮件/i],
];

/** 未登记分类时按名称与描述推断分类（与前端 inferSkillCategoryJS 保持同一套规则） */
export function inferSkillCategory(name: string, description: string): string {
  const text = `${name} ${description}`;
  for (const [cat, re] of SKILL_CATEGORY_RULES) {
    if (re.test(text)) return cat;
  }
  return "other";
}

/** 只接受受支持的分类值，其余视为未提供 */
export function normalizeSkillCategory(value: unknown): string | undefined {
  const v = String(value ?? "").trim().toLowerCase();
  return v && v in SKILL_CATEGORY_LABELS ? v : undefined;
}

export function normalizeSkillTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = value.map((t) => String(t).trim()).filter(Boolean).slice(0, 8);
  return tags.length ? tags : undefined;
}

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  woff: "font/woff",
  woff2: "font/woff2",
  pdf: "application/pdf",
};

export async function serveApp(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  // /apps/<name>/<rest...>（url.pathname 是 percent-encoded，需逐段解码才能命中 deploy_app 写入的 R2 键）
  let parts: string[];
  try {
    parts = url.pathname.replace(/^\/apps\//, "").split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return json({ error: "invalid path encoding" }, 400);
  }
  if (parts.length === 0) return json({ error: "missing app name" }, 400);
  const name = parts[0];
  let rest = parts.slice(1).join("/") || "index.html";
  if (rest.endsWith("/")) rest += "index.html";

  // 边缘缓存：命中则不回源 R2；deploy_app 覆盖部署时按 URL 逐文件失效
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit;

  const obj = await env.APPS_BUCKET.get(`apps/${name}/${rest}`);
  if (!obj) {
    // R2 未托管时回退到仓库内 public/apps/ 静态资源（新应用可不经 deploy_app 直接生效）
    const fallback = await env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
    if (fallback.status === 404) return json({ error: `app file not found: ${name}/${rest}` }, 404);
    const res = new Response(fallback.body, fallback);
    res.headers.set("x-app-source", "assets");
    ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
    return res;
  }
  const ext = rest.split(".").pop()?.toLowerCase() ?? "";
  const res = new Response(obj.body, {
    headers: {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": ext === "html" || ext === "htm" ? "public, max-age=60" : "public, max-age=3600",
      "x-app-source": "r2",
    },
  });
  ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
}

export async function serveSkill(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  // /skills/<name>/SKILL.md
  const m = url.pathname.match(/^\/skills\/([a-z0-9-]+)\/SKILL\.md$/i);
  if (!m) return json({ error: "invalid skill path" }, 400);

  const cacheKey = new Request(url.toString(), { method: "GET" });
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit;

  const obj = await env.APPS_BUCKET.get(`skills/${m[1]}/SKILL.md`);
  if (!obj) return json({ error: "skill not found" }, 404);
  const res = new Response(obj.body, {
    headers: { "content-type": MIME.md, "cache-control": "public, max-age=300" },
  });
  ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
}

// ---------- 注册表（KV） ----------

export async function readIndex<T>(env: Env, key: string): Promise<T[]> {
  const raw = await env.REGISTRY.get(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

/**
 * 应用广场按登录角色过滤（PRD A5 移植自 main）：
 * 未登录 / 名单外（external）仅 visibility=all；在册队员额外可见本组、本角色及本人 authored。
 */
export async function visibleApps(env: Env, request: Request, ctx?: ExecutionContext): Promise<AppEntry[]> {
  const apps = await readIndex<AppEntry>(env, KV_KEYS.appsIndex);
  const session = await resolveSession(env, request, ctx);
  if (!session) return apps.filter((a) => a.visibility === "all");
  const role = await resolveUserRole(env, session.user, ctx);
  if (role.role === "external") return apps.filter((a) => a.visibility === "all");
  return apps.filter(
    (a) =>
      a.visibility === "all" ||
      a.visibility === role.group ||
      a.visibility === role.role ||
      a.author === session.user.name,
  );
}

export async function upsertIndex<T extends { name: string }>(env: Env, key: string, entry: T): Promise<T[]> {
  const list = await readIndex<T>(env, key);
  const i = list.findIndex((e) => e.name === entry.name);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  await env.REGISTRY.put(key, JSON.stringify(list));
  return list;
}

// ---------- 应用广场合并视图（builtin manifest + KV 注册表） ----------

/** 仓内构建子应用的 manifest 条目（web/vite.config.ts 构建期生成 public/apps/builtin.json） */
export interface BuiltinManifestEntry {
  name: string;
  title: string;
  desc?: string;
  icon?: string;
  /** core=核心流程 standalone=独立应用 */
  group?: string;
}

/** /api/apps 输出条目：在注册表 AppEntry 之上标注来源与双版本分歧 */
export interface PortalAppEntry extends AppEntry {
  /** builtin=仓内构建（随 deploy 发布） r2=deploy_app 托管 external=外链登记 */
  source: "builtin" | "r2" | "external";
  group?: string;
  icon?: string;
  /**
   * true = 存在同名仓内内置应用，双版本并存分叉：
   * /apps/<name>/ 由平台资产层直接服务仓内版本（不经 Worker），而独立域名 <name>.<zone> 走 R2 版本。
   * 此时本条目的 url 会被改写为独立域名，确保广场卡片打开的是 R2 版本。
   */
  shadows?: boolean;
}

/** 读仓内 manifest；ASSETS 不可用/文件缺失/解析失败时降级为空列表（不影响注册表展示） */
export async function readBuiltinManifest(env: Env, origin: string): Promise<BuiltinManifestEntry[]> {
  try {
    const res = await env.ASSETS.fetch(new Request(`${origin}/apps/builtin.json`, { method: "GET" }));
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return [];
    const out: BuiltinManifestEntry[] = [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const e = item as Record<string, unknown>;
      const name = String(e.name ?? "");
      if (!name) continue;
      out.push({
        name,
        title: String(e.title ?? name),
        desc: e.desc ? String(e.desc) : undefined,
        icon: e.icon ? String(e.icon) : undefined,
        group: e.group ? String(e.group) : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * GET /api/apps 的合并视图：builtin（visibility 视为 all）在前，注册表（按角色过滤后）在后。
 * 同名 r2 应用与 builtin 并存时标 shadows=true，由前端提示「R2 覆盖中」。
 */
export async function listPortalApps(env: Env, request: Request, ctx?: ExecutionContext): Promise<PortalAppEntry[]> {
  const origin = new URL(request.url).origin;
  const [builtin, registered] = await Promise.all([
    readBuiltinManifest(env, origin),
    visibleApps(env, request, ctx),
  ]);
  const builtinNames = new Set(builtin.map((b) => b.name));
  const builtinEntries: PortalAppEntry[] = builtin.map((b) => ({
    name: b.name,
    title: b.title,
    author: "NEC",
    visibility: "all",
    version: "",
    updatedAt: "",
    url: `/apps/${b.name}/`,
    description: b.desc,
    source: "builtin",
    group: b.group,
    icon: b.icon,
  }));
  const registryEntries: PortalAppEntry[] = registered.map((a) => {
    const shadows = !a.external && builtinNames.has(a.name) ? true : undefined;
    return {
      ...a,
      // 双版本分叉时把 R2 卡片指向独立域名（/apps/<name>/ 由平台资产层服务仓内版本，R2 版只在 <name>.<zone> 可达）
      url: shadows ? `https://${a.name}.${domainZone(env)}/` : a.url,
      source: a.external ? "external" : "r2",
      shadows,
    };
  });
  return [...builtinEntries, ...registryEntries];
}
