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
 * 注意：Env 接口为手写最小集。部署前请运行 `wrangler types` 生成权威类型。
 */

interface Env {
  ASSETS: Fetcher;
  REGISTRY: KVNamespace;
  APPS_BUCKET: R2Bucket;
  HUB_NAME?: string;
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

/** 资料页条目（KV key: docs:index，由 MCP publish_doc 写入） */
interface DocEntry {
  name: string;
  title: string;
  /** 分类：品牌规范 | 文档模板 | 制度SOP | 培训材料 */
  category: string;
  /** 资料链接（飞书文档/云盘/R2 等） */
  url: string;
  /** 维护人 */
  maintainer: string;
  /** 可见范围：all 或组别名，默认 all（当前仅展示标注，角色硬过滤随 FE-06/07 落地） */
  visibility: string;
  updatedAt: string;
}

/** 数据看板配置（KV key: dashboard:config，由 MCP config_dashboard 写入） */
interface DashboardConfig {
  /** 多维表格 app_token（表格 URL 中 /base/ 之后的一段） */
  base: string;
  /** 逻辑表名 → table_id（tbl 开头） */
  tables: Partial<Record<"members" | "tasks" | "inventory" | "finance", string>>;
  updatedAt: string;
}

interface BitableRecord {
  record_id: string;
  fields: Record<string, unknown>;
}

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

/** 部分源失败时的缓存 TTL（秒）：缩短重试间隔，尽快补全缺失源 */
const REPOS_PARTIAL_CACHE_TTL_SEC = 600;

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
        return json(await visibleApps(env, request));
      }
      if (url.pathname === "/api/skills") {
        return json(await readIndex<SkillEntry>(env, "skills:index"));
      }
      if (url.pathname === "/api/docs") {
        return json(await readIndex<DocEntry>(env, "docs:index"));
      }
      if (url.pathname === "/api/validate") {
        const raw = await env.REGISTRY.get("validate:report");
        if (!raw) return json({ ran: false, hint: "还没有校验报告。让 Agent 调用 validate_bitable（管理端/队长/组长）跑一次全量校验。" });
        try {
          return json(JSON.parse(raw));
        } catch {
          return json({ ran: false, hint: "校验报告损坏，请重新运行 validate_bitable。" });
        }
      }
      if (url.pathname === "/api/dashboard") {
        return json(await buildDashboard(env, request));
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
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
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

  return new Response(
    JSON.stringify({
      name: user.name,
      en_name: userData.data.en_name,
      open_id: user.open_id,
      avatar_url: user.avatar_url,
      session: true,
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": sessionCookie(sid),
        ...cors,
      },
    },
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

/** 解析会话；剩余有效期不足一半时同 sid 原地滑动续期 */
async function resolveSession(env: Env, request: Request): Promise<{ user: HubUser } | null> {
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
    await env.REGISTRY.put(`session:${sid}`, JSON.stringify({ ...data, expiresAt: Date.now() + SESSION_TTL_SEC * 1000 }), { expirationTtl: SESSION_TTL_SEC });
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
  return json({ authenticated: true, user: { ...s.user, ...role } });
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

/** 应用广场按登录角色过滤：未登录/名单外(external) 仅 visibility=all；在册队员额外可见本组、本角色及本人 authored */
async function visibleApps(env: Env, request: Request): Promise<AppEntry[]> {
  const apps = await readIndex<AppEntry>(env, "apps:index");
  const session = await resolveSession(env, request);
  if (!session) return apps.filter((a) => a.visibility === "all");
  const role = await resolveUserRole(env, session.user);
  if (role.role === "external") return apps.filter((a) => a.visibility === "all");
  return apps.filter(
    (a) =>
      a.visibility === "all" ||
      a.visibility === role.group ||
      a.visibility === role.role ||
      a.author === session!.user.name,
  );
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
    name: "publish_doc",
    description:
      "把一条资料上架到中台资料页（品牌规范/文档模板/制度SOP/培训材料）。资料本体存飞书文档/云盘或 R2，这里只登记索引（标题/分类/链接/维护人/可见范围）。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "资料标识，小写连字符，如 vi-logo-rules" },
        title: { type: "string", description: "展示标题，如 队标 VI 使用规范" },
        category: { type: "string", description: "品牌规范 | 文档模板 | 制度SOP | 培训材料" },
        url: { type: "string", description: "资料链接（飞书文档/云盘/R2 等），https://..." },
        maintainer: { type: "string", description: "维护人姓名，默认 unknown" },
        visibility: { type: "string", description: "可见范围：all 或组别名，默认 all" },
      },
      required: ["name", "title", "category", "url"],
    },
  },
  {
    name: "remove_docs",
    description: "从资料页移除指定资料（只删索引，不动资料本体）。",
    inputSchema: {
      type: "object",
      properties: {
        names: { type: "array", items: { type: "string" }, description: "要移除的资料 name 列表" },
      },
      required: ["names"],
    },
  },
  {
    name: "setup_bitable",
    description:
      "数据基建一键建表：在指定飞书多维表格 base 里按标准字段 schema 创建 队员名单/任务进度/物资台账/财务报销 四张表，并把 table_id 写入看板配置。需先在飞书云文档新建空白多维表格，把 URL 中 /base/ 后的 app_token 传给 base 参数。仅管理端（MCP_TOKEN）可用。",
    inputSchema: {
      type: "object",
      properties: {
        base: { type: "string", description: "多维表格 app_token（URL 中 /base/ 后的一段）" },
        tables: { type: "array", items: { type: "string" }, description: "可选：只建部分表，如 [\"members\",\"tasks\"]，默认全部四张" },
        force: { type: "boolean", description: "true 时即使配置里已有该表也强制新建（会留下旧表，谨慎）" },
      },
      required: ["base"],
    },
  },
  {
    name: "validate_bitable",
    description:
      "数据健康校验：按声明式规则扫描多维表格（队员名单/任务进度/物资台账/财务报销），输出异常清单（类型/记录链接/修复建议）。全量明细仅管理端（MCP_TOKEN）或队长/组长角色（user_token）；无身份调用只返回各规则命中计数。详细报告会存为中台「数据健康」最新报告。",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "all（默认）| members | tasks | inventory | finance" },
        user_token: { type: "string", description: "可选：飞书 user_access_token；无 MCP_TOKEN 时用于角色判定（队长/组长可看明细）" },
      },
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
    name: "whoami",
    description:
      "验证当前调用者身份。管理端（Bearer MCP_TOKEN）直接返回 admin；或传 user_token（飞书 user_access_token）返回 open_id/姓名/角色，供 user_token 方式接入的 Agent 自检。",
    inputSchema: {
      type: "object",
      properties: {
        user_token: { type: "string", description: "可选：飞书 user_access_token" },
      },
    },
  },
];

