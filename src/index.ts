/**
 * NEC 团队 AI 中台 — 单体 Worker
 * 路由：
 *   GET  /                → 门户静态页（Assets）
 *   GET  /api/health      → 健康检查
 *   GET  /api/apps        → 应用广场注册表（KV）
 *   GET  /api/skills      → Skill 中心注册表（KV）
 *   GET  /api/config      → 公开配置（飞书 App ID 等，供门户登录跳转用）
 *   GET  /api/whoami      → 当前登录用户与角色（session Cookie）
 *   GET  /api/dashboard   → 数据看板聚合（飞书多维表格 + KV 5 分钟缓存；按登录角色脱敏财务区）
 *   POST /auth/feishu     → 飞书 code 兑换用户信息 + 签发中台会话（MES 免登与本门户登录共用）
 *   POST /auth/logout     → 登出（销毁会话）
 *   GET  /api/repos       → NEC 开源仓库列表（GitHub org + KV 1 小时缓存）
 *   GET  /apps/<name>/*   → 队员应用（R2 托管）
 *   GET  /skills/<name>/SKILL.md → Skill 原文（R2）
 *   POST /mcp             → MCP (streamable HTTP, JSON-RPC)
 *
 * 类型：运行 `npx wrangler types` 生成 worker-configuration.d.ts 后，下面的声明合并会把
 * secrets 补到 Cloudflare.Env 上。wrangler.jsonc 变更后请重新生成类型。
 */

// 通过 wrangler secret put 配置的 secrets，wrangler types 不会自动生成。
declare global {
  interface Env {
    /** 设置后，/mcp 写操作需携带 Authorization: Bearer <token>（用 wrangler secret put MCP_TOKEN 配置） */
    MCP_TOKEN?: string;
    /** 飞书自建应用凭证（第二阶段接入 query_bitable 时启用） */
    FEISHU_APP_ID?: string;
    FEISHU_APP_SECRET?: string;
    /** Vercel 同步（sync_vercel 工具用） */
    VERCEL_TOKEN?: string;
    VERCEL_TEAM?: string;
    /** GitHub API（/api/repos 仓库列表用，可选；配置后限额更高） */
    GITHUB_TOKEN?: string;
    /** Gitee API（/api/repos 仓库列表用，可选；匿名 60 次/小时，配置后限额更高） */
    GITEE_TOKEN?: string;
  }
}

interface AppEntry {
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

interface SkillEntry {
  name: string;
  description: string;
  updatedAt: string;
  /** 外部 SKILL.md 链接（如 Gitee 页面）；为空则用本中台 /skills/<name>/SKILL.md */
  url?: string;
  /** 来源标识，如 gitee / hub */
  source?: string;
}

/** 资料页条目（KV key: docs:registry，由 MCP publish_doc 写入） */
interface DocEntry {
  id: string;
  title: string;
  description: string;
  /** 分类：brand=品牌规范 template=文档模板 sop=制度SOP training=培训材料 */
  category: "brand" | "template" | "sop" | "training";
  url: string;
  visibility: string;
  maintainer: string;
  updatedAt: string;
  source: string;
}

/** 数据看板配置（KV key: dashboard:config，由 MCP config_dashboard 写入） */
interface DashboardConfig {
  /** 多维表格 app_token（表格 URL 中 /base/ 之后的一段） */
  base: string;
  /** 逻辑表名 → table_id（tbl 开头） */
  tables: Partial<Record<"members" | "tasks" | "inventory" | "finance", string>>;
  updatedAt: string;
}

import {
  BitableRecord,
  BitableFieldMeta,
  createBitableRecord,
  fieldNum,
  fieldText,
  fieldTs,
  findFieldKey,
  firstFieldText,
  getTenantAccessToken,
  listBitableFields,
  listBitableRecords,
  matchField,
  updateBitableRecord,
} from "./feishu/bitable";

interface TableFetchResult {
  records: BitableRecord[];
  cachedAt: string;
  /** true = 本次刷新失败，返回的是过期缓存 */
  stale?: boolean;
  error?: string;
}

/** NEC 开源仓库条目（/api/repos 返回项，GitHub/Gitee 合并） */
interface RepoEntry {
  host: "github" | "gitee";
  name: string;
  fullName: string;
  url: string;
  description: string;
  stars: number;
  forks: number;
  /** 默认分支提交总数；拉取失败时为 null（GitHub 用 Link 尾页号推断，Gitee 用 total_count 响应头） */
  commits: number | null;
  language: string;
  updatedAt: string;
  pushedAt: string;
  isFork: boolean;
  archived: boolean;
  defaultBranch: string;
}

/** 看板数据缓存 TTL（秒）。方案文档约定：看板类接口 5 分钟级缓存，避免打满飞书免费配额 */
const DASH_CACHE_TTL_SEC = 300;

/** NEC 开源仓库的 GitHub 组织名（/api/repos 数据源之一） */
const GITHUB_ORG = "new-energy-coder-club";

/** NEC 开源仓库的 Gitee 账号（组织无 Gitee 版，用队长账号兜底；/api/repos 数据源之一） */
const GITEE_USER = "darrenpig";

/** 仓库列表缓存 TTL（秒）。两源合计单次刷新约 40+ 次请求（GitHub/Gitee 匿名均 60 次/小时），建议配置 GITHUB_TOKEN / GITEE_TOKEN */
const REPOS_CACHE_TTL_SEC = 3600;

/** 资料页注册表 KV key */
const DOCS_REGISTRY_KEY = "docs:registry";

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

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    console.log(`[nec-hub] ${request.method} ${url.pathname}`);
    try {
      if (url.pathname === "/mcp" && request.method === "POST") {
        return await handleMcp(request, env);
      }
      if (url.pathname === "/auth/feishu") {
        return await handleFeishuAuth(request, env);
      }
      if (url.pathname === "/auth/logout") {
        return await handleLogout(request, env);
      }
      if (url.pathname === "/api/whoami") {
        return await handleWhoami(request, env);
      }
      if (url.pathname === "/api/config") {
        return json({
          feishuAppId: env.FEISHU_APP_ID ?? null,
          loginEnabled: Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET),
        });
      }
      if (url.pathname === "/api/health") {
        return json({ ok: true, service: env.HUB_NAME ?? "nec-hub", time: new Date().toISOString() });
      }
      if (url.pathname === "/api/apps") {
        return json(await readIndex<AppEntry>(env, "apps:index"));
      }
      if (url.pathname === "/api/skills") {
        return json(await readIndex<SkillEntry>(env, "skills:index"));
      }
      if (url.pathname === "/api/docs") {
        return json(await buildDocs(env, request));
      }
      if (url.pathname === "/api/dashboard") {
        return json(await buildDashboard(env, request));
      }
      if (url.pathname.startsWith("/api/drawing-review")) {
        const dr = await import("./drawing-review");
        const res = await dr.handleDrawingReview(request, env, url.pathname);
        if (res) return res;
      }
      if (url.pathname === "/api/reimburse" && request.method === "POST") {
        return await handleReimburse(request, env);
      }
      if (url.pathname === "/api/repos") {
        return json(await buildRepos(env));
      }
      if (url.pathname.startsWith("/apps/")) {
        return await serveApp(url, env);
      }
      if (url.pathname.startsWith("/skills/")) {
        return await serveSkill(url, env);
      }
      return await env.ASSETS.fetch(request);
    } catch (err) {
      console.error(`[nec-hub] ${request.method} ${url.pathname} error:`, err);
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

// ---------- 飞书免登（auth code 兑换用户信息） ----------

const FEISHU_API = "https://open.feishu.cn/open-apis";

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

async function handleFeishuAuth(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request);
  const jsonCors = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", ...cors },
    });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return jsonCors({ error: "method not allowed" }, 405);
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    return jsonCors(
      { error: "飞书自建应用未配置：请先 wrangler secret put FEISHU_APP_ID / FEISHU_APP_SECRET" },
      500,
    );
  }
  const { code } = (await request.json()) as { code?: string };
  if (!code) return jsonCors({ error: "missing code" }, 400);

  // 1. app_access_token（KV 缓存，提前 5 分钟过期）
  const appToken = await getAppAccessToken(env);

  // 2. code → user_access_token
  const tokenResp = await fetch(`${FEISHU_API}/authen/v1/oidc/access_token`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${appToken}`,
    },
    body: JSON.stringify({ grant_type: "authorization_code", code }),
  });
  const tokenData = (await tokenResp.json()) as {
    code?: number;
    msg?: string;
    data?: { access_token?: string };
  };
  const userToken = tokenData.data?.access_token;
  if (tokenData.code !== 0 || !userToken) {
    return jsonCors({ error: `飞书 code 兑换失败：${tokenData.msg ?? "unknown"}（code 可能已过期，请重新登录）` }, 401);
  }

  // 3. 取用户信息
  const userResp = await fetch(`${FEISHU_API}/authen/v1/user_info`, {
    headers: { authorization: `Bearer ${userToken}` },
  });
  const userData = (await userResp.json()) as {
    code?: number;
    msg?: string;
    data?: { name?: string; en_name?: string; open_id?: string; avatar_url?: string };
  };
  if (userData.code !== 0 || !userData.data) {
    return jsonCors({ error: `获取用户信息失败：${userData.msg ?? "unknown"}` }, 502);
  }

  const user: HubUser = {
    name: userData.data.name ?? "",
    open_id: userData.data.open_id ?? "",
    avatar_url: userData.data.avatar_url,
  };
  // 4. 签发中台会话（HttpOnly Cookie；MES 跨域调用不会带上，本门户同源登录生效）
  const sid = await createSession(env, user);

  // 5. 另签发"上次登录"提示 Cookie（非 HttpOnly，前端可读；仅姓名/头像/时间等展示信息）
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", ...cors });
  headers.append("set-cookie", sessionCookie(sid));
  headers.append("set-cookie", lastLoginCookie(user));

  return new Response(
    JSON.stringify({
      name: user.name,
      en_name: userData.data.en_name,
      open_id: user.open_id,
      avatar_url: user.avatar_url,
      session: true,
    }),
    { headers },
  );
}

async function getAppAccessToken(env: Env): Promise<string> {
  const cached = await env.REGISTRY.get("feishu:app_access_token", "json") as
    | { token: string; expireAt: number }
    | null;
  if (cached && cached.expireAt > Date.now()) return cached.token;

  const resp = await fetch(`${FEISHU_API}/auth/v3/app_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const data = (await resp.json()) as { code?: number; msg?: string; app_access_token?: string; expire?: number };
  if (data.code !== 0 || !data.app_access_token) {
    throw new Error(`获取 app_access_token 失败：${data.msg ?? "unknown"}`);
  }
  const expireAt = Date.now() + ((data.expire ?? 7200) - 300) * 1000;
  await env.REGISTRY.put("feishu:app_access_token", JSON.stringify({ token: data.app_access_token, expireAt }));
  return data.app_access_token;
}

