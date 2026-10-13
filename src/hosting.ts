/**
 * 应用 / Skill 托管与注册表（KV）
 *
 * /apps/<name>/* 与 /skills/<name>/SKILL.md 从 R2 回源，边缘缓存按 URL 缓存；
 * deploy_app / publish_skill 覆盖写入时按 URL 逐文件失效。
 */

import { json } from "./shared/http";

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
  if (!obj) return json({ error: `app file not found: ${name}/${rest}` }, 404);
  const ext = rest.split(".").pop()?.toLowerCase() ?? "";
  const res = new Response(obj.body, {
    headers: {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": ext === "html" || ext === "htm" ? "public, max-age=60" : "public, max-age=3600",
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

export async function upsertIndex<T extends { name: string }>(env: Env, key: string, entry: T): Promise<T[]> {
  const list = await readIndex<T>(env, key);
  const i = list.findIndex((e) => e.name === entry.name);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  await env.REGISTRY.put(key, JSON.stringify(list));
  return list;
}