async function handleMcp(request: Request, env: Env): Promise<Response> {
  // hasMcpToken 仅表示"本次调用真实匹配了 MCP_TOKEN"：
  // 未配置 MCP_TOKEN 时写操作保持原有开放行为，但财务门禁不因此放行（finance 仍需 user_token + 队长/财务角色）
  let hasMcpToken = false;
  if (env.MCP_TOKEN) {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    hasMcpToken = await timingSafeEqual(token, env.MCP_TOKEN);
    if (!hasMcpToken) {
      return json({ error: "unauthorized" }, 401);
    }
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
          "NEC 团队 AI 中台 MCP。deploy_app 部署静态应用到应用广场；publish_skill 上架 Skill；config_dashboard 配置数据看板对接的飞书多维表格；query_bitable 查询多维表格数据（finance 表需 user_token 且角色为队长/财务，或管理端 MCP_TOKEN）；whoami 验证调用者身份（MCP_TOKEN 或 user_token）。",
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
      case "publish_doc":
        return rpc(id, await toolPublishDoc(args, env));
      case "remove_docs":
        return rpc(id, await toolRemoveDocs(args, env));
      case "query_bitable":
        return rpc(id, await toolQueryBitable(args, env, hasMcpToken));
      case "config_dashboard":
        return rpc(id, await toolConfigDashboard(args, env));
      case "setup_bitable":
        return rpc(id, await toolSetupBitable(args, env, hasMcpToken));
      case "validate_bitable":
        return rpc(id, await toolValidateBitable(args, env, hasMcpToken));
      case "whoami":
        return rpc(id, await toolWhoami(args, env, hasMcpToken));
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

/** 资料页四大分类（publish_doc 的 category 枚举） */
const DOC_CATEGORIES = ["品牌规范", "文档模板", "制度SOP", "培训材料"] as const;

async function toolPublishDoc(args: Record<string, unknown>, env: Env) {
  const name = String(args.name ?? "");
  if (!NAME_RE.test(name)) throw new Error("资料标识不合法：小写字母/数字/连字符（2-41 字符）");
  const title = String(args.title ?? "").trim();
  if (!title) throw new Error("title 不能为空");
  const category = String(args.category ?? "").trim();
  if (!DOC_CATEGORIES.includes(category as (typeof DOC_CATEGORIES)[number])) {
    throw new Error(`category 必须是：${DOC_CATEGORIES.join(" | ")}`);
  }
  const url = String(args.url ?? "").trim();
  if (!/^https?:\/\/.+/.test(url)) throw new Error("url 必须是 http(s) 完整链接");
  const entry: DocEntry = {
    name,
    title,
    category,
    url,
    maintainer: String(args.maintainer ?? "unknown"),
    visibility: String(args.visibility ?? "all"),
    updatedAt: new Date().toISOString(),
  };
  const list = await upsertIndex(env, "docs:index", entry);
  return {
    content: [
      {
        type: "text",
        text: `✅ 资料已上架：【${category}】${title}\n资料页现有 ${list.length} 条。`,
      },
    ],
  };
}

async function toolRemoveDocs(args: Record<string, unknown>, env: Env) {
  const names = new Set(((args.names ?? []) as unknown[]).map((n) => String(n)));
  if (names.size === 0) throw new Error("names 不能为空");
  const list = await readIndex<DocEntry>(env, "docs:index");
  const kept = list.filter((d) => !names.has(d.name));
  const removed = list.length - kept.length;
  await env.REGISTRY.put("docs:index", JSON.stringify(kept));
  return {
    content: [{ type: "text", text: `✅ 已移除 ${removed} 条资料，资料页剩余 ${kept.length} 条。` }],
  };
}

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

/** 校验结果读取权限：管理端或 队长/组长 角色可看明细；否则只返回计数 */
const VALIDATE_DETAIL_ROLE_RE = /队长|组长|财务|指导/i;

async function toolValidateBitable(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  const scopeRaw = String(args.scope ?? "all");
  const scope: DashTable | "all" = scopeRaw === "all" ? "all" : (scopeRaw as DashTable);
  if (scope !== "all" && !DASH_TABLES.includes(scope as DashTable)) {
    throw new Error("scope 必须是 all | members | tasks | inventory | finance");
  }
  let detail = hasMcpToken;
  if (!detail) {
    const userToken = String(args.user_token ?? "").trim();
    if (userToken) {
      const openId = await validateUserToken(userToken);
      const role = await resolveUserRole(env, { name: "", open_id: openId });
      detail = VALIDATE_DETAIL_ROLE_RE.test(role.role);
    }
  }
  const report = await runValidation(env, scope, detail);
  const text = detail
    ? `✅ 校验完成（明细）：共 ${(report as { anomalyCount?: number }).anomalyCount ?? 0} 项异常\n` + JSON.stringify(report, null, 2)
    : `✅ 校验完成（仅计数，明细需队长/组长或管理端）：共 ${(report as { anomalyCount?: number }).anomalyCount ?? 0} 项异常\n` + JSON.stringify(report, null, 2);
  return { content: [{ type: "text", text }] };
}

/** FE-02：四张逻辑表的标准字段schema（type: 1=文本 2=数字 5=日期） */
const BITABLE_SCHEMAS: Record<DashTable, Array<{ name: string; type: number; property?: Record<string, unknown> }>> = {
  members: [
    { name: "姓名", type: 1 },
    { name: "飞书ID", type: 1 },
    { name: "组别", type: 1 },
    { name: "权限角色", type: 1 },
    { name: "赛季", type: 1 },
  ],
  tasks: [
    { name: "任务", type: 1 },
    { name: "负责人", type: 1 },
    { name: "状态", type: 1 },
    { name: "完成度", type: 2 },
    { name: "截止日期", type: 5, property: { date_formatter: "yyyy/MM/dd" } },
    { name: "创建日期", type: 5, property: { date_formatter: "yyyy/MM/dd" } },
  ],
  inventory: [
    { name: "物料", type: 1 },
    { name: "数量", type: 2 },
    { name: "位置", type: 1 },
    { name: "领用人", type: 1 },
  ],
  finance: [
    { name: "事项", type: 1 },
    { name: "金额", type: 2 },
    { name: "发票状态", type: 1 },
    { name: "状态", type: 1 },
    { name: "报销人", type: 1 },
    { name: "日期", type: 5, property: { date_formatter: "yyyy/MM/dd" } },
  ],
};

const TABLE_DISPLAY_NAMES: Record<DashTable, string> = {
  members: "队员名单",
  tasks: "任务进度",
  inventory: "物资台账",
  finance: "财务报销",
};

/**
 * 在指定多维表格 base 里按标准 schema 建表，并把 table_id 写入看板配置。
 * 需在飞书里先建好空白多维表格（云文档 → 新建多维表格），把 URL 中 /base/ 后的 app_token 传给本工具。
 */
async function toolSetupBitable(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) {
    throw new Error("setup_bitable 仅管理端可用（需 MCP_TOKEN）：建表会改变团队数据结构");
  }
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    throw new Error("飞书自建应用未配置（FEISHU_APP_ID / FEISHU_APP_SECRET）");
  }
  const base = String(args.base ?? "").trim();
  if (!/^[A-Za-z0-9]{10,}$/.test(base)) {
    throw new Error("base 不合法：飞书多维表格 URL 中 /base/ 后的 app_token");
  }
  const force = args.force === true;
  const want = Array.isArray(args.tables) && args.tables.length > 0
    ? args.tables.map(String).filter((t): t is DashTable => DASH_TABLES.includes(t as DashTable))
    : [...DASH_TABLES];
  if (want.length === 0) throw new Error(`tables 必须是：${DASH_TABLES.join(" | ")}`);

  const cfg = await getDashboardConfig(env);
  const token = await getTenantAccessToken(env);
  const created: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  const tables: DashboardConfig["tables"] = { ...(cfg?.base === base ? cfg.tables : {}) };

  for (const t of want) {
    if (tables[t] && !force) { skipped.push(t); continue; }
    try {
      const resp = await fetch(`${FEISHU_API}/bitable/v1/apps/${base}/tables`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ table: { name: TABLE_DISPLAY_NAMES[t], fields: BITABLE_SCHEMAS[t] } }),
      });
      const data = (await resp.json()) as { code?: number; msg?: string; data?: { table_id?: string } };
      if (data.code !== 0 || !data.data?.table_id) {
        throw new Error(data.msg ?? `code ${data.code}`);
      }
      tables[t] = data.data.table_id;
      created.push(`${t}=${data.data.table_id}`);
    } catch (err) {
      failed.push(`${t}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const newCfg: DashboardConfig = { base, tables, updatedAt: new Date().toISOString() };
  await env.REGISTRY.put("dashboard:config", JSON.stringify(newCfg));
  await Promise.all(DASH_TABLES.map((k) => env.REGISTRY.delete(`dashboard:cache:${k}`)));
  return {
    content: [
      {
        type: "text",
        text:
          `✅ 建表完成：新建 ${created.length} 张（${created.join("，") || "无"}），已存在跳过 ${skipped.length} 张（${skipped.join("，") || "无"}）` +
          (failed.length ? `，失败 ${failed.length} 张：\n- ${failed.join("\n- ")}` : "") +
          `\n看板配置已更新：base=${base}。打开门户「数据看板」Tab 验证。`,
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

async function toolWhoami(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (hasMcpToken && !args.user_token) {
    return { content: [{ type: "text", text: "✅ 管理端身份：MCP_TOKEN 持有者（全部权限，finance 表不受限）" }] };
  }
  const userToken = String(args.user_token ?? "").trim();
  if (!userToken) throw new Error("无法识别身份：调用未携带 MCP_TOKEN，且未传 user_token");
  const resp = await fetch(`${FEISHU_API}/authen/v1/user_info`, {
    headers: { authorization: `Bearer ${userToken}` },
  });
  const data = (await resp.json()) as {
    code?: number;
    msg?: string;
    data?: { open_id?: string; name?: string };
  };
  if (data.code !== 0 || !data.data?.open_id) {
    throw new Error(`user_token 校验失败：${data.msg ?? "invalid token"}`);
  }
  const role = await resolveUserRole(env, { name: data.data.name ?? "", open_id: data.data.open_id });
  return {
    content: [
      {
        type: "text",
        text:
          `✅ 身份验证通过：${data.data.name ?? ""}（open_id: ${data.data.open_id}）\n` +
          `角色：${role.role}${role.group ? ` · ${role.group}` : ""}` +
          (role.matched ? "" : "（未在队员名单表匹配到，按 external 处理）"),
      },
    ],
  };
}

// ---------- NEC 开源仓库（GitHub org + KV 缓存） ----------

async function buildRepos(env: Env): Promise<unknown> {
  const cacheKey = "repos:cache:v3";
  // 历次遗留 key：刷新成功后顺手清理（避免旧格式数据被误读）
  const legacyKeys = ["repos:cache", "repos:cache:v2"];
  const cached = await env.REGISTRY.get(cacheKey, "json") as
    | { data: RepoEntry[]; cachedAt: number }
    | null;
  if (cached && cached.cachedAt > Date.now() - REPOS_CACHE_TTL_SEC * 1000) {
    return { github: GITHUB_ORG, gitee: GITEE_USER, cachedAt: new Date(cached.cachedAt).toISOString(), repos: cached.data };
  }
  try {
    const { repos, errors, partial } = await fetchAllRepos(env);
    // 部分源失败时缩短缓存（10 分钟），尽快补全缺失源
    const ttl = partial ? REPOS_PARTIAL_CACHE_TTL_SEC : REPOS_CACHE_TTL_SEC;
    await env.REGISTRY.put(cacheKey, JSON.stringify({ data: repos, cachedAt: Date.now() }), { expirationTtl: ttl });
    await Promise.all(legacyKeys.map((k) => env.REGISTRY.delete(k)));
    return { github: GITHUB_ORG, gitee: GITEE_USER, cachedAt: new Date().toISOString(), errors, repos };
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

interface FetchReposResult {
  repos: RepoEntry[];
  /** 单源失败的原因（成功的源不受影响） */
  errors: Record<string, string>;
  /** true = 有源失败，缓存应缩短以便尽快补全 */
  partial: boolean;
}

/** 双源拉取合并：单源失败不阻断另一源，失败原因透传给前端；双源均失败才抛错走缓存降级 */
async function fetchAllRepos(env: Env): Promise<FetchReposResult> {
  const [gh, gj] = await Promise.allSettled([fetchOrgRepos(env), fetchGiteeRepos(env)]);
  const errors: Record<string, string> = {};
  if (gh.status === "rejected") errors.github = gh.reason instanceof Error ? gh.reason.message : String(gh.reason);
  if (gj.status === "rejected") errors.gitee = gj.reason instanceof Error ? gj.reason.message : String(gj.reason);
  if (gh.status === "rejected" && gj.status === "rejected") {
    throw new Error(`GitHub 与 Gitee 均拉取失败：${errors.github ?? errors.gitee}`);
  }
  const repos = [
    ...(gh.status === "fulfilled" ? gh.value : []),
    ...(gj.status === "fulfilled" ? gj.value : []),
  ].sort((a, b) => b.stars - a.stars || b.forks - a.forks || a.name.localeCompare(b.name));
  return { repos, errors, partial: Object.keys(errors).length > 0 };
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

/** 简单并发限制：同时最多 limit 个任务在跑（避免触发源站限流，也控制子请求总数） */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
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

  // 逐仓库取提交总数（fork 跳过：上游提交数对团队无意义，也省子请求配额）；并发 4，单仓库失败仅该列留空
  const repos = await mapLimit(list, 4, async (r): Promise<RepoEntry> => {
    let commits: number | null = null;
    if (!r.fork) {
      try {
        commits = await fetchGiteeCommitCount(r.full_name, token);
      } catch { /* 该仓库提交数留空 */ }
    }
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
  });
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

/** tenant_access_token 供多维表格等应用级 API 使用（KV 缓存，提前 5 分钟过期） */
async function getTenantAccessToken(env: Env): Promise<string> {
  const cached = await env.REGISTRY.get("feishu:tenant_access_token", "json") as
    | { token: string; expireAt: number }
    | null;
  if (cached && cached.expireAt > Date.now()) return cached.token;

  const resp = await fetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const data = (await resp.json()) as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`获取 tenant_access_token 失败：${data.msg ?? "unknown"}`);
  }
  const expireAt = Date.now() + ((data.expire ?? 7200) - 300) * 1000;
  await env.REGISTRY.put("feishu:tenant_access_token", JSON.stringify({ token: data.tenant_access_token, expireAt }));
  return data.tenant_access_token;
}

/** 分页读取一张多维表格（最多 max 条），code !== 0 视为失败 */
async function listBitableRecords(
  token: string,
  appToken: string,
  tableId: string,
  max = 1000,
): Promise<BitableRecord[]> {
  const out: BitableRecord[] = [];
  let pageToken = "";
  do {
    const u = new URL(`${FEISHU_API}/bitable/v1/apps/${appToken}/tables/${tableId}/records`);
    u.searchParams.set("page_size", "100");
    if (pageToken) u.searchParams.set("page_token", pageToken);
    const resp = await fetch(u.toString(), { headers: { authorization: `Bearer ${token}` } });
    const data = (await resp.json()) as {
      code?: number;
      msg?: string;
      data?: { items?: BitableRecord[]; has_more?: boolean; page_token?: string };
    };
    if (data.code !== 0) {
      throw new Error(`飞书多维表格读取失败（${tableId}）：${data.msg ?? `code ${data.code}`}`);
    }
    out.push(...(data.data?.items ?? []));
    pageToken = data.data?.has_more ? (data.data?.page_token ?? "") : "";
  } while (pageToken && out.length < max);
  return out.slice(0, max);
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

/** 多维表格字段值松散类型 → 展示文本（兼容字符串/数字/数组/人员对象） */
function fieldText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(fieldText).filter(Boolean).join("、");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return fieldText(o.name ?? o.text ?? o.title ?? "");
  }
  return String(v);
}

/** 尽量从字段值里解析出数字（"¥1,200" → 1200） */
function fieldNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const m = fieldText(v).replace(/[,，\s]/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** 在记录样本里按正则找第一个匹配的字段名（字段名不固定，做模糊匹配） */
function findFieldKey(records: BitableRecord[], patterns: RegExp[]): string | null {
  const keys = new Set<string>();
  for (const r of records.slice(0, 50)) {
    for (const k of Object.keys(r.fields ?? {})) keys.add(k);
  }
  for (const re of patterns) {
    for (const k of keys) {
      if (re.test(k)) return k;
    }
  }
  return null;
}

const TASK_DONE_RE = /完成|已完|完结|done|取消|cancel|关闭|close|drop/i;

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

  // 财务报销：笔数 + 金额合计 + 最近条目
  const fin = fetched.finance;
  const fAmountKey = findFieldKey(fin.records, [/报销金额/, /^金额/, /金额/, /费用/, /amount/i]);
  const fItemKey = findFieldKey(fin.records, [/^事项/, /事项/, /用途/, /摘要/]);
  const financeRecent = fin.records
    .map((r) => ({
      name: (fItemKey ? fieldText(r.fields[fItemKey]) : "") || firstFieldText(r),
      amount: fAmountKey ? fieldNum(r.fields[fAmountKey]) : null,
    }))
    .filter((it) => it.name)
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

/** 记录里第一个非空文本字段（兜底当标题用） */
function firstFieldText(r: BitableRecord): string {
  for (const k of Object.keys(r.fields ?? {})) {
    const v = fieldText(r.fields[k]);
    if (v) return v;
  }
  return "";
}

// ---------- 数据校验 Agent（FE-05：声明式规则引擎） ----------

/**
 * 校验规则（声明式，无代码 eval）。
 * KV key `validate:rules` 可存同名 JSON 数组覆盖内置规则；字段名不固定时用 fieldPattern 正则匹配。
 */
interface ValidateRule {
  id: string;
  table: DashTable;
  /** 展示名，如 "队员名单：飞书ID 缺失" */
  name: string;
  /** 建议修复动作 */
  suggestion: string;
  severity?: "error" | "warning";
  /** 主字段名正则 */
  fieldPattern: string;
  check: "missing" | "negative" | "notIn" | "regexMismatch" | "beforeField" | "notInRecords" | "contradiction";
  options?: {
    /** notIn：字段文本须包含其一 */
    values?: string[];
    /** regexMismatch：字段文本必须匹配 */
    regex?: string;
    /** beforeField / notInRecords / contradiction：对照字段/表 */
    otherFieldPattern?: string;
    otherTable?: DashTable;
    /** contradiction：对照字段匹配 whenMatches 时触发；配 thenNotMatches = 主字段匹配即异常，配 thenMatches = 主字段不匹配即异常 */
    whenMatches?: string;
    thenMatches?: string;
    thenNotMatches?: string;
  };
}

/** 内置规则集（首轮只上高置信规则；误报率 >30% 的规则下线重调，见 PRD §10） */
const DEFAULT_RULES: ValidateRule[] = [
  { id: "members.feishu-id-missing", table: "members", name: "队员名单：飞书ID 为空", suggestion: "在名单表补上该队员的飞书 open_id（用于登录态角色判定）", fieldPattern: "open_?id|飞书", check: "missing" },
  { id: "members.feishu-id-format", table: "members", name: "队员名单：飞书ID 格式异常", suggestion: "飞书ID 应为 ou 开头的 open_id，从飞书个人名片复制", fieldPattern: "open_?id|飞书", check: "regexMismatch", options: { regex: "^ou[a-zA-Z0-9_-]{6,}$" }, severity: "warning" },
  { id: "members.group-enum", table: "members", name: "队员名单：组别不在常见枚举内", suggestion: "组别建议为：机械 / 电控 / 视觉 / 运营 / 宣传（或联系队长确认）", fieldPattern: "^组别$|组别|小组|部门|group", check: "notIn", options: { values: ["机械", "电控", "视觉", "运营", "宣传", "顾问"] }, severity: "warning" },
  { id: "members.role-missing", table: "members", name: "队员名单：角色字段缺失", suggestion: "补上权限角色（队长/组长/队员/校友）", fieldPattern: "权限角色|角色|role", check: "missing" },
  { id: "tasks.owner-missing", table: "tasks", name: "任务进度：无负责人", suggestion: "指定负责人，或在例会中认领", fieldPattern: "负责人|执行人|owner|assignee", check: "missing" },
  { id: "tasks.deadline-before-created", table: "tasks", name: "任务进度：截止早于创建日期", suggestion: "检查截止日期是否填错年份", fieldPattern: "截止|deadline|完成时间", check: "beforeField", options: { otherFieldPattern: "创建" } },
  { id: "tasks.progress-contradiction", table: "tasks", name: "任务进度：100% 却未标完成", suggestion: "完成度已到 100%，把状态改为完成", fieldPattern: "^状态$|状态|进度|status", check: "contradiction", options: { otherFieldPattern: "完成度|进度", whenMatches: "^100(%|\\.0*)?$", thenMatches: "完成|done|完结" } },
  { id: "inventory.qty-negative", table: "inventory", name: "物资台账：数量为负", suggestion: "盘点后修正数量", fieldPattern: "^数量$|数量|库存|余量|quantity", check: "negative" },
  { id: "inventory.location-missing", table: "inventory", name: "物资台账：位置字段为空", suggestion: "补库位/货架位置，方便 MES 找货", fieldPattern: "位置|库位|货架|仓库|location", check: "missing" },
  { id: "inventory.owner-not-in-members", table: "inventory", name: "物资台账：领用人不在队员名单", suggestion: "领用人姓名需与名单表一致（或先补名单）", fieldPattern: "领用人|领用|借用人|holder", check: "notInRecords", options: { otherTable: "members", otherFieldPattern: "^姓名$|姓名|名字|^name$" } },
  { id: "finance.amount-missing", table: "finance", name: "财务报销：金额缺失", suggestion: "补报销金额", fieldPattern: "报销金额|^金额|金额|费用|amount", check: "missing" },
  { id: "finance.invoice-contradiction", table: "finance", name: "财务报销：已打款但发票缺失", suggestion: "已报销/打款的记录需补发票号或发票照片", fieldPattern: "发票状态|发票", check: "contradiction", options: { otherFieldPattern: "^状态$|状态", whenMatches: "已报销|已打款|已完成", thenNotMatches: "已收|齐全|有|正常" }, severity: "warning" },
];

async function getValidateRules(env: Env): Promise<ValidateRule[]> {
  const raw = await env.REGISTRY.get("validate:rules");
  if (!raw) return DEFAULT_RULES;
  try {
    const parsed = JSON.parse(raw) as ValidateRule[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_RULES;
  } catch {
    return DEFAULT_RULES;
  }
}

interface Anomaly {
  ruleId: string;
  ruleName: string;
  severity: string;
  suggestion: string;
  recordId: string;
  recordTitle: string;
  recordLink: string;
}

/** 执行一条规则，返回异常记录（每条规则最多收 50 条，防止刷屏） */
function evalRule(
  rule: ValidateRule,
  records: BitableRecord[],
  ctx: { cfg: DashboardConfig; tableId: string; members: BitableRecord[] },
): Anomaly[] {
  const out: Anomaly[] = [];
  if (records.length === 0) return out;
  const fieldKey = findFieldKey(records, [new RegExp(rule.fieldPattern, "i")]);
  const otherKey = rule.options?.otherFieldPattern
    ? findFieldKey(records, [new RegExp(rule.options.otherFieldPattern, "i")])
    : null;
  const opt = rule.options ?? {};
  const limit = 50;
  for (const r of records) {
    if (out.length >= limit) break;
    const text = fieldKey ? fieldText(r.fields[fieldKey]) : "";
    const num = fieldKey ? fieldNum(r.fields[fieldKey]) : null;
    let bad = false;
    switch (rule.check) {
      case "missing":
        bad = !text;
        break;
      case "negative":
        bad = num !== null && num < 0;
        break;
      case "notIn":
        bad = !!text && !!opt.values && !opt.values.some((v) => text.includes(v));
        break;
      case "regexMismatch":
        bad = !!text && !!opt.regex && !new RegExp(opt.regex, "i").test(text);
        break;
      case "beforeField": {
        const other = otherKey ? fieldNum(r.fields[otherKey]) : null;
        bad = num !== null && other !== null && num < other;
        break;
      }
      case "notInRecords": {
        if (!text || !opt.otherTable) break;
        const others = ctx.members;
        const okKey = findFieldKey(others, [new RegExp(opt.otherFieldPattern ?? "姓名|name", "i")]);
        bad = !others.some((m) => okKey && fieldText(m.fields[okKey]) === text);
        break;
      }
      case "contradiction": {
        if (!otherKey || !opt.whenMatches) break;
        const otherText = fieldText(r.fields[otherKey]);
        if (!new RegExp(opt.whenMatches, "i").test(otherText)) break;
        if (opt.thenNotMatches) bad = new RegExp(opt.thenNotMatches, "i").test(text);
        else if (opt.thenMatches) bad = !new RegExp(opt.thenMatches, "i").test(text);
        break;
      }
    }
    if (bad) {
      out.push({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity ?? "error",
        suggestion: rule.suggestion,
        recordId: r.record_id,
        recordTitle: firstFieldText(r) || "(未命名记录)",
        recordLink: `https://www.feishu.cn/base/${ctx.cfg.base}?table=${ctx.tableId}&record=${r.record_id}`,
      });
    }
  }
  return out;
}