// ---------- 会话与角色（FE-01：飞书 OAuth 登录态 + 权限角色） ----------

const SESSION_COOKIE = "nec_session";
/** 会话有效期 7 天；剩余不足一半时滑动续期（sid 轮换，旧 sid 立刻作废） */
const SESSION_TTL_SEC = 7 * 24 * 3600;
/** “记住上次登录”提示 Cookie：非 HttpOnly，前端可读；仅存姓名/头像/时间等展示信息 */
const LAST_LOGIN_COOKIE = "nec_last_login";
/** 提示 Cookie 有效期 30 天；登出时不清除，用于下次打开门户显示"上次登录：某某" */
const LAST_LOGIN_TTL_SEC = 30 * 24 * 3600;
/** 角色解析缓存 TTL（秒）。负结果不入缓存，保证移除队员后下一次请求即失效 */
const ROLE_CACHE_TTL_SEC = 60;

interface HubUser {
  name: string;
  open_id: string;
  avatar_url?: string;
}

interface SessionData extends HubUser {
  createdAt: string;
  expiresAt: number;
}

interface UserRole {
  role: string;
  group: string;
  /** true = 在队员名单表中匹配到该用户 */
  matched: boolean;
}

/** 财务明细可见角色（看板明细与 MCP finance 表查询共用） */
const FINANCE_ROLE_RE = /队长|财务|指导/i;

function parseCookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(sid: string, maxAge = SESSION_TTL_SEC): string {
  return `${SESSION_COOKIE}=${sid}; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}

/** 展示用"上次登录"Cookie：URI 编码的 JSON（name/avatar_url/at），不含任何凭据 */
function lastLoginCookie(user: HubUser): string {
  const payload = encodeURIComponent(
    JSON.stringify({ name: user.name, avatar_url: user.avatar_url ?? "", at: new Date().toISOString() }),
  );
  return `${LAST_LOGIN_COOKIE}=${payload}; Path=/; SameSite=Lax; Secure; Max-Age=${LAST_LOGIN_TTL_SEC}`;
}

async function createSession(env: Env, user: HubUser): Promise<string> {
  const sid = crypto.randomUUID();
  const data: SessionData = {
    ...user,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + SESSION_TTL_SEC * 1000,
  };
  await env.REGISTRY.put(`session:${sid}`, JSON.stringify(data), { expirationTtl: SESSION_TTL_SEC });
  return sid;
}

/** 解析会话；滑动续期时返回 renewed（调用方需把新 sid 写回 Cookie） */
async function resolveSession(env: Env, request: Request): Promise<{ user: HubUser; renewed?: string } | null> {
  const sid = parseCookies(request)[SESSION_COOKIE];
  if (!sid) return null;
  const raw = await env.REGISTRY.get(`session:${sid}`);
  if (!raw) return null;
  let data: SessionData;
  try {
    data = JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
  if (!data.open_id || data.expiresAt <= Date.now()) {
    await env.REGISTRY.delete(`session:${sid}`);
    return null;
  }
  const user: HubUser = { name: data.name, open_id: data.open_id, avatar_url: data.avatar_url };
  if (data.expiresAt - Date.now() < (SESSION_TTL_SEC * 1000) / 2) {
    const sid2 = crypto.randomUUID();
    await env.REGISTRY.put(
      `session:${sid2}`,
      JSON.stringify({ ...data, expiresAt: Date.now() + SESSION_TTL_SEC * 1000 }),
      { expirationTtl: SESSION_TTL_SEC },
    );
    await env.REGISTRY.delete(`session:${sid}`);
    return { user, renewed: sid2 };
  }
  return { user };
}

async function destroySession(env: Env, request: Request): Promise<void> {
  const sid = parseCookies(request)[SESSION_COOKIE];
  if (sid) await env.REGISTRY.delete(`session:${sid}`);
}

/** 校验飞书 user_access_token，返回 open_id（无效则抛错） */
async function validateUserToken(userToken: string): Promise<string> {
  const resp = await fetch(`${FEISHU_API}/authen/v1/user_info`, {
    headers: { authorization: `Bearer ${userToken}` },
  });
  const data = (await resp.json()) as { code?: number; msg?: string; data?: { open_id?: string } };
  if (data.code !== 0 || !data.data?.open_id) {
    throw new Error(`user_token 校验失败：${data.msg ?? "invalid token"}`);
  }
  return data.data.open_id;
}

/**
 * 按"队员名单"表解析用户角色（表配置来自 config_dashboard 的 members 表）。
 * 表未配置/读取失败 → 默认"队员"（不锁死登录）；在表中未匹配 → "external"（仅公开区）。
 */
async function resolveUserRole(env: Env, user: HubUser): Promise<UserRole> {
  const cacheKey = `role:${user.open_id}`;
  const cached = await env.REGISTRY.get(cacheKey, "json") as UserRole | null;
  if (cached) return cached;
  const role = await lookupRoleFresh(env, user);
  if (role.matched) {
    await env.REGISTRY.put(cacheKey, JSON.stringify(role), { expirationTtl: ROLE_CACHE_TTL_SEC });
  } else {
    await env.REGISTRY.delete(cacheKey); // 负结果即时生效
  }
  return role;
}

async function lookupRoleFresh(env: Env, user: HubUser): Promise<UserRole> {
  const cfg = await getDashboardConfig(env);
  const tableId = cfg?.tables?.members;
  if (!cfg || !tableId) return { role: "队员", group: "", matched: false };
  let records: BitableRecord[];
  try {
    const token = await getTenantAccessToken(env);
    records = await listBitableRecords(token, cfg.base, tableId);
  } catch {
    return { role: "队员", group: "", matched: false };
  }
  const roleKey = findFieldKey(records, [/权限角色/, /角色/, /role/i]);
  const groupKey = findFieldKey(records, [/^组别/, /组别/, /小组/, /部门/, /group/i]);
  const rec = matchMemberRecord(records, user);
  if (!rec) return { role: "external", group: "", matched: false };
  return {
    role: (roleKey ? fieldText(rec.fields[roleKey]) : "") || "队员",
    group: groupKey ? fieldText(rec.fields[groupKey]) : "",
    matched: true,
  };
}

/** 在名单表记录里定位当前用户：优先 open_id 精确匹配，其次姓名精确匹配 */
function matchMemberRecord(records: BitableRecord[], user: HubUser): BitableRecord | null {
  const idKeys = new Set<string>();
  const nameKeys = new Set<string>();
  for (const r of records.slice(0, 300)) {
    for (const k of Object.keys(r.fields ?? {})) {
      if (/open_?id|飞书/i.test(k)) idKeys.add(k);
      else if (/^姓名$|姓名|名字|^name$/i.test(k)) nameKeys.add(k);
    }
  }
  for (const r of records) {
    for (const k of idKeys) {
      if (fieldText(r.fields[k]) === user.open_id) return r;
    }
  }
  if (user.name) {
    for (const r of records) {
      for (const k of nameKeys) {
        if (fieldText(r.fields[k]) === user.name) return r;
      }
    }
  }
  return null;
}

function canSeeFinanceDetail(role: UserRole): boolean {
  return FINANCE_ROLE_RE.test(role.role);
}

// ---------- 登录态 HTTP 处理器 ----------

async function handleWhoami(request: Request, env: Env): Promise<Response> {
  const s = await resolveSession(env, request);
  if (!s) return json({ authenticated: false, user: null });
  const role = await resolveUserRole(env, s.user);
  const res = json({ authenticated: true, user: { ...s.user, ...role } });
  if (s.renewed) res.headers.set("set-cookie", sessionCookie(s.renewed));
  return res;
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  await destroySession(env, request);
  const res = json({ ok: true });
  res.headers.set("set-cookie", sessionCookie("", 0));
  return res;
}

// ---------- 应用 / Skill 托管 ----------

async function serveApp(url: URL, env: Env): Promise<Response> {
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
  const obj = await env.APPS_BUCKET.get(`apps/${name}/${rest}`);
  if (!obj) return json({ error: `app file not found: ${name}/${rest}` }, 404);
  const ext = rest.split(".").pop()?.toLowerCase() ?? "";
  return new Response(obj.body, {
    headers: {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": "no-cache",
    },
  });
}

async function serveSkill(url: URL, env: Env): Promise<Response> {
  // /skills/<name>/SKILL.md
  const m = url.pathname.match(/^\/skills\/([a-z0-9-]+)\/SKILL\.md$/i);
  if (!m) return json({ error: "invalid skill path" }, 400);
  const obj = await env.APPS_BUCKET.get(`skills/${m[1]}/SKILL.md`);
  if (!obj) return json({ error: "skill not found" }, 404);
  return new Response(obj.body, { headers: { "content-type": MIME.md } });
}

// ---------- 注册表（KV） ----------

async function readIndex<T>(env: Env, key: string): Promise<T[]> {
  const raw = await env.REGISTRY.get(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

async function upsertIndex<T extends { name: string }>(env: Env, key: string, entry: T): Promise<T[]> {
  const list = await readIndex<T>(env, key);
  const i = list.findIndex((e) => e.name === entry.name);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  await env.REGISTRY.put(key, JSON.stringify(list));
  return list;
}

// ---------- MCP (JSON-RPC over streamable HTTP) ----------

const TOOLS = [
  {
    name: "deploy_app",
    description:
      "把一个 Vibe Coding 的静态应用部署到 NEC 团队中台应用广场。文件会上传到团队 R2，访问路径为 /apps/<name>/（入口默认 index.html）。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "应用名，小写字母/数字/连字符，如 inventory-check" },
        title: { type: "string", description: "展示名称，如 物资盘点助手" },
        author: { type: "string", description: "作者（队员姓名）" },
        visibility: { type: "string", description: "可见范围：all 或组别名，默认 all" },
        version: { type: "string", description: "版本号，默认 0.1.0" },
        files: {
          type: "array",
          description: "静态文件列表（HTML/CSS/JS 等）",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "相对路径，如 index.html、style.css" },
              text: { type: "string", description: "UTF-8 文本内容（与 base64 二选一）" },
              base64: { type: "string", description: "base64 内容（二进制文件用）" },
            },
            required: ["path"],
          },
        },
      },
      required: ["name", "files"],
    },
  },
  {
    name: "register_app",
    description:
      "把一个已经部署在其他地方的 Web 应用（外部链接）登记到 NEC 团队应用广场。适用于已有独立域名的应用，无需上传文件。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "应用名，小写字母/数字/连字符，如 mes-warehouse" },
        title: { type: "string", description: "展示名称，如 NEC 仓库作业台" },
        author: { type: "string", description: "作者（队员姓名）" },
        url: { type: "string", description: "应用的完整外部链接，https://..." },
        visibility: { type: "string", description: "可见范围：all 或组别名，默认 all" },
        version: { type: "string", description: "版本号，默认 1.0.0" },
      },
      required: ["name", "url"],
    },
  },
  {
    name: "sync_vercel",
    description:
      "从 Vercel 团队空间自动发现项目并登记到应用广场（外链）。默认只预览差异，confirm=true 才实际写入。需在 Worker 配置 VERCEL_TOKEN。",
    inputSchema: {
      type: "object",
      properties: {
        confirm: { type: "boolean", description: "true 时实际写入注册表；缺省只预览" },
        exclude: { type: "array", items: { type: "string" }, description: "额外排除的项目名" },
        team: { type: "string", description: "Vercel 团队 slug，默认 necc" },
      },
    },
  },
  {
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
            },
            required: ["name"],
          },
        },
        source: { type: "string", description: "来源标识，如 gitee，默认 external" },
      },
      required: ["skills"],
    },
  },
  {
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
  },
  {
    name: "publish_skill",
    description: "把一个 SKILL.md 上架到 NEC 团队 Skill 中心，供其他队员一键安装到自己的 Agent。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill 名，小写连字符，如 nec-tech-report" },
        description: { type: "string", description: "一句话描述" },
        content: { type: "string", description: "SKILL.md 完整 Markdown 内容" },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "query_bitable",
    description:
      "只读查询飞书多维表格（队员名单/任务进度/物资台账/财务报销）。需先用 config_dashboard 配置 base 与 table_id，也可在调用时显式传 app_token/table_id 查询任意表格。finance 表受限：需管理端（MCP_TOKEN）或有效 user_token（角色为队长/财务）。",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "表名：members | tasks | inventory | finance" },
        filter: { type: "string", description: "可选：对整条记录做不区分大小写的包含匹配" },
        limit: { type: "number", description: "返回条数上限，默认 20，最大 100" },
        app_token: { type: "string", description: "可选：覆盖配置，直接指定多维表格 app_token" },
        table_id: { type: "string", description: "可选：覆盖配置，直接指定 table_id（tbl 开头）" },
        user_token: { type: "string", description: "可选：飞书 user_access_token；查询 finance 表时必填（角色需为队长/财务）" },
      },
      required: ["table"],
    },
  },
  {
    name: "config_dashboard",
    description:
      "配置/查看数据看板对接的飞书多维表格。action=set 写入 base（app_token）与 tables（逻辑表名→table_id），action=get 查看当前配置。写入后自动清空看板缓存。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "get（默认）| set" },
        base: { type: "string", description: "set 时必填：多维表格 app_token（URL 中 /base/ 后的一段）" },
        tables: {
          type: "object",
          description: "set 时必填：如 {\"tasks\":\"tblxxxx\",\"inventory\":\"tblxxxx\"}",
          properties: {
            members: { type: "string", description: "队员名单表 table_id" },
            tasks: { type: "string", description: "任务进度表 table_id" },
            inventory: { type: "string", description: "物资台账表 table_id" },
            finance: { type: "string", description: "财务报销表 table_id" },
          },
        },
      },
    },
  },
  {
    name: "config_drawing_review",
    description:
      "配置/查看新增机图纸评审流程对接的飞书多维表格。action=set 写入 base（app_token）与 tables（逻辑表名→table_id），action=get 查看当前配置。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "get（默认）| set" },
        base: { type: "string", description: "set 时必填：多维表格 app_token（URL 中 /base/ 后的一段）" },
        tables: {
          type: "object",
          description: "set 时必填：如 {\"reviews\":\"tblxxxx\",\"minutes\":\"tblxxxx\"}",
          properties: {
            reviews: { type: "string", description: "图纸评审单表 table_id" },
            minutes: { type: "string", description: "会议纪要表 table_id" },
            rectifications: { type: "string", description: "整改项表 table_id" },
            bom: { type: "string", description: "BOM 清单表 table_id" },
            assessments: { type: "string", description: "评估报告表 table_id" },
            inventory: { type: "string", description: "库存查询结果表 table_id" },
            delivery: { type: "string", description: "发货清单表 table_id" },
            schedule: { type: "string", description: "排期任务表 table_id" },
            inquiries: { type: "string", description: "询价单表 table_id" },
            events: { type: "string", description: "流程事件日志表 table_id" },
          },
        },
      },
    },
  },
  {
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
  },
];

async function handleMcp(request: Request, env: Env): Promise<Response> {
  let hasMcpToken = false;
  if (env.MCP_TOKEN) {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    hasMcpToken = await timingSafeEqual(token, env.MCP_TOKEN);
    if (!hasMcpToken) {
      return json({ error: "unauthorized" }, 401);
    }
  } else {
    // 未配置 MCP_TOKEN 时写操作本就对全网开放，财务门禁随之放行（生产环境建议配置 MCP_TOKEN）
    hasMcpToken = true;
  }
  const msg = (await request.json()) as {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
  };
  const id = msg.id ?? null;
  switch (msg.method) {
    case "initialize":
      return rpc(id, {
        protocolVersion: (msg.params?.protocolVersion as string) ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "nec-hub-mcp", version: "0.2.0" },
        instructions:
          "NEC 团队 AI 中台 MCP。deploy_app 部署静态应用到应用广场；publish_skill 上架 Skill；config_dashboard 配置数据看板对接的飞书多维表格；query_bitable 查询多维表格数据（finance 表需 user_token 且角色为队长/财务，或管理端 MCP_TOKEN）。",
      });
    case "ping":
      return rpc(id, {});
    case "notifications/initialized":
      return new Response(null, { status: 202 });
    case "tools/list":
      return rpc(id, { tools: TOOLS });
    case "tools/call":
      return await callTool(id, msg.params ?? {}, env, request, hasMcpToken);
    default:
      return rpcError(id, -32601, `Method not found: ${String(msg.method)}`);
  }
}

async function callTool(
  id: string | number | null,
  params: Record<string, unknown>,
  env: Env,
  request: Request,
  hasMcpToken: boolean,
): Promise<Response> {
  const name = params.name as string;
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "deploy_app":
        return rpc(id, await toolDeployApp(args, env, request));
      case "register_app":
        return rpc(id, await toolRegisterApp(args, env));
      case "sync_vercel":
        return rpc(id, await toolSyncVercel(args, env));
      case "import_skills":
        return rpc(id, await toolImportSkills(args, env));
      case "remove_skills":
        return rpc(id, await toolRemoveSkills(args, env));
      case "publish_skill":
        return rpc(id, await toolPublishSkill(args, env));
      case "query_bitable":
        return rpc(id, await toolQueryBitable(args, env, hasMcpToken));
      case "config_dashboard":
        return rpc(id, await toolConfigDashboard(args, env));
      case "config_drawing_review":
        return rpc(id, await toolConfigDrawingReview(args, env));
      case "publish_doc":
        return rpc(id, await toolPublishDoc(args, env));
      default:
        return rpcError(id, -32602, `Unknown tool: ${name}`);
    }
  } catch (err) {
    return rpc(id, {
      content: [{ type: "text", text: `执行失败：${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    });
  }
}