/** 跑校验。detail=false 时只出计数（无记录明细），供无身份调用方使用。结果存 KV validate:report */
async function runValidation(env: Env, scope: DashTable | "all", detail: boolean): Promise<unknown> {
  const cfg = await getDashboardConfig(env);
  if (!cfg) {
    return { configured: false, hint: "数据看板尚未配置（config_dashboard），无法校验。先配置 base 与 tables。" };
  }
  const rules = await getValidateRules(env);
  const scopedRules = scope === "all" ? rules : rules.filter((r) => r.table === scope);
  if (scopedRules.length === 0) {
    return { configured: true, validatedAt: new Date().toISOString(), scope, tables: {}, anomalyCount: 0, note: "该范围没有匹配的规则" };
  }
  const tables = [...new Set(scopedRules.map((r) => r.table))] as DashTable[];
  const fetched: Record<string, TableFetchResult> = {};
  await Promise.all(tables.map(async (t) => { fetched[t] = await fetchTableCached(env, cfg, t); }));
  // 跨表引用（notInRecords）需要 members 表
  const members = fetched.members ?? await fetchTableCached(env, cfg, "members");

  const reportTables: Record<string, unknown> = {};
  let anomalyCount = 0;
  for (const t of tables) {
    const tableRules = scopedRules.filter((r) => r.table === t);
    const tableId = cfg.tables[t] ?? "";
    const all: Anomaly[] = [];
    for (const rule of tableRules) {
      all.push(...evalRule(rule, fetched[t]?.records ?? [], { cfg, tableId, members: members.records }));
    }
    anomalyCount += all.length;
    const byRule = tableRules
      .map((r) => ({ id: r.id, name: r.name, count: all.filter((a) => a.ruleId === r.id).length }))
      .filter((x) => x.count > 0);
    reportTables[t] = {
      totalRecords: fetched[t]?.records.length ?? 0,
      anomalyCount: all.length,
      byRule,
      error: fetched[t]?.error,
      ...(detail ? { anomalies: all } : {}),
      cachedAt: fetched[t]?.cachedAt,
    };
  }

  const report = {
    configured: true,
    validatedAt: new Date().toISOString(),
    scope,
    detail,
    anomalyCount,
    tables: reportTables,
  };
  if (detail) {
    await env.REGISTRY.put("validate:report", JSON.stringify(report), { expirationTtl: 7 * 24 * 3600 });
  }
  return report;
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