async function toolDeployApp(args: Record<string, unknown>, env: Env, request: Request) {
  const appName = String(args.name ?? "");
  if (!NAME_RE.test(appName)) {
    throw new Error("应用名不合法：仅允许小写字母/数字/连字符（2-41 字符），如 inventory-check");
  }
  const files = (args.files ?? []) as Array<{ path?: string; text?: string; base64?: string }>;
  if (!Array.isArray(files) || files.length === 0) throw new Error("files 不能为空");
  if (files.length > 100) throw new Error("单次最多上传 100 个文件");
  if (!files.some((f) => f.path === "index.html")) {
    throw new Error("必须包含入口文件 index.html");
  }
  for (const f of files) {
    const p = String(f.path ?? "");
    if (!p || p.includes("..") || p.startsWith("/")) throw new Error(`非法文件路径：${p}`);
    let body: string | Uint8Array;
    if (typeof f.text === "string") body = f.text;
    else if (typeof f.base64 === "string") body = base64ToBytes(f.base64);
    else throw new Error(`文件 ${p} 缺少 text 或 base64 内容`);
    await env.APPS_BUCKET.put(`apps/${appName}/${p}`, body);
  }
  const origin = new URL(request.url).origin;
  const entry: AppEntry = {
    name: appName,
    title: String(args.title ?? appName),
    author: String(args.author ?? "未知"),
    visibility: String(args.visibility ?? "all"),
    version: String(args.version ?? "0.1.0"),
    updatedAt: new Date().toISOString(),
    url: `${origin}/apps/${appName}/`,
  };
  const list = await upsertIndex(env, "apps:index", entry);
  return {
    content: [
      {
        type: "text",
        text: `✅ 应用已上架：${entry.title}\n访问链接：${entry.url}\n共上传 ${files.length} 个文件，应用广场现有 ${list.length} 个应用。`,
      },
    ],
  };
}

async function toolRegisterApp(args: Record<string, unknown>, env: Env) {
  const appName = String(args.name ?? "");
  if (!NAME_RE.test(appName)) {
    throw new Error("应用名不合法：仅允许小写字母/数字/连字符（2-41 字符），如 mes-warehouse");
  }
  const url = String(args.url ?? "");
  if (!/^https?:\/\/.+/.test(url)) throw new Error("url 必须是 http(s) 完整链接");
  const entry: AppEntry = {
    name: appName,
    title: String(args.title ?? appName),
    author: String(args.author ?? "未知"),
    visibility: String(args.visibility ?? "all"),
    version: String(args.version ?? "1.0.0"),
    updatedAt: new Date().toISOString(),
    url,
    external: true,
  };
  const list = await upsertIndex(env, "apps:index", entry);
  return {
    content: [
      {
        type: "text",
        text: `✅ 外部应用已登记：${entry.title}\n访问链接：${entry.url}\n应用广场现有 ${list.length} 个应用。`,
      },
    ],
  };
}

/** sync_vercel 默认排除：临时/备份项目（可用 exclude 参数追加） */
const VERCEL_DEFAULT_EXCLUDE = ["dist", "newenergycoder.club-satble", "solarglyph"];
const VERCEL_DEFAULT_EXCLUDE_PREFIX = ["trae_"];

async function toolSyncVercel(args: Record<string, unknown>, env: Env) {
  if (!env.VERCEL_TOKEN) {
    return {
      content: [
        { type: "text", text: "⚠️ 未配置 VERCEL_TOKEN。请运行 wrangler secret put VERCEL_TOKEN 后重试。" },
      ],
    };
  }
  const team = String(args.team ?? env.VERCEL_TEAM ?? "necc");
  const confirm = args.confirm === true;
  const extraExclude = Array.isArray(args.exclude) ? args.exclude.map(String) : [];
  const excluded = new Set([...VERCEL_DEFAULT_EXCLUDE, ...extraExclude]);

  const headers = { authorization: `Bearer ${env.VERCEL_TOKEN}` };
  const listResp = await fetch(`https://api.vercel.com/v9/projects?slug=${encodeURIComponent(team)}&limit=100`, { headers });
  const listData = (await listResp.json()) as { projects?: Array<{ name?: string }>; error?: { message?: string } };
  if (!listResp.ok || !listData.projects) {
    throw new Error(`Vercel API 错误：${listData.error?.message ?? listResp.status}`);
  }

  const registry = await readIndex<AppEntry>(env, "apps:index");
  const existingHosts = new Set(
    registry.map((a) => { try { return new URL(a.url).host; } catch { return ""; } }),
  );
  const existingNames = new Set(registry.map((a) => a.name));

  const plan: Array<{ name: string; url: string; action: string }> = [];
  for (const p of listData.projects) {
    const name = p.name ?? "";
    if (!name) continue;
    if (excluded.has(name) || VERCEL_DEFAULT_EXCLUDE_PREFIX.some((pre) => name.startsWith(pre))) {
      plan.push({ name, url: "-", action: "skip: 排除名单" });
      continue;
    }
    if (existingNames.has(name)) {
      plan.push({ name, url: "-", action: "skip: 已在广场" });
      continue;
    }
    // 取项目生产域名：targets.production.alias，优先非 vercel.app 的自定义域名
    let url = `https://${name}.vercel.app`;
    try {
      const dResp = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(name)}?slug=${encodeURIComponent(team)}`, { headers });
      const detail = (await dResp.json()) as { targets?: { production?: { alias?: string[] } } };
      const domains = detail.targets?.production?.alias ?? [];
      const custom = domains.find((d) => !d.endsWith(".vercel.app"));
      if (custom) url = `https://${custom}`;
      else if (domains.length > 0) url = `https://${domains[0]}`;
    } catch { /* 详情失败则用默认 vercel.app 域名 */ }

    const host = new URL(url).host;
    if (existingHosts.has(host)) {
      plan.push({ name, url, action: "skip: 同域名已收录" });
      continue;
    }
    plan.push({ name, url, action: confirm ? "registered" : "would register" });
    if (confirm) {
      await upsertIndex(env, "apps:index", {
        name,
        title: name,
        author: "Vercel 同步",
        visibility: "all",
        version: "1.0.0",
        updatedAt: new Date().toISOString(),
        url,
        external: true,
      });
    }
  }

  const lines = plan.map((p) => `- ${p.action === "registered" || p.action === "would register" ? "➕" : "⏭️"} ${p.name} → ${p.url}（${p.action}）`);
  const newCount = plan.filter((p) => p.action === "registered" || p.action === "would register").length;
  return {
    content: [
      {
        type: "text",
        text: `${confirm ? "✅ 已同步" : "🔍 预览（confirm=true 才会写入）"}：Vercel 团队 ${team} 共 ${listData.projects.length} 个项目，新增 ${newCount} 个\n\n${lines.join("\n")}`,
      },
    ],
  };
}

async function toolImportSkills(args: Record<string, unknown>, env: Env) {
  const skills = (args.skills ?? []) as Array<{ name?: string; description?: string; url?: string }>;
  if (!Array.isArray(skills) || skills.length === 0) throw new Error("skills 不能为空");
  if (skills.length > 200) throw new Error("单次最多导入 200 个");
  const source = String(args.source ?? "external");
  const list = await readIndex<SkillEntry>(env, "skills:index");
  const byName = new Map(list.map((s) => [s.name, s]));
  let added = 0, updated = 0, skipped = 0;
  for (const s of skills) {
    const name = String(s.name ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!NAME_RE.test(name)) { skipped++; continue; }
    const existing = byName.get(name);
    if (existing && existing.source === "hub") { skipped++; continue; } // 不覆盖中台自托管的 Skill
    const entry: SkillEntry = {
      name,
      description: String(s.description ?? existing?.description ?? ""),
      url: s.url ? String(s.url) : existing?.url,
      source,
      updatedAt: new Date().toISOString(),
    };
    if (existing) { byName.set(name, entry); updated++; }
    else { byName.set(name, entry); added++; }
  }
  await env.REGISTRY.put("skills:index", JSON.stringify([...byName.values()]));
  return {
    content: [
      {
        type: "text",
        text: `✅ 批量导入完成（来源：${source}）：新增 ${added}，更新 ${updated}，跳过 ${skipped}。Skill 中心现有 ${byName.size} 个。`,
      },
    ],
  };
}

async function toolRemoveSkills(args: Record<string, unknown>, env: Env) {
  const names = new Set(((args.names ?? []) as unknown[]).map((n) => String(n)));
  if (names.size === 0) throw new Error("names 不能为空");
  const list = await readIndex<SkillEntry>(env, "skills:index");
  const kept: SkillEntry[] = [];
  let removed = 0;
  const protectedNames: string[] = [];
  for (const s of list) {
    if (names.has(s.name)) {
      if (s.source === "hub" || (!s.source && !s.url)) { protectedNames.push(s.name); kept.push(s); }
      else removed++;
    } else kept.push(s);
  }
  await env.REGISTRY.put("skills:index", JSON.stringify(kept));
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

async function toolPublishSkill(args: Record<string, unknown>, env: Env) {
  const skillName = String(args.name ?? "");
  if (!NAME_RE.test(skillName)) throw new Error("Skill 名不合法：小写字母/数字/连字符");
  const content = String(args.content ?? "");
  if (!content.includes("---")) throw new Error("content 看起来不是合法的 SKILL.md（缺少 frontmatter）");
  await env.APPS_BUCKET.put(`skills/${skillName}/SKILL.md`, content);
  const entry: SkillEntry = {
    name: skillName,
    description: String(args.description ?? ""),
    source: "hub", // 标记为中台自托管，import_skills 同步外部来源时不覆盖
    updatedAt: new Date().toISOString(),
  };
  const list = await upsertIndex(env, "skills:index", entry);
  return {
    content: [
      {
        type: "text",
        text: `✅ Skill 已上架：${skillName}\nSkill 中心现有 ${list.length} 个 Skill。`,
      },
    ],
  };
}

const DASH_TABLES = ["members", "tasks", "inventory", "finance"] as const;
type DashTable = (typeof DASH_TABLES)[number];

async function toolQueryBitable(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  const table = String(args.table ?? "") as DashTable;
  if (!DASH_TABLES.includes(table)) {
    throw new Error("table 必须是 members | tasks | inventory | finance 之一");
  }
  // finance 表按角色受限：管理端（持 MCP_TOKEN）或持有效 user_token 且角色为队长/财务
  if (table === "finance" && !hasMcpToken) {
    const userToken = String(args.user_token ?? "").trim();
    if (!userToken) {
      throw new Error("finance 表受限：请提供 user_token（飞书 user_access_token，角色需为队长/财务），或由配置了 MCP_TOKEN 的管理端调用");
    }
    const openId = await validateUserToken(userToken);
    const role = await resolveUserRole(env, { name: "", open_id: openId });
    if (!canSeeFinanceDetail(role)) {
      throw new Error(`权限不足：finance 表仅队长/财务角色可查（当前角色：${role.role}）`);
    }
  }
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    return {
      content: [
        {
          type: "text",
          text: "⚠️ 飞书自建应用尚未配置（FEISHU_APP_ID / FEISHU_APP_SECRET）。请按 docs/飞书免登接入_MES.md 创建企业自建应用并 wrangler secret put 配置后重试。",
        },
      ],
    };
  }
  const cfg = await getDashboardConfig(env);
  const appToken = String(args.app_token ?? cfg?.base ?? "");
  const tableId = String(args.table_id ?? cfg?.tables?.[table] ?? "");
  if (!appToken || !tableId) {
    return {
      content: [
        {
          type: "text",
          text: `⚠️ 尚未配置 ${table} 表。两种方式任选：\n1. 调用 config_dashboard（action=set）写入 base 与 tables.${table}；\n2. 本次调用显式传 app_token + table_id。`,
        },
      ],
    };
  }
  const token = await getTenantAccessToken(env);
  const records = await listBitableRecords(token, appToken, tableId);
  const filter = String(args.filter ?? "").trim().toLowerCase();
  const matched = filter
    ? records.filter((r) => JSON.stringify(r.fields).toLowerCase().includes(filter))
    : records;
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
  return {
    content: [
      {
        type: "text",
        text:
          `表 ${table} 共 ${matched.length} 条匹配记录（展示前 ${Math.min(limit, matched.length)} 条）：\n` +
          JSON.stringify(matched.slice(0, limit).map((r) => r.fields), null, 2),
      },
    ],
  };
}

async function toolConfigDashboard(args: Record<string, unknown>, env: Env) {
  const action = String(args.action ?? "get");
  if (action === "get") {
    const cfg = await getDashboardConfig(env);
    return {
      content: [
        {
          type: "text",
          text: cfg
            ? `当前看板配置：\n${JSON.stringify(cfg, null, 2)}`
            : "尚未配置。用 action=set 写入：base = 多维表格 app_token（URL 中 /base/ 后的一段），tables = 逻辑表名到 table_id 的映射。",
        },
      ],
    };
  }
  if (action !== "set") throw new Error("action 必须是 get | set");

  const base = String(args.base ?? "").trim();
  if (!/^[A-Za-z0-9]{10,}$/.test(base)) {
    throw new Error("base 不合法：应为飞书多维表格 URL 中 /base/ 后的 app_token（10 位以上字母数字串）");
  }
  const rawTables = (args.tables ?? {}) as Record<string, unknown>;
  const tables: DashboardConfig["tables"] = {};
  for (const key of DASH_TABLES) {
    const v = String(rawTables[key] ?? "").trim();
    if (v) {
      if (!/^tbl[A-Za-z0-9]+$/.test(v)) {
        throw new Error(`table_id 不合法（${key}）：应以 tbl 开头，如 tblsH8aOxxx`);
      }
      tables[key] = v;
    }
  }
  if (Object.keys(tables).length === 0) {
    throw new Error("tables 至少提供一张表：members / tasks / inventory / finance → table_id");
  }
  const cfg: DashboardConfig = { base, tables, updatedAt: new Date().toISOString() };
  await env.REGISTRY.put("dashboard:config", JSON.stringify(cfg));
  // 配置变更后清掉旧缓存，让下一次读取拉最新数据
  await Promise.all(DASH_TABLES.map((k) => env.REGISTRY.delete(`dashboard:cache:${k}`)));
  return {
    content: [
      {
        type: "text",
        text: `✅ 数据看板配置已保存：base=${base}，共 ${Object.keys(tables).length} 张表（${Object.keys(tables).join(" / ")}）。\n打开门户「数据看板」Tab 或 GET /api/dashboard 验证渲染。`,
      },
    ],
  };
}

// ---------- 新增机图纸评审流程配置 ----------

const DRAWING_REVIEW_TABLES = [
  "reviews",
  "minutes",
  "rectifications",
  "bom",
  "assessments",
  "inventory",
  "delivery",
  "schedule",
  "inquiries",
  "events",
] as const;

type DrawingReviewTableName = (typeof DRAWING_REVIEW_TABLES)[number];

async function toolConfigDrawingReview(args: Record<string, unknown>, env: Env) {
  const action = String(args.action ?? "get");
  if (action === "get") {
    const cfg = await (await import("./drawing-review/config")).getDrawingReviewConfig(env);
    return {
      content: [
        {
          type: "text",
          text: cfg
            ? `当前新增机图纸评审流程配置：\n${JSON.stringify(cfg, null, 2)}`
            : "尚未配置。用 action=set 写入：base = 多维表格 app_token（URL 中 /base/ 后的一段），tables = 逻辑表名到 table_id 的映射。",
        },
      ],
    };
  }
  if (action !== "set") throw new Error("action 必须是 get | set");

  const base = String(args.base ?? "").trim();
  if (!/^[A-Za-z0-9]{10,}$/.test(base)) {
    throw new Error("base 不合法：应为飞书多维表格 URL 中 /base/ 后的 app_token（10 位以上字母数字串）");
  }
  const rawTables = (args.tables ?? {}) as Record<string, unknown>;
  const tables: Partial<Record<DrawingReviewTableName, string>> = {};
  for (const key of DRAWING_REVIEW_TABLES) {
    const v = String(rawTables[key] ?? "").trim();
    if (v) {
      if (!/^tbl[A-Za-z0-9]+$/.test(v)) {
        throw new Error(`table_id 不合法（${key}）：应以 tbl 开头，如 tblsH8aOxxx`);
      }
      tables[key] = v;
    }
  }
  if (Object.keys(tables).length === 0) {
    throw new Error("tables 至少提供一张表：reviews / minutes / rectifications / bom / ... → table_id");
  }
  const { setDrawingReviewConfig } = await import("./drawing-review/config");
  const cfg = await setDrawingReviewConfig(env, { base, tables });
  return {
    content: [
      {
        type: "text",
        text: `✅ 新增机图纸评审流程配置已保存：base=${base}，共 ${Object.keys(tables).length} 张表（${Object.keys(tables).join(" / ")}）。\n可调用 GET /api/drawing-review/config 或继续调用 API 验证。`,
      },
    ],
  };
}

// ---------- 资料页（publish_doc） ----------

async function toolPublishDoc(args: Record<string, unknown>, env: Env) {
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

// ---------- NEC 开源仓库（GitHub org + KV 缓存） ----------

async function buildRepos(env: Env): Promise<unknown> {
  const cacheKey = "repos:cache:v2";
  const legacyKey = "repos:cache";
  const cached = await env.REGISTRY.get(cacheKey, "json") as
    | { data: RepoEntry[]; cachedAt: number }
    | null;
  if (cached && cached.cachedAt > Date.now() - REPOS_CACHE_TTL_SEC * 1000) {
    return { github: GITHUB_ORG, gitee: GITEE_USER, cachedAt: new Date(cached.cachedAt).toISOString(), repos: cached.data };
  }
  try {
    const repos = await fetchAllRepos(env);
    await env.REGISTRY.put(cacheKey, JSON.stringify({ data: repos, cachedAt: Date.now() }));
    await env.REGISTRY.delete(legacyKey); // 清理单源时代的旧缓存
    return { github: GITHUB_ORG, gitee: GITEE_USER, cachedAt: new Date().toISOString(), repos };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (cached) {
      return {
        github: GITHUB_ORG,
        gitee: GITEE_USER,
        cachedAt: new Date(cached.cachedAt).toISOString(),
        stale: true,
        error: `${msg}（展示缓存快照）`,
        repos: cached.data,
      };
    }
    return { github: GITHUB_ORG, gitee: GITEE_USER, repos: [], error: msg };
  }
}

/** 双源拉取合并：单源失败不阻断另一源；双源均失败才抛错走缓存降级 */
async function fetchAllRepos(env: Env): Promise<RepoEntry[]> {
  const [gh, gj] = await Promise.allSettled([fetchOrgRepos(env), fetchGiteeRepos(env)]);
  const repos = [
    ...(gh.status === "fulfilled" ? gh.value : []),
    ...(gj.status === "fulfilled" ? gj.value : []),
  ];
  if (gh.status === "rejected" && gj.status === "rejected") {
    const reason = (p: PromiseRejectedResult) => (p.reason instanceof Error ? p.reason.message : String(p.reason));
    throw new Error(`GitHub 与 Gitee 均拉取失败：${reason(gh as PromiseRejectedResult)}`);
  }
  return repos.sort((a, b) => b.stars - a.stars || b.forks - a.forks || a.name.localeCompare(b.name));
}

async function fetchOrgRepos(env: Env): Promise<RepoEntry[]> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "nec-hub",
    "x-github-api-version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;

  const listResp = await fetch(
    `https://api.github.com/orgs/${GITHUB_ORG}/repos?per_page=100&type=public`,
    { headers },
  );
  if (!listResp.ok) {
    const body = await listResp.text().catch(() => "");
    throw new Error(`GitHub API 错误：HTTP ${listResp.status} ${body.slice(0, 200)}`);
  }
  const list = (await listResp.json()) as Array<{
    name: string;
    full_name: string;
    html_url: string;
    description: string | null;
    stargazers_count: number;
    forks_count: number;
    language: string | null;
    updated_at: string;
    pushed_at: string;
    fork: boolean;
    archived: boolean;
    default_branch: string;
  }>;

  // 逐仓库取默认分支提交总数；单仓库失败不阻断整表
  const repos = await Promise.all(
    list.map(async (r): Promise<RepoEntry> => {
      let commits = 0;
      try {
        commits = await fetchCommitCount(r.full_name, r.default_branch, headers);
      } catch { /* 该仓库提交数记 0 */ }
      return {
        host: "github",
        name: r.name,
        fullName: r.full_name,
        url: r.html_url,
        description: r.description ?? "",
        stars: r.stargazers_count,
        forks: r.forks_count,
        commits,
        language: r.language ?? "",
        updatedAt: r.updated_at,
        pushedAt: r.pushed_at,
        isFork: r.fork,
        archived: r.archived,
        defaultBranch: r.default_branch,
      };
    }),
  );
  return repos.sort((a, b) => b.stars - a.stars || b.forks - a.forks || a.name.localeCompare(b.name));
}

/** GET /repos/{full}/commits?per_page=1 时，Link 头的尾页号即提交总数；无 Link 头按返回条数计 */
async function fetchCommitCount(
  fullName: string,
  branch: string,
  headers: Record<string, string>,
): Promise<number> {
  const resp = await fetch(
    `https://api.github.com/repos/${fullName}/commits?per_page=1&sha=${encodeURIComponent(branch)}`,
    { headers },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const link = resp.headers.get("link") ?? "";
  const last = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
  if (last) return Number(last[1]);
  const arr = (await resp.json()) as unknown[];
  return Array.isArray(arr) ? arr.length : 0;
}

// ---------- Gitee 源 ----------

interface GiteeRepoApi {
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  updated_at: string;
  fork: boolean;
}

async function fetchGiteeRepos(env: Env): Promise<RepoEntry[]> {
  const token = env.GITEE_TOKEN;
  const list: GiteeRepoApi[] = [];
  for (let page = 1; page <= 5; page++) {
    const u = new URL(`https://gitee.com/api/v5/users/${GITEE_USER}/repos`);
    u.searchParams.set("per_page", "100");
    u.searchParams.set("page", String(page));
    if (token) u.searchParams.set("access_token", token);
    const resp = await fetch(u.toString(), { headers: { "user-agent": "nec-hub" } });
    const data = (await resp.json()) as GiteeRepoApi[] | { message?: string };
    if (!resp.ok || !Array.isArray(data)) {
      const msg = (data as { message?: string }).message ?? "";
      throw new Error(`Gitee API 错误：HTTP ${resp.status} ${msg}`.trim());
    }
    list.push(...data);
    if (data.length < 100) break;
  }

  // 逐仓库取提交总数；单仓库失败仅该列留空
  const repos = await Promise.all(
    list.map(async (r): Promise<RepoEntry> => {
      let commits: number | null = null;
      try {
        commits = await fetchGiteeCommitCount(r.full_name, token);
      } catch { /* 该仓库提交数留空 */ }
      return {
        host: "gitee",
        name: r.name,
        fullName: r.full_name,
        url: `https://gitee.com/${r.full_name}`,
        description: r.description ?? "",
        stars: r.stargazers_count ?? 0,
        forks: r.forks_count ?? 0,
        commits,
        language: r.language ?? "",
        updatedAt: r.updated_at,
        pushedAt: r.updated_at,
        isFork: r.fork ?? false,
        archived: false,
        defaultBranch: "",
      };
    }),
  );
  return repos;
}

/** Gitee commits 接口响应头的 total_count 即提交总数 */
async function fetchGiteeCommitCount(fullName: string, token?: string): Promise<number | null> {
  const u = new URL(`https://gitee.com/api/v5/repos/${fullName}/commits`);
  u.searchParams.set("per_page", "1");
  if (token) u.searchParams.set("access_token", token);
  const resp = await fetch(u.toString(), { headers: { "user-agent": "nec-hub" } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const raw = resp.headers.get("total_count");
  if (raw == null) return null;
  const total = Number(raw);
  return Number.isFinite(total) ? total : null;
}

// ---------- 数据看板（飞书多维表格聚合 + KV 缓存） ----------

async function getDashboardConfig(env: Env): Promise<DashboardConfig | null> {
  const raw = await env.REGISTRY.get("dashboard:config");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DashboardConfig;
  } catch {
    return null;
  }
}

/** 读一张表：命中 5 分钟缓存直接返回；刷新失败时降级返回过期缓存 */
async function fetchTableCached(env: Env, cfg: DashboardConfig, key: DashTable): Promise<TableFetchResult> {
  const tableId = cfg.tables[key];
  if (!tableId) return { records: [], cachedAt: "", error: "未配置 table_id" };
  const cacheKey = `dashboard:cache:${key}`;
  const cached = await env.REGISTRY.get(cacheKey, "json") as
    | { data: BitableRecord[]; cachedAt: number }
    | null;
  if (cached && cached.cachedAt > Date.now() - DASH_CACHE_TTL_SEC * 1000) {
    return { records: cached.data, cachedAt: new Date(cached.cachedAt).toISOString() };
  }
  try {
    const token = await getTenantAccessToken(env);
    const records = await listBitableRecords(token, cfg.base, tableId);
    await env.REGISTRY.put(cacheKey, JSON.stringify({ data: records, cachedAt: Date.now() }));
    return { records, cachedAt: new Date().toISOString() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (cached) {
      return {
        records: cached.data,
        cachedAt: new Date(cached.cachedAt).toISOString(),
        stale: true,
        error: `${msg}（展示缓存快照）`,
      };
    }
    return { records: [], cachedAt: "", error: msg };
  }
}

const TASK_DONE_RE = /完成|已完|完结|done|取消|cancel|关闭|close|drop/i;

/** 资料页初始种子数据（首次访问且 KV 为空时写入） */
const SEED_DOCS: DocEntry[] = [
  {
    id: "nec-brand-center",
    title: "NEC 品牌主视觉中心",
    description: "Logo / PPT 模板 / VI 规范一站式下载与规范说明",
    category: "brand",
    url: "/brand/",
    visibility: "all",
    maintainer: "NEC AI 中台",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "nec-vi-manual",
    title: "NEC VI 规范手册 V1.0",
    description: "标准色值、字体系统、最小尺寸、禁用示例完整规范",
    category: "brand",
    url: "/brand/NEC-VI-Manual_V1.0.md",
    visibility: "all",
    maintainer: "NEC AI 中台",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "nec-ppt-template",
    title: "NEC PPT 标准模板",
    description: "7 种版式（封面/目录/章节/内容/图文/表格/结尾），思源黑体统一",
    category: "template",
    url: "/brand/NEC-PPT-Template_V1.0.pptx",
    visibility: "all",
    maintainer: "NEC AI 中台",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "tech-report-template",
    title: "技术方案报告模板",
    description: "项目立项/技术评审/成果总结通用报告结构（待接入飞书文档）",
    category: "template",
    url: "https://example.feishu.cn/docx/tech-report",
    visibility: "all",
    maintainer: "待认领",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "meeting-minutes-template",
    title: "会议纪要模板",
    description: "例会/评审会标准纪要结构，含行动项追踪（待接入飞书文档）",
    category: "template",
    url: "https://example.feishu.cn/docx/meeting-minutes",
    visibility: "all",
    maintainer: "待认领",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "reimburse-sop",
    title: "财务报销流程",
    description: "线上报销助手 + 材料清单 + 审批节点说明",
    category: "sop",
    url: "/#tab-dashboard",
    visibility: "all",
    maintainer: "NEC AI 中台",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "warehouse-sop",
    title: "仓库领用规范",
    description: "物资领用/归还/盘点操作流程，配合 NEC 仓库作业台使用",
    category: "sop",
    url: "https://mes.newenergycoder.club/home.html",
    visibility: "all",
    maintainer: "NEC AI 中台",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "handover-checklist",
    title: "换届交接清单",
    description: "中台资产/账号/文档/权限交接 checklist（待接入飞书文档）",
    category: "sop",
    url: "https://example.feishu.cn/docx/handover",
    visibility: "all",
    maintainer: "待认领",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "mech-onboarding",
    title: "机械组入门教程",
    description: "机械组常用工具链、设计规范、常用元件手册（待接入飞书文档）",
    category: "training",
    url: "https://example.feishu.cn/wiki/mech-onboarding",
    visibility: "all",
    maintainer: "待认领",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "elec-onboarding",
    title: "电控组入门教程",
    description: "电路设计、嵌入式开发、调试工具使用指南（待接入飞书文档）",
    category: "training",
    url: "https://example.feishu.cn/wiki/elec-onboarding",
    visibility: "all",
    maintainer: "待认领",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "vision-onboarding",
    title: "视觉组入门教程",
    description: "OpenCV/深度学习/相机标定/部署流程（待接入飞书文档）",
    category: "training",
    url: "https://example.feishu.cn/wiki/vision-onboarding",
    visibility: "all",
    maintainer: "待认领",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
];

async function buildDocs(env: Env, request: Request): Promise<unknown> {
  let docs = await readIndex<DocEntry>(env, DOCS_REGISTRY_KEY);
  if (docs.length === 0) {
    docs = SEED_DOCS;
    await env.REGISTRY.put(DOCS_REGISTRY_KEY, JSON.stringify(docs));
  }
  const session = await resolveSession(env, request);
  if (!session) {
    return docs.filter((d) => d.visibility === "all");
  }
  return docs;
}

async function buildDashboard(env: Env, request: Request): Promise<unknown> {
  const cfg = await getDashboardConfig(env);
  if (!cfg) {
    return {
      configured: false,
      hint: "数据看板尚未接入飞书多维表格。让 Agent 调用 nec-hub MCP 的 config_dashboard（action=set）配置 base 与 tables 后即可展示。",
    };
  }
  // FE-01：按登录角色决定财务区可见级别（hidden=未登录 / summary=队员 / full=队长·财务）
  const session = await resolveSession(env, request);
  const role = session ? await resolveUserRole(env, session.user) : null;
  const financeLevel = !session || !role ? "hidden" : canSeeFinanceDetail(role) ? "full" : "summary";
  const fetched: Record<DashTable, TableFetchResult> = {
    members: { records: [], cachedAt: "" },
    tasks: { records: [], cachedAt: "" },
    inventory: { records: [], cachedAt: "" },
    finance: { records: [], cachedAt: "" },
  };
  await Promise.all(DASH_TABLES.map(async (k) => { fetched[k] = await fetchTableCached(env, cfg, k); }));

  // 队员名单：总数 + 组别分布
  const m = fetched.members;
  const mGroupKey = findFieldKey(m.records, [/^组别/, /组别/, /小组/, /部门/, /group/i]);
  const byGroup: Record<string, number> = {};
  for (const r of m.records) {
    const g = (mGroupKey ? fieldText(r.fields[mGroupKey]) : "") || "未分组";
    byGroup[g] = (byGroup[g] ?? 0) + 1;
  }

  // 任务进度：状态分布 + 未完成任务（按截止升序）
  const t = fetched.tasks;
  const tStatusKey = findFieldKey(t.records, [/^状态/, /状态/, /进度/, /status/i]);
  const tOwnerKey = findFieldKey(t.records, [/负责人/, /执行人/, /owner/i, /assignee/i]);
  const tTitleKey = findFieldKey(t.records, [/^任务/, /任务/, /事项/, /标题/, /title/i]);
  const tDeadlineKey = findFieldKey(t.records, [/截止/, /deadline/i, /完成时间/, /日期/]);
  const byStatus: Record<string, number> = {};
  for (const r of t.records) {
    const s = (tStatusKey ? fieldText(r.fields[tStatusKey]) : "") || "未标注";
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }
  const pending = t.records.filter((r) => {
    const s = tStatusKey ? fieldText(r.fields[tStatusKey]) : "";
    return s ? !TASK_DONE_RE.test(s) : false;
  });
  const upcomingSrc = pending.length > 0 ? pending : t.records;
  const upcoming = upcomingSrc
    .map((r) => ({
      title: (tTitleKey ? fieldText(r.fields[tTitleKey]) : "") || firstFieldText(r),
      owner: tOwnerKey ? fieldText(r.fields[tOwnerKey]) : "",
      status: tStatusKey ? fieldText(r.fields[tStatusKey]) : "",
      deadline: tDeadlineKey ? fieldNum(r.fields[tDeadlineKey]) : null,
    }))
    .sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity))
    .slice(0, 8);

  // 物资台账：种类数 + 数量合计 + 明细
  const inv = fetched.inventory;
  const iNameKey = findFieldKey(inv.records, [/^物料/, /物料/, /物资/, /物品/, /品名/, /名称/, /name/i]);
  const iQtyKey = findFieldKey(inv.records, [/^数量/, /数量/, /库存/, /余量/, /现存/, /quantity/i, /^count$/i]);
  const iLocKey = findFieldKey(inv.records, [/位置/, /库位/, /货架/, /仓库/, /location/i]);
  const inventoryItems = inv.records
    .map((r) => ({
      name: (iNameKey ? fieldText(r.fields[iNameKey]) : "") || firstFieldText(r),
      qty: iQtyKey ? fieldNum(r.fields[iQtyKey]) : null,
      location: iLocKey ? fieldText(r.fields[iLocKey]) : "",
    }))
    .filter((it) => it.name)
    .slice(0, 50);
  const inventoryTotalQty = inventoryItems.reduce((sum, it) => sum + (it.qty ?? 0), 0);

  // 财务报销：笔数 + 金额合计 + 最近条目（含报销时间，按时间倒序）
  const fin = fetched.finance;
  const fAmountKey = findFieldKey(fin.records, [/报销金额/, /^金额/, /金额/, /费用/, /amount/i]);
  const fItemKey = findFieldKey(fin.records, [/^事项/, /事项/, /用途/, /摘要/]);
  const fDateKey = findFieldKey(fin.records, [/报销时间/, /报销日期/, /^日期/, /日期/, /时间/, /^date/i]);
  const fApplicantKey = findFieldKey(fin.records, [/申请人/, /报销人/, /经手人/, /提交人/]);
  const financeRecent = fin.records
    .map((r) => ({
      name: (fItemKey ? fieldText(r.fields[fItemKey]) : "") || firstFieldText(r),
      amount: fAmountKey ? fieldNum(r.fields[fAmountKey]) : null,
      date: fDateKey ? fieldTs(r.fields[fDateKey]) : null,
      applicant: fApplicantKey ? fieldText(r.fields[fApplicantKey]) : "",
    }))
    .filter((it) => it.name)
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
    .slice(0, 8);
  const financeTotal = fin.records.reduce(
    (sum, r) => sum + (fAmountKey ? (fieldNum(r.fields[fAmountKey]) ?? 0) : 0),
    0,
  );

  const wrap = (r: TableFetchResult, agg: Record<string, unknown>) => ({
    ...agg,
    ...(r.error ? { error: r.error } : {}),
    ...(r.stale ? { stale: true } : {}),
    cachedAt: r.cachedAt,
  });

  return {
    configured: true,
    base: cfg.base,
    generatedAt: new Date().toISOString(),
    stale: DASH_TABLES.some((k) => fetched[k].stale),
    members: wrap(fetched.members, {
      total: m.records.length,
      byGroup: Object.entries(byGroup)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    }),
    tasks: wrap(fetched.tasks, {
      total: t.records.length,
      byStatus: Object.entries(byStatus)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      upcoming,
    }),
    inventory: wrap(fetched.inventory, {
      kinds: inv.records.length,
      totalQty: inventoryTotalQty,
      items: inventoryItems,
    }),
    finance: wrap(fetched.finance, {
      visibility: financeLevel,
      ...(financeLevel === "hidden"
        ? {}
        : {
            records: fin.records.length,
            totalAmount: financeTotal,
            ...(financeLevel === "full" ? { recent: financeRecent } : {}),
          }),
    }),
  };
}

// ---------- 报销提交（上传单据/付款凭证 → R2；按字段类型写入财务报销表） ----------

/**
 * POST /api/reimburse（multipart/form-data，需登录）
 * 字段：item / amount / date(YYYY-MM-DD) / note / receipt(单据文件) / payment(付款凭证文件)
 * 流程：文件 → R2 receipts/ 存档；再按字段名模糊匹配写入飞书「财务报销」表并清看板缓存。
 * 表的字段类型不同（日期 vs 文本），先读 fields 元数据按 ui_type 序列化。
 */
async function handleReimburse(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(env, request);
  if (!session) return json({ error: "请先登录后再提交报销" }, 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "请求必须是 multipart/form-data" }, 400);
  }

  const item = String(form.get("item") ?? "").trim();
  const amount = Number(String(form.get("amount") ?? "").replace(/[,，¥￥\s]/g, ""));
  const dateStr = String(form.get("date") ?? "").trim();
  const note = String(form.get("note") ?? "").trim();
  const invno = String(form.get("invno") ?? "").trim();
  if (!item) return json({ error: "请填写报销事项" }, 400);
  if (!Number.isFinite(amount) || amount <= 0) return json({ error: "请填写有效金额" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return json({ error: "请选择报销时间" }, 400);

  // 1. 单据与付款凭证 → R2（10MB 上限）
  const day = dateStr.replace(/-/g, "");
  const files: Record<string, string> = {};
  for (const [field, label] of [["receipt", "单据"], ["payment", "付款凭证"]] as const) {
    const f = form.get(field);
    if (f instanceof File && f.size > 0) {
      if (f.size > 10 * 1024 * 1024) return json({ error: label + "超过 10MB 上限" }, 400);
      const safe = (f.name || field).replace(/[^\w.\-一-龥]+/g, "_").slice(-60);
      const key = "receipts/" + day + "/" + crypto.randomUUID() + "-" + safe;
      await env.APPS_BUCKET.put(key, await f.arrayBuffer(), {
        httpMetadata: { contentType: f.type || "application/octet-stream" },
      });
      files[field] = key;
    }
  }

  const result: Record<string, unknown> = { ok: true, files };

  // 2. 写入财务报销表（字段名模糊匹配；写失败不影响已存档的凭证）
  const cfg = await getDashboardConfig(env);
  if (cfg?.tables.finance && env.FEISHU_APP_ID && env.FEISHU_APP_SECRET) {
    try {
      const token = await getTenantAccessToken(env);
      const metas = await listBitableFields(token, cfg.base, cfg.tables.finance);
      const record: Record<string, unknown> = {};

      const fItem = matchField(metas, [/^事项/, /事项/, /用途/, /摘要/], /Text/i);
      const fInvno = invno ? matchField(metas, [/发票号/, /票号/, /invoice/i], /Text/i) : undefined;
      if (fInvno) record[fInvno.field_name] = invno;
      if (fItem) {
        const suffix: string[] = [];
        if (note) suffix.push(note);
        if (invno && !fInvno) suffix.push("发票号 " + invno);
        record[fItem.field_name] = suffix.length ? item + "（" + suffix.join("；") + "）" : item;
      }
      const fAmount = matchField(metas, [/报销金额/, /^金额/, /金额/, /费用/, /amount/i], /Number|Currency/i);
      if (fAmount) record[fAmount.field_name] = amount;
      const fDate = matchField(metas, [/报销时间/, /报销日期/, /^日期/, /日期/, /时间/, /^date/i]);
      if (fDate) {
        record[fDate.field_name] = /DateTime/i.test(fDate.ui_type)
          ? Date.parse(dateStr + "T00:00:00+08:00")
          : dateStr;
      }
      const fApplicant = matchField(metas, [/申请人/, /报销人/, /经手人/, /提交人/], /Text/i);
      if (fApplicant) record[fApplicant.field_name] = session.user.name;
      const fAttach = matchField(metas, [/凭证/, /单据/, /附件/, /票据/], /Text/i);
      const keys = Object.values(files);
      if (fAttach && keys.length) record[fAttach.field_name] = keys.join("\n");

      if (Object.keys(record).length === 0) {
        result.warning = "财务报销表未匹配到可写字段（事项/金额/报销时间），已仅存档凭证文件";
      } else {
        const created = await createBitableRecord(token, cfg.base, cfg.tables.finance, record);
        result.recordId = created.record_id;
        await env.REGISTRY.delete("dashboard:cache:finance");
      }
    } catch (err) {
      result.warning = "凭证已存档，但写入财务报销表失败：" + (err instanceof Error ? err.message : String(err));
    }
  } else {
    result.warning = "未配置财务报销表或飞书应用，已仅存档凭证文件";
  }
  return json(result);
}

// ---------- 工具函数 ----------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function rpc(id: string | number | null, result: unknown): Response {
  return json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: string | number | null, code: number, message: string): Response {
  return json({ jsonrpc: "2.0", id, error: { code, message } }, 200);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}
