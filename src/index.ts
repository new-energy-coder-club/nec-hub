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
 *   POST /api/approvals   → 发起审批（4 流程统一入口，flows:config 配置驱动，Plan B 状态机落底表）
 *   POST /api/approvals/<type>/<单号>/<action> → 审批与流程动作（approve/reject/pay/start/archive/arrive/issue/publish）
 *   GET  /api/todos       → 我的待办（待我审批的单按流程分组 + 逾期任务，KV 300s 缓存）
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
  /** GitHub Webhook secret（/api/hooks/github 验签用；未配置时拒绝接收推送） */
  GITHUB_WEBHOOK_SECRET?: string;
  /** 审批通知群机器人 webhook（PRD V1.1 N-01）；可按流程分流 FEISHU_BOT_WEBHOOK_<TYPE>，加签 secret 为同名 _SECRET 变量 */
  FEISHU_BOT_WEBHOOK?: string;
  FEISHU_BOT_WEBHOOK_SECRET?: string;
  FEISHU_BOT_WEBHOOK_REIMBURSE?: string;
  FEISHU_BOT_WEBHOOK_REIMBURSE_SECRET?: string;
  FEISHU_BOT_WEBHOOK_DRAWING?: string;
  FEISHU_BOT_WEBHOOK_DRAWING_SECRET?: string;
  FEISHU_BOT_WEBHOOK_HARDWARE?: string;
  FEISHU_BOT_WEBHOOK_HARDWARE_SECRET?: string;
  FEISHU_BOT_WEBHOOK_COMPLIANCE?: string;
  FEISHU_BOT_WEBHOOK_COMPLIANCE_SECRET?: string;
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

/** 仓库列表缓存 TTL（秒），即刷新频次：每小时一次。两源合计单次刷新约 30+ 次请求（GitHub/Gitee 匿名均 60 次/小时），建议配置 GITHUB_TOKEN / GITEE_TOKEN */
const REPOS_CACHE_TTL_SEC = 3600;

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
      if (url.pathname === "/api/prd") {
        return json(await buildPrdBoard(env));
      }
      if (url.pathname === "/api/hooks/github" && request.method === "POST") {
        return await handleGithubPush(request, env);
      }
      if (url.pathname === "/api/approvals" && request.method === "POST") {
        return await handleApprovalSubmit(request, env);
      }
      const approvalAction = url.pathname.match(/^\/api\/approvals\/([a-z]+)\/([^/]+)\/(approve|reject|pay|start|archive|arrive|issue|publish)$/);
      if (approvalAction) {
        return await handleApprovalAction(request, env, approvalAction[1], approvalAction[2], approvalAction[3]);
      }
      if (url.pathname === "/api/todos") {
        return await handleTodos(env, request);
      }
      if (url.pathname === "/api/approvals/mine") {
        return await handleApprovalMine(env, request);
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

/** 在名单表记录里定位当前用户：优先 open_id 精确匹配，其次姓名精确匹配，最后姓名互相包含（≥2 字，兼容"前缀+姓名"式飞书昵称） */
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
  const candidates: Array<{ rec: BitableRecord; name: string }> = [];
  if (user.name) {
    for (const r of records) {
      for (const k of nameKeys) {
        const text = fieldText(r.fields[k]);
        if (text === user.name) return r;
        if (text) candidates.push({ rec: r, name: text });
      }
    }
    // 包含匹配：名单"朱佩韦" vs 飞书昵称"DarrenPig 朱佩韦"；要求至少 2 个汉字/字符，避免单字误配
    const who = user.name.replace(/[\s·•]+/g, "");
    if (who.length >= 2) {
      const hit = candidates.find(({ name }) => {
        const n = name.replace(/[\s·•]+/g, "");
        return n.length >= 2 && (who.includes(n) || n.includes(who));
      });
      if (hit) return hit.rec;
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
    name: "add_records",
    description:
      "往飞书多维表格追加记录（飞书字段名 → 值；数字/日期字段传数字，日期为毫秒时间戳）。仅管理端（MCP_TOKEN）可用。典型用法：报销回写财务表、任务批量导入。",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "表名：members | tasks | inventory | finance" },
        records: { type: "array", items: { type: "object" }, description: "记录数组，每条为 {字段名: 值}，如 [{\"姓名\":\"张三\",\"组别\":\"机械\"}]" },
      },
      required: ["table", "records"],
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
    name: "update_prd",
    description:
      "更新 PRD 看板需求状态（done | partial | pending | todo），门户「PRD 看板」Tab 实时同步；状态变化会推飞书群（webhook 已配置时）。仅管理端（MCP_TOKEN）可用。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "需求编号：FE-01 ~ FE-13" },
        status: { type: "string", description: "done | partial | pending | todo" },
        note: { type: "string", description: "可选：备注（覆盖旧备注）" },
      },
      required: ["id", "status"],
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
  {
    name: "submit_approval",
    description:
      "代发起审批申请（Agent 帮队员代提交，需管理端 MCP_TOKEN）。type 限 4 枚举；fields 按 flows:config 的声明式规则校验；applicant_open_id 可指定申请人（缺省 mcp-admin）。",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "reimburse | drawing | hardware | compliance" },
        fields: { type: "object", description: "业务字段（与底表字段名一致），如 {\"事项\":\"打样\",\"报销金额\":120}" },
        applicant_name: { type: "string", description: "可选：申请人姓名（缺省取 fields.applicant_open_id 或 mcp-admin）" },
      },
      required: ["type", "fields"],
    },
  },
  {
    name: "list_todos",
    description:
      "拉取指定用户的待办聚合（各流程底表中 审批中 且待其审批的单 + 逾期任务，按流程分组）。需管理端 MCP_TOKEN；角色由 open_id 查队员名单表解析。",
    inputSchema: {
      type: "object",
      properties: {
        open_id: { type: "string", description: "飞书 open_id（ou 开头）" },
      },
      required: ["open_id"],
    },
  },
  {
    name: "send_notice",
    description:
      "向指定流程的飞书群发送机器人通知（需管理端 MCP_TOKEN）。webhook 未配置时返回降级说明；发送失败自动重试 2 次并记录到 notify:failed。",
    inputSchema: {
      type: "object",
      properties: {
        flow: { type: "string", description: "reimburse | drawing | hardware | compliance（决定用哪个群 webhook，未配置 fallback 主群）" },
        title: { type: "string", description: "标题" },
        content: { type: "string", description: "正文" },
        link: { type: "string", description: "可选：去处理链接" },
      },
      required: ["flow", "title", "content"],
    },
  },
  {
    name: "config_flows",
    description:
      "查看/修改审批流程配置 flows:config（底表 tableId/base、单号前缀、审批角色、必填与条件必填校验规则、金额会签阈值）。action=set 深合并写入；tableId 须 tbl 开头或留空。仅管理端（MCP_TOKEN）。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "get（默认）| set" },
        flows: { type: "object", description: "set 时必填：{ reimburse: { tableId, base, ... } }，只传要改的字段" },
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
          "NEC 团队 AI 中台 MCP。deploy_app 部署静态应用到应用广场；publish_skill 上架 Skill；config_dashboard 配置数据看板对接的飞书多维表格；query_bitable 查询多维表格数据（finance 表需 user_token 且角色为队长/财务，或管理端 MCP_TOKEN）；whoami 验证调用者身份（MCP_TOKEN 或 user_token）；submit_approval 代发起审批、list_todos 查待办、send_notice 发群通知、config_flows 配置审批流程（PRD V1.1 Plan B：状态机落多维表格 + 群机器人 webhook 通知）。",
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
      case "add_records":
        return rpc(id, await toolAddRecords(args, env, hasMcpToken));
      case "validate_bitable":
        return rpc(id, await toolValidateBitable(args, env, hasMcpToken));
      case "update_prd":
        return rpc(id, await toolUpdatePrd(args, env, hasMcpToken));
      case "whoami":
        return rpc(id, await toolWhoami(args, env, hasMcpToken));
      case "submit_approval":
        return rpc(id, await toolSubmitApproval(args, env, hasMcpToken));
      case "list_todos":
        return rpc(id, await toolListTodos(args, env, hasMcpToken));
      case "send_notice":
        return rpc(id, await toolSendNotice(args, env, hasMcpToken));
      case "config_flows":
        return rpc(id, await toolConfigFlows(args, env, hasMcpToken));
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
 * 往指定表里追加记录（飞书字段名 → 值；数字/日期字段传数字，日期为毫秒时间戳）。
 * 仅管理端（MCP_TOKEN）可用——写操作会改变团队底表。
 */
async function toolAddRecords(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) {
    throw new Error("add_records 仅管理端可用（需 MCP_TOKEN）：写操作会改变团队底表");
  }
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    throw new Error("飞书自建应用未配置（FEISHU_APP_ID / FEISHU_APP_SECRET）");
  }
  const table = String(args.table ?? "") as DashTable;
  if (!DASH_TABLES.includes(table)) {
    throw new Error(`table 必须是：${DASH_TABLES.join(" | ")}`);
  }
  const records = (args.records ?? []) as Array<Record<string, unknown>>;
  if (!Array.isArray(records) || records.length === 0) throw new Error("records 不能为空");
  if (records.length > 100) throw new Error("单次最多写入 100 条");
  for (const [i, r] of records.entries()) {
    if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).length === 0) {
      throw new Error(`第 ${i + 1} 条记录为空或非法`);
    }
  }

  const cfg = await getDashboardConfig(env);
  const tableId = cfg?.tables?.[table];
  if (!cfg || !tableId) {
    throw new Error(`尚未配置 ${table} 表：先调用 setup_bitable 或 config_dashboard`);
  }
  const token = await getTenantAccessToken(env);

  // 先取字段清单校验字段名，避免飞书报含义不清的 FieldNameNotFound
  const fieldsResp = await fetch(`${FEISHU_API}/bitable/v1/apps/${cfg.base}/tables/${tableId}/fields`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const fieldsData = (await fieldsResp.json()) as {
    code?: number;
    msg?: string;
    data?: { items?: Array<{ field_name?: string }> };
  };
  if (fieldsData.code !== 0) {
    throw new Error(`读取 ${table} 字段失败：${fieldsData.msg ?? `code ${fieldsData.code}`}`);
  }
  const validNames = new Set((fieldsData.data?.items ?? []).map((f) => f.field_name));
  const badKeys = new Set<string>();
  for (const r of records) {
    for (const k of Object.keys(r)) if (!validNames.has(k)) badKeys.add(k);
  }
  if (badKeys.size > 0) {
    throw new Error(
      `字段不存在：${[...badKeys].join("、")}。${table} 现有字段：${[...validNames].join("、")}`,
    );
  }

  const resp = await fetch(`${FEISHU_API}/bitable/v1/apps/${cfg.base}/tables/${tableId}/records/batch_create`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ records: records.map((fields) => ({ fields })) }),
  });
  const data = (await resp.json()) as {
    code?: number;
    msg?: string;
    data?: { records?: Array<{ record_id?: string }> };
  };
  if (data.code !== 0) {
    throw new Error(`飞书写入失败：${data.msg ?? `code ${data.code}`}`);
  }
  const ids = (data.data?.records ?? []).map((r) => r.record_id).filter(Boolean);
  return {
    content: [
      {
        type: "text",
        text: `✅ 已写入 ${ids.length} 条记录到 ${table}：\n${ids.join("\n")}`,
      },
    ],
  };
}

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
      const fields = BITABLE_SCHEMAS[t].map((f) => ({
        field_name: f.name,
        type: f.type,
        // 数字字段需 formatter；日期字段需 date_formatter
        property: f.type === 2 ? { formatter: "0" } : f.type === 5 ? { date_formatter: "yyyy/MM/dd" } : f.property,
      }));
      const resp = await fetch(`${FEISHU_API}/bitable/v1/apps/${base}/tables`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ table: { name: TABLE_DISPLAY_NAMES[t], fields } }),
      });
      const data = (await resp.json()) as { code?: number; msg?: string; data?: { table_id?: string } };
      if (data.code !== 0 || !data.data?.table_id) {
        throw new Error(`${data.msg ?? "unknown"}（code ${data.code}）`);
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
    const { repos, errors } = await fetchAllRepos(env);
    await env.REGISTRY.put(cacheKey, JSON.stringify({ data: repos, cachedAt: Date.now() }), { expirationTtl: REPOS_CACHE_TTL_SEC });
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
  return { repos, errors };
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

// ---------- 审批与通知中心（PRD V1.1 Plan B：状态机落多维表格"状态"字段 + 群机器人通知） ----------

/** 审批流程类型（四条业务线；新增流程 = flows:config 加配置 + 建底表，零代码） */
const APPROVAL_TYPES = ["reimburse", "drawing", "hardware", "compliance"] as const;
type ApprovalType = (typeof APPROVAL_TYPES)[number];

/** 审批流程配置（KV key: flows:config，由 MCP config_flows 管理） */
interface FlowConfig {
  engine: "table" | "feishu";   // 本期全部 table；feishu 为预留（引擎切换只换该字段）
  tableId: string;              // 底表 table_id（tbl 开头），空 = 未配置
  base: string;                 // 多维表格 app_token；空则 fallback dashboard:config.base
  prefix: string;               // 单号前缀 BX/MECH/HW/CP
  group: string | null;         // 限定提交组别（null=全队）
  approvers: {
    roles: string;              // 正则串，如 "队长|财务"
    groupLeaders?: string[];    // 这些组的组长可审，如 ["机械组"]
  };
  /** ≥coSign 金额时额外通知（Plan B 用通知实现会签，两级审批为 Plan A 能力） */
  thresholds?: { notifyRoles?: string; amountField?: string; coSign?: number };
  required: string[];           // 必填字段名（与底表字段名一致）
  conditional?: Array<{ when: { field: string; equals: string }; require: string[] }>;
}

type FlowsConfig = Record<ApprovalType, FlowConfig>;

/** 默认流程配置（tableId/base 留空待 config_flows 配置；字段与 PRD §6.1 对齐） */
const DEFAULT_FLOWS: FlowsConfig = {
  reimburse: {
    engine: "table",
    tableId: "",
    base: "",
    prefix: "BX",
    group: null,
    approvers: { roles: "队长|财务" },
    required: ["事项", "报销金额", "发票号"],
    conditional: [{ when: { field: "发票照片", equals: "" }, require: ["无票说明"] }],
  },
  drawing: {
    engine: "table",
    tableId: "",
    base: "",
    prefix: "MECH",
    group: "机械组",
    approvers: { roles: "队长", groupLeaders: ["机械组"] },
    thresholds: { notifyRoles: "队长", amountField: "预估加工费", coSign: 500 },
    required: ["图纸名称", "图号", "版本", "所属机构", "材料与工艺", "加工方式", "图纸文件"],
    conditional: [{ when: { field: "加工方式", equals: "外协加工" }, require: ["预估加工费"] }],
  },
  hardware: {
    engine: "table",
    tableId: "",
    base: "",
    prefix: "HW",
    group: null,
    approvers: { roles: "队长|指导老师" },
    thresholds: { notifyRoles: "队长|指导老师", amountField: "预估总价", coSign: 200 },
    required: ["申请类型", "物料名称", "规格型号", "数量", "预估总价", "用途说明"],
    conditional: [{ when: { field: "申请类型", equals: "新购" }, require: ["购买链接"] }],
  },
  compliance: {
    engine: "table",
    tableId: "",
    base: "",
    prefix: "CP",
    group: null,
    approvers: { roles: "队长|指导老师", groupLeaders: ["运营组", "宣传组"] },
    required: ["合规类型", "标题", "内容说明", "计划发布时间"],
    conditional: [{ when: { field: "赞助商相关", equals: "是" }, require: ["赞助商要求"] }],
  },
};

/** 读 flows:config；无配置/损坏返回默认值 deep copy；与默认值深合并保证向前兼容 */
async function getFlowsConfig(env: Env): Promise<FlowsConfig> {
  const raw = await env.REGISTRY.get("flows:config");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<FlowsConfig>;
      const out = {} as FlowsConfig;
      for (const t of APPROVAL_TYPES) {
        out[t] = { ...DEFAULT_FLOWS[t], ...(parsed[t] ?? {}) } as FlowConfig;
      }
      return out;
    } catch {
      /* 配置损坏则回退默认值 */
    }
  }
  return JSON.parse(JSON.stringify(DEFAULT_FLOWS)) as FlowsConfig;
}

/** 流程底表所在 base：flows 未配则 fallback 看板配置（通常同一个多维表格） */
async function getFlowBase(env: Env, flow: FlowConfig): Promise<string> {
  if (flow.base) return flow.base;
  const cfg = await getDashboardConfig(env);
  return cfg?.base ?? "";
}

/** 多维表格新增记录，返回 record_id */
async function createBitableRecord(
  token: string,
  appToken: string,
  tableId: string,
  fields: Record<string, unknown>,
): Promise<string> {
  const resp = await fetch(`${FEISHU_API}/bitable/v1/apps/${appToken}/tables/${tableId}/records`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ fields }),
  });
  const data = (await resp.json()) as { code?: number; msg?: string; data?: { record?: { record_id?: string } } };
  if (data.code !== 0 || !data.data?.record?.record_id) {
    throw new Error(`写入多维表格失败（${tableId}）：${data.msg ?? `code ${data.code}`}`);
  }
  return data.data.record.record_id;
}

/** 多维表格更新记录字段（PUT） */
async function updateBitableRecord(
  token: string,
  appToken: string,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const resp = await fetch(`${FEISHU_API}/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ fields }),
  });
  const data = (await resp.json()) as { code?: number; msg?: string };
  if (data.code !== 0) {
    throw new Error(`更新多维表格失败（${tableId}/${recordId}）：${data.msg ?? `code ${data.code}`}`);
  }
}

/** 底表记录链接（通知与待办跳转到飞书处理） */
function bitableRecordLink(base: string, tableId: string, recordId: string): string {
  return `https://www.feishu.cn/base/${base}?table=${tableId}&record=${recordId}`;
}

/** 审批权限判定：角色正则命中，或（组长 ∧ 组在 groupLeaders 名单）；队长硬编码放行（兜底，PRD §3 代理人） */
function isApprover(role: UserRole, approvers: FlowConfig["approvers"]): boolean {
  if (/队长/.test(role.role)) return true;
  if (new RegExp(approvers.roles).test(role.role)) return true;
  return role.role === "组长" && !!role.group && (approvers.groupLeaders ?? []).includes(role.group);
}

/** 声明式字段校验：required + conditional + 数字字段须 >0；返回缺失字段名列表（空=通过） */
function evalFlowFields(flow: FlowConfig, fields: Record<string, unknown>): string[] {
  const missing: string[] = [];
  for (const name of flow.required) {
    if (!fieldText(fields[name]).trim()) missing.push(name);
  }
  for (const cond of flow.conditional ?? []) {
    if (fieldText(fields[cond.when.field]).trim() === cond.when.equals) {
      for (const name of cond.require) {
        if (!fieldText(fields[name]).trim()) missing.push(name);
      }
    }
  }
  for (const name of ["报销金额", "金额", "数量", "预估总价", "预估加工费"]) {
    const v = fieldNum(fields[name]);
    if (v !== null && v <= 0) missing.push(`${name}（须大于 0）`);
  }
  return [...new Set(missing)];
}

/** 在表记录里按"申请单号"字段定位一行（字段名不固定时模糊匹配） */
function findRecordByAppId(records: BitableRecord[], appId: string): BitableRecord | null {
  const key = findFieldKey(records, [/^申请单号$/, /申请单号/, /单号/]);
  if (!key) return null;
  return records.find((r) => fieldText(r.fields[key]) === appId) ?? null;
}

/** 申请单号：<prefix>-<年>-<序号4位>（序号 = 现有记录数 + 1） */
function nextAppId(prefix: string, existingCount: number): string {
  return `${prefix}-${new Date().getFullYear()}-${String(existingCount + 1).padStart(4, "0")}`;
}

/** 审批域错误：带 HTTP 状态码，REST 层直接映射 */
class ApprovalError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ApprovalError";
    this.status = status;
  }
}

/** 动态读 Env 字符串变量（webhook 按流程名拼接变量名用） */
function envSecret(env: Env, key: string): string | undefined {
  return (env as unknown as Record<string, string | undefined>)[key];
}

/** 通知失败记录（KV notify:failed，7 天 TTL，截断 100 条，管理端可查） */
async function recordNotifyFailure(env: Env, flow: string, title: string, detail: string): Promise<void> {
  try {
    const raw = await env.REGISTRY.get("notify:failed");
    let list: Array<{ flow: string; title: string; detail: string; at: string }> = [];
    try {
      list = raw ? (JSON.parse(raw) as typeof list) : [];
    } catch {
      list = [];
    }
    list.unshift({ flow, title, detail, at: new Date().toISOString() });
    await env.REGISTRY.put("notify:failed", JSON.stringify(list.slice(0, 100)), { expirationTtl: 7 * 24 * 3600 });
  } catch {
    /* 记录失败不阻断主流程 */
  }
}

/** 飞书加签：HMAC-SHA256(`${timestamp}\n${secret}`) → Base64 */
async function feishuBotSign(secret: string, timestamp: number): Promise<string> {
  // 飞书官方算法：把 `${timestamp}\n${secret}` 作为 HMAC 密钥，对空内容签名（官方 Python 示例即 hmac.new(string_to_sign, digestmod=sha256)）
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${timestamp}\n${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new Uint8Array(0));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/**
 * 飞书群机器人 webhook 通知（N-01）。
 * webhook 选择：FEISHU_BOT_WEBHOOK_<FLOW> ?? FEISHU_BOT_WEBHOOK；secret 同名 _SECRET 后缀。
 * 失败（网络异常/code!==0）重试 2 次（1s、4s），仍失败写 KV notify:failed；调用方不抛错。
 */
async function notifyFeishu(env: Env, flow: string, title: string, content: string, link?: string): Promise<{ ok: boolean; detail: string }> {
  const flowKey = flow.toUpperCase();
  const webhook = envSecret(env, `FEISHU_BOT_WEBHOOK_${flowKey}`) ?? env.FEISHU_BOT_WEBHOOK;
  if (!webhook) return { ok: false, detail: "未配置 webhook" };
  const secret = envSecret(env, `FEISHU_BOT_WEBHOOK_${flowKey}_SECRET`) ?? env.FEISHU_BOT_WEBHOOK_SECRET;
  const text = title + "\n" + content + (link ? "\n去处理：" + link : "");
  let attempt = 0;
  let lastErr = "";
  while (attempt < 3) {
    attempt++;
    try {
      const body: Record<string, unknown> = { msg_type: "text", content: { text } };
      if (secret) {
        const timestamp = Math.floor(Date.now() / 1000);
        body.timestamp = timestamp;
        body.sign = await feishuBotSign(secret, timestamp);
      }
      const resp = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as { code?: number; msg?: string };
      if (data.code === 0) return { ok: true, detail: "ok" };
      lastErr = data.msg ?? `code ${data.code}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt === 1 ? 1000 : 4000));
  }
  await recordNotifyFailure(env, flow, title, lastErr);
  return { ok: false, detail: `发送失败（重试 2 次）：${lastErr}` };
}

const APPROVAL_LABELS: Record<ApprovalType, string> = {
  reimburse: "报销申请",
  drawing: "图纸审批",
  hardware: "硬件申请",
  compliance: "合规申请",
};

/** 通知标题：📋 新报销申请 BX-2026-0001（张三 ¥120） */
function approvalNotifyTitle(type: ApprovalType, applicationId: string, applicant: string, fields: Record<string, unknown>): string {
  let extra = "";
  if (type === "reimburse") {
    const amount = fieldNum(fields["报销金额"]);
    if (amount !== null) extra = ` ¥${amount}`;
  }
  return `📋 新${APPROVAL_LABELS[type]} ${applicationId}（${applicant}${extra}）`;
}

/** 通知正文：取前几个非空业务字段（key：value 逐行） */
function approvalNotifyContent(fields: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of Object.keys(fields)) {
    if (k === "applicant_open_id") continue;
    const v = fieldText(fields[k]).trim();
    if (!v) continue;
    parts.push(`${k}：${v.length > 60 ? v.slice(0, 60) + "…" : v}`);
    if (parts.length >= 4) break;
  }
  return parts.join("\n") || "（无附加信息）";
}

// ---------- 审批引擎（REST 与 MCP 共用的核心） ----------

interface ApprovalSubmitInput {
  type: ApprovalType;
  fields: Record<string, unknown>;
  /** 门户提交：当前登录用户；MCP 代提交：null */
  user: HubUser | null;
  /** 当前用户角色（门户路径）；MCP 代提交为 null（组别写空） */
  role: UserRole | null;
  /** MCP 代提交的申请人姓名（门户路径忽略） */
  applicantName?: string;
  source: "portal" | "mcp";
}

/** 发起审批：校验 → 写底表（状态=审批中）→ 单号回填 → KV 映射 → 通知审批人群 */
async function submitApprovalCore(env: Env, input: ApprovalSubmitInput): Promise<{ application_id: string; status: string }> {
  const cfg = await getFlowsConfig(env);
  const flow = cfg[input.type];
  if (!flow.tableId) {
    throw new ApprovalError(`流程未配置：先用 MCP config_flows 配置 ${input.type} 的 tableId`);
  }
  const applicant = input.user?.name ?? (input.applicantName ?? "").trim();
  if (!applicant) {
    throw new ApprovalError("申请人姓名为空：门户提交需登录，MCP 代提交需 applicant_name");
  }
  const applicantOpenId = input.user?.open_id ??
    (String(input.fields.applicant_open_id ?? "").trim() || "mcp-admin");
  const missing = evalFlowFields(flow, input.fields);
  if (missing.length) {
    throw new ApprovalError(`字段校验未通过，缺少：${missing.join("、")}`);
  }
  const base = await getFlowBase(env, flow);
  if (!base) {
    throw new ApprovalError("流程未配置 base：先用 config_flows 配置 base（或 config_dashboard 配置看板 base）");
  }
  const token = await getTenantAccessToken(env);
  const existing = await listBitableRecords(token, base, flow.tableId);
  const applicationId = nextAppId(flow.prefix, existing.length);
  const row: Record<string, unknown> = {
    ...input.fields,
    申请人: applicant,
    "申请人 open_id": applicantOpenId,
    组别: input.role?.group ?? "",
    状态: "审批中",
    提交时间: Date.now(),
    申请单号: applicationId,
  };
  const recordId = await createBitableRecord(token, base, flow.tableId, row);
  await env.REGISTRY.put(
    `approval:map:${applicationId}`,
    JSON.stringify({ type: input.type, record_id: recordId }),
    { expirationTtl: 90 * 24 * 3600 },
  );
  const link = bitableRecordLink(base, flow.tableId, recordId);
  await notifyFeishu(env, input.type, approvalNotifyTitle(input.type, applicationId, applicant, input.fields), approvalNotifyContent(input.fields), link);
  // Plan B 会签：金额达阈值时额外提醒（两级审批为 Plan A 能力，Plan B 用通知实现）
  const coField = flow.thresholds?.amountField ?? "";
  const coSign = flow.thresholds?.coSign ?? 0;
  const amount = coField ? fieldNum(input.fields[coField]) : null;
  if (coSign > 0 && amount !== null && amount >= coSign && flow.thresholds?.notifyRoles) {
    await notifyFeishu(
      env,
      input.type,
      `⚠️ 金额会签提醒 ${applicationId}：${coField} ¥${amount} ≥ ${coSign}`,
      `请 ${flow.thresholds.notifyRoles} 复核`,
      link,
    );
  }
  return { application_id: applicationId, status: "审批中" };
}

// ---------- 审批 REST 处理器 ----------

async function handleApprovalSubmit(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const session = await resolveSession(env, request);
  if (!session) return json({ error: "unauthorized" }, 401);
  const role = await resolveUserRole(env, session.user);
  if (role.role === "external") return json({ error: "forbidden", role: role.role }, 403);
  const body = (await request.json().catch(() => ({}))) as { type?: string; fields?: Record<string, unknown> };
  const type = String(body.type ?? "") as ApprovalType;
  if (!APPROVAL_TYPES.includes(type)) {
    return json({ error: `type 必须是：${APPROVAL_TYPES.join(" | ")}` }, 400);
  }
  const cfg = await getFlowsConfig(env);
  const flow = cfg[type];
  if (!flow.tableId) {
    return json({ error: `流程未配置：先用 MCP config_flows 配置 ${type} 的 tableId` }, 400);
  }
  if (flow.group && role.group !== flow.group && !/队长/.test(role.role)) {
    return json({ error: "forbidden", role: role.role, hint: `该流程仅限 ${flow.group} 提交` }, 403);
  }
  try {
    return json(await submitApprovalCore(env, { type, fields: body.fields ?? {}, user: session.user, role, source: "portal" }));
  } catch (err) {
    if (err instanceof ApprovalError) return json({ error: err.message }, err.status);
    throw err;
  }
}

const APPROVAL_ACTIONS = ["approve", "reject", "pay", "start", "archive", "arrive", "issue", "publish"] as const;
type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

/** 动作 → 目标状态与前置状态（幂等：目标状态=当前状态直接返回成功） */
const ACTION_TARGET: Record<ApprovalAction, { from: RegExp; to: string }> = {
  approve: { from: /^审批中$/, to: "已通过" },
  reject: { from: /^审批中$/, to: "已驳回" },
  pay: { from: /^已通过$/, to: "已打款" },
  start: { from: /^已通过$/, to: "加工中" },
  archive: { from: /^加工中$/, to: "已归档" },
  arrive: { from: /^已通过$/, to: "已到货" },
  issue: { from: /^已通过$/, to: "已领用" },
  publish: { from: /^已通过$/, to: "已发布" },
};

interface ApprovalActionInput {
  type: ApprovalType;
  appId: string;
  action: ApprovalAction;
  comment?: string;
  link?: string;
  user: HubUser;
  role: UserRole;
}

async function runApprovalAction(env: Env, input: ApprovalActionInput): Promise<{ application_id: string; status: string }> {
  const cfg = await getFlowsConfig(env);
  const flow = cfg[input.type];
  if (!flow.tableId) {
    throw new ApprovalError(`流程未配置：先用 MCP config_flows 配置 ${input.type} 的 tableId`);
  }
  const base = await getFlowBase(env, flow);
  if (!base) throw new ApprovalError("流程未配置 base");
  const token = await getTenantAccessToken(env);
  const records = await listBitableRecords(token, base, flow.tableId);
  const record = findRecordByAppId(records, input.appId);
  if (!record) throw new ApprovalError(`底表中未找到申请单号 ${input.appId}`, 404);

  const statusKey = findFieldKey(records, [/^状态$/, /状态/, /进度/]) ?? "状态";
  const current = fieldText(record.fields[statusKey]);
  const target = ACTION_TARGET[input.action].to;

  // 角色前置校验
  if (input.action === "approve" || input.action === "reject" || input.action === "arrive" || input.action === "issue") {
    if (!isApprover(input.role, flow.approvers)) {
      throw new ApprovalError(`当前角色（${input.role.role}）无权执行 ${input.action}`, 403);
    }
  } else if (input.action === "pay") {
    if (!/财务|队长/.test(input.role.role)) {
      throw new ApprovalError("已打款仅财务/队长可标记", 403);
    }
  } else {
    // start / archive / publish：仅申请人本人
    const applicantKey = findFieldKey(records, [/^申请人$/, /申请人/, /报销人/]);
    const openIdKey = findFieldKey(records, [/open_?id|飞书/i]);
    const isOwner =
      (openIdKey && fieldText(record.fields[openIdKey]) === input.user.open_id) ||
      (applicantKey && fieldText(record.fields[applicantKey]) === input.user.name);
    if (!isOwner) throw new ApprovalError("仅申请人本人可执行该动作", 403);
  }

  // 幂等：目标状态=当前状态 → 直接返回当前状态
  if (current === target) return { application_id: input.appId, status: current };
  if (!ACTION_TARGET[input.action].from.test(current)) {
    throw new ApprovalError(`当前状态为「${current || "空"}」，不能执行 ${input.action} →「${target}」`, 409);
  }
  if (input.action === "reject" && !(input.comment ?? "").trim()) {
    throw new ApprovalError("驳回必须填写审批意见（comment）");
  }
  if (input.action === "publish" && !(input.link ?? "").trim()) {
    throw new ApprovalError("publish 必须提供发布链接（link）");
  }

  const patch: Record<string, unknown> = { [statusKey]: target };
  if (input.action === "approve" || input.action === "reject") {
    patch["审批人"] = input.user.name;
    patch["审批意见"] = input.comment ?? "";
    patch["审批完成时间"] = Date.now();
  }
  if (input.action === "publish") patch["发布后链接"] = (input.link ?? "").trim();
  await updateBitableRecord(token, base, flow.tableId, record.record_id, patch);

  const link = bitableRecordLink(base, flow.tableId, record.record_id);
  if (input.action === "approve" || input.action === "reject") {
    const verdict = input.action === "approve" ? "✅ 已通过" : "❌ 已驳回";
    await notifyFeishu(
      env,
      input.type,
      `${verdict} ${input.appId}`,
      `审批人：${input.user.name}${input.comment ? `\n审批意见：${input.comment}` : ""}`,
      link,
    );
  } else {
    await notifyFeishu(env, input.type, `📌 ${input.appId} 状态更新：${target}`, `操作人：${input.user.name}`, link);
  }
  return { application_id: input.appId, status: target };
}

async function handleApprovalAction(
  request: Request,
  env: Env,
  type: string,
  appId: string,
  action: string,
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const session = await resolveSession(env, request);
  if (!session) return json({ error: "unauthorized" }, 401);
  if (!APPROVAL_TYPES.includes(type as ApprovalType)) return json({ error: `未知流程 type：${type}` }, 400);
  if (!APPROVAL_ACTIONS.includes(action as ApprovalAction)) return json({ error: `未知动作：${action}` }, 400);
  const body = (await request.json().catch(() => ({}))) as { comment?: string; link?: string };
  try {
    return json(
      await runApprovalAction(env, {
        type: type as ApprovalType,
        appId,
        action: action as ApprovalAction,
        comment: body.comment,
        link: body.link,
        user: session.user,
        role: await resolveUserRole(env, session.user),
      }),
    );
  } catch (err) {
    if (err instanceof ApprovalError) return json({ error: err.message }, err.status);
    throw err;
  }
}

// ---------- 待办聚合（GET /api/todos + MCP list_todos 共用） ----------

const TODO_CACHE_TTL_SEC = 300;

/**
 * 待办聚合：4 张流程底表中 状态="审批中" 且当前角色可审的行（按 type 分组）+ 逾期任务前 8 条。
 * 缓存键 todo:tbl:<type> 存全量列表（不带用户过滤，过滤在内存做，保证各角色角标一致）。
 */
async function aggregateTodos(env: Env, role: UserRole): Promise<unknown> {
  const cfg = await getFlowsConfig(env);
  const dashCfg = await getDashboardConfig(env);
  const token = await getTenantAccessToken(env).catch(() => "");
  const byType: Record<string, unknown> = {};
  let cachedAt = "";

  for (const type of APPROVAL_TYPES) {
    const flow = cfg[type];
    if (!flow.tableId) continue;
    const base = flow.base || dashCfg?.base || "";
    if (!base) continue;
    const cacheKey = `todo:tbl:${type}`;
    const cached = await env.REGISTRY.get(cacheKey, "json") as
      | { data: BitableRecord[]; cachedAt: number }
      | null;
    const fresh = cached && cached.cachedAt > Date.now() - TODO_CACHE_TTL_SEC * 1000;
    let records: BitableRecord[];
    let at: string;
    if (fresh) {
      records = cached.data;
      at = new Date(cached.cachedAt).toISOString();
    } else if (token) {
      try {
        records = await listBitableRecords(token, base, flow.tableId);
        at = new Date().toISOString();
        await env.REGISTRY.put(cacheKey, JSON.stringify({ data: records, cachedAt: Date.now() }), { expirationTtl: TODO_CACHE_TTL_SEC });
      } catch {
        records = cached?.data ?? [];
        at = cached ? new Date(cached.cachedAt).toISOString() : "";
      }
    } else {
      records = cached?.data ?? [];
      at = cached ? new Date(cached.cachedAt).toISOString() : "";
    }
    if (!cachedAt && at) cachedAt = at;
    if (!isApprover(role, flow.approvers)) continue;
    const statusKey = findFieldKey(records, [/^状态$/, /状态/, /进度/]) ?? "状态";
    const idKey = findFieldKey(records, [/^申请单号$/, /申请单号/, /单号/]);
    const timeKey = findFieldKey(records, [/提交时间/, /创建时间/]);
    const pending = records.filter((r) => fieldText(r.fields[statusKey]) === "审批中");
    if (!pending.length) continue;
    byType[type] = pending.map((r) => ({
      application_id: idKey ? fieldText(r.fields[idKey]) : r.record_id,
      title: ((idKey ? fieldText(r.fields[idKey]) : "") + " " + firstFieldText(r)).trim(),
      url: bitableRecordLink(base, flow.tableId, r.record_id),
      submitted_at: timeKey ? fieldText(r.fields[timeKey]) : "",
    }));
  }

  // 逾期任务（复用看板 tasks 表 + 5 分钟缓存）：截止 < 今天 且状态未完成，前 8 条
  const overdueTasks: Array<{ title: string; owner: string; deadline: string }> = [];
  if (dashCfg?.tables?.tasks && token) {
    const t = await fetchTableCached(env, dashCfg, "tasks");
    const tTitleKey = findFieldKey(t.records, [/^任务/, /任务/, /事项/, /标题/, /title/i]);
    const tOwnerKey = findFieldKey(t.records, [/负责人/, /执行人/, /owner/i, /assignee/i]);
    const tStatusKey = findFieldKey(t.records, [/^状态/, /状态/, /进度/, /status/i]);
    const tDeadlineKey = findFieldKey(t.records, [/截止/, /deadline/i, /完成时间/, /日期/]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    overdueTasks.push(
      ...t.records
        .filter((r) => {
          const s = tStatusKey ? fieldText(r.fields[tStatusKey]) : "";
          const d = tDeadlineKey ? fieldNum(r.fields[tDeadlineKey]) : null;
          return !!s && !TASK_DONE_RE.test(s) && d !== null && d < today.getTime();
        })
        .sort((a, b) => (fieldNum(a.fields[tDeadlineKey ?? ""]) ?? Infinity) - (fieldNum(b.fields[tDeadlineKey ?? ""]) ?? Infinity))
        .slice(0, 8)
        .map((r) => ({
          title: (tTitleKey ? fieldText(r.fields[tTitleKey]) : "") || firstFieldText(r),
          owner: tOwnerKey ? fieldText(r.fields[tOwnerKey]) : "",
          deadline: tDeadlineKey ? fieldText(r.fields[tDeadlineKey]) : "",
        })),
    );
  }
  return { by_type: byType, overdue_tasks: overdueTasks, cached_at: cachedAt || new Date().toISOString() };
}

async function handleTodos(env: Env, request: Request): Promise<Response> {
  const session = await resolveSession(env, request);
  if (!session) return json({ error: "unauthorized" }, 401);
  const role = await resolveUserRole(env, session.user);
  return json(await aggregateTodos(env, role));
}

/** 我的申请列表（R-01「我的报销」数据源）：按 open_id 过滤 → 提交时间降序 → 前 20 条 */
async function handleApprovalMine(env: Env, request: Request): Promise<Response> {
  const session = await resolveSession(env, request);
  if (!session) return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const type = (url.searchParams.get("type") ?? "reimburse") as ApprovalType;
  if (!APPROVAL_TYPES.includes(type)) {
    return json({ error: `type 必须是：${APPROVAL_TYPES.join(" | ")}` }, 400);
  }
  const cfg = await getFlowsConfig(env);
  const flow = cfg[type];
  if (!flow.tableId) return json({ records: [], hint: "流程未配置" });
  const base = await getFlowBase(env, flow);
  if (!base) return json({ records: [], hint: "流程未配置" });
  const token = await getTenantAccessToken(env);
  const records = await listBitableRecords(token, base, flow.tableId);
  const mine = records
    .filter((r) => fieldText(r.fields["申请人 open_id"]) === session.user.open_id)
    .sort((a, b) => (fieldNum(b.fields["提交时间"]) ?? 0) - (fieldNum(a.fields["提交时间"]) ?? 0))
    .slice(0, 20);
  return json({
    records: mine.map((r) => {
      const f = r.fields;
      return {
        application_id: fieldText(f["申请单号"]),
        status: fieldText(f["状态"]),
        fields: {
          申请单号: fieldText(f["申请单号"]),
          事项: fieldText(f["事项"]),
          金额: fieldNum(f["金额"]),
          状态: fieldText(f["状态"]),
          提交时间: fieldNum(f["提交时间"]),
          审批人: fieldText(f["审批人"]),
          审批意见: fieldText(f["审批意见"]),
        },
      };
    }),
  });
}

// ---------- 审批相关 MCP 工具实现 ----------

/** submit_approval：代发起审批（需 MCP_TOKEN） */
async function toolSubmitApproval(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) throw new Error("submit_approval 仅管理端可用（需 MCP_TOKEN）");
  const type = String(args.type ?? "") as ApprovalType;
  if (!APPROVAL_TYPES.includes(type)) {
    throw new Error(`type 必须是：${APPROVAL_TYPES.join(" | ")}`);
  }
  const fields = (args.fields ?? {}) as Record<string, unknown>;
  if (typeof fields !== "object" || Array.isArray(fields)) throw new Error("fields 必须是对象");
  const result = await submitApprovalCore(env, {
    type,
    fields,
    user: null,
    role: null,
    applicantName: String(args.applicant_name ?? ""),
    source: "mcp",
  });
  return {
    content: [
      { type: "text", text: `✅ 已代提交：${result.application_id}（${result.status}）` },
    ],
  };
}

/** list_todos：按 open_id 聚合待办（需 MCP_TOKEN） */
async function toolListTodos(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) throw new Error("list_todos 仅管理端可用（需 MCP_TOKEN）");
  const openId = String(args.open_id ?? "").trim();
  if (!openId) throw new Error("open_id 不能为空");
  const role = await resolveUserRole(env, { name: "", open_id: openId });
  const todos = await aggregateTodos(env, role);
  return {
    content: [
      {
        type: "text",
        text:
          `待办聚合（角色：${role.role}${role.group ? " · " + role.group : ""}${role.matched ? "" : "，未匹配名单"}）：\n` +
          JSON.stringify(todos, null, 2),
      },
    ],
  };
}

/** send_notice：向流程群发机器人通知（需 MCP_TOKEN） */
async function toolSendNotice(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) throw new Error("send_notice 仅管理端可用（需 MCP_TOKEN）");
  const flow = String(args.flow ?? "").trim();
  const title = String(args.title ?? "").trim();
  const content = String(args.content ?? "").trim();
  if (!title) throw new Error("title 不能为空");
  if (!content) throw new Error("content 不能为空");
  const link = String(args.link ?? "").trim();
  const result = await notifyFeishu(env, flow, title, content, link || undefined);
  if (!result.ok) {
    return { content: [{ type: "text", text: `⚠️ 通知未送达：${result.detail}（已按降级处理，业务不受影响）` }] };
  }
  return { content: [{ type: "text", text: `✅ 已发送（flow=${flow || "default"}）` }] };
}

/** config_flows：查看/修改 flows:config（需 MCP_TOKEN）；set 时深合并 + 校验 */
async function toolConfigFlows(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) throw new Error("config_flows 仅管理端可用（需 MCP_TOKEN）");
  const action = String(args.action ?? "get");
  if (action === "get") {
    const cfg = await getFlowsConfig(env);
    return {
      content: [
        { type: "text", text: `当前 flows:config：\n${JSON.stringify(cfg, null, 2)}` },
      ],
    };
  }
  if (action !== "set") throw new Error("action 必须是 get | set");
  const raw = (args.flows ?? {}) as Record<string, unknown>;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("flows 必须是对象");
  const current = await getFlowsConfig(env);
  for (const t of APPROVAL_TYPES) {
    const patch = raw[t] as Record<string, unknown> | undefined;
    if (!patch) continue;
    if (typeof patch !== "object" || Array.isArray(patch)) throw new Error(`flows.${t} 必须是对象`);
    if (patch.approvers !== undefined &&
        (typeof patch.approvers !== "object" ||
         typeof (patch.approvers as FlowConfig["approvers"]).roles !== "string")) {
      throw new Error(`approvers 不合法（${t}）：应为 { roles: "队长|财务", groupLeaders?: [...] }`);
    }
    if (patch.thresholds !== undefined && (typeof patch.thresholds !== "object" || Array.isArray(patch.thresholds))) {
      throw new Error(`thresholds 不合法（${t}）：应为 { notifyRoles?, amountField?, coSign? }`);
    }
    if (patch.required !== undefined && !Array.isArray(patch.required)) {
      throw new Error(`required 不合法（${t}）：应为字段名数组`);
    }
    if (patch.conditional !== undefined && !Array.isArray(patch.conditional)) {
      throw new Error(`conditional 不合法（${t}）：应为 [{ when: { field, equals }, require: [...] }]`);
    }
    const merged = { ...current[t], ...patch } as FlowConfig;
    if (merged.tableId && !/^tbl[A-Za-z0-9]+$/.test(merged.tableId)) {
      throw new Error(`table_id 不合法（${t}）：应以 tbl 开头或留空`);
    }
    if (merged.base && !/^[A-Za-z0-9]{10,}$/.test(merged.base)) {
      throw new Error(`base 不合法（${t}）：应为多维表格 URL 中 /base/ 后的 app_token`);
    }
    try {
      new RegExp(merged.approvers?.roles ?? "");
    } catch {
      throw new Error(`approvers.roles 不是合法正则（${t}）`);
    }
    current[t] = merged;
  }
  await env.REGISTRY.put("flows:config", JSON.stringify(current));
  // 配置变更后清待办缓存，下一次拉取按新配置走
  await Promise.all(APPROVAL_TYPES.map((t) => env.REGISTRY.delete(`todo:tbl:${t}`)));
  return {
    content: [
      {
        type: "text",
        text:
          `✅ flows:config 已保存（${APPROVAL_TYPES.join(" / ")}）。\n` +
          `tableId/base 为空的流程会在发起与待办时提示先配置（config_flows set 或 config_dashboard）。`,
      },
    ],
  };
}

// ---------- 动态 PRD 看板（状态经 MCP update_prd 维护；git 提交经 /api/hooks/github 推送） ----------

const PRD_STATUSES = ["done", "partial", "pending", "todo"] as const;
type PrdStatus = (typeof PRD_STATUSES)[number];

interface PrdItem {
  title: string;
  priority: "P0" | "P1" | "P2";
  status: PrdStatus;
  note?: string;
}

/** 初始看板 = PRD V2.0 §5 盘点基线（2026-10-12）；后续用 update_prd 维护，KV prd:status 覆盖本默认值 */
const DEFAULT_PRD_ITEMS: Record<string, PrdItem> = {
  "FE-01": { title: "飞书 OAuth 登录态与权限角色", priority: "P0", status: "done", note: "真实队长登录已验证" },
  "FE-02": { title: "数据基建落地与看板接入", priority: "P0", status: "partial", note: "4 表建成读真实数据；待团队录数据过验收" },
  "FE-11": { title: "飞书工作台入口切换", priority: "P1", status: "pending", note: "免费版路径：改应用 URL 为 hub，差发版" },
  "FE-03": { title: "资料页", priority: "P1", status: "partial", note: "功能上线；待填充内容（每类 ≥3 条）" },
  "FE-04": { title: "赛季目标可视化面板", priority: "P1", status: "todo" },
  "FE-05": { title: "数据校验 Agent", priority: "P1", status: "partial", note: "规则引擎上线；定时推送待配群机器人" },
  "FE-08": { title: "报销助手标杆应用", priority: "P1", status: "todo", note: "add_records 回写已就位" },
  "FE-10": { title: "品牌规范 Skill", priority: "P1", status: "partial", note: "nec-vi / nec-ppt 已上架" },
  "FE-06": { title: "千人千面「改我的首页」", priority: "P2", status: "todo" },
  "FE-07": { title: "组别默认首页", priority: "P2", status: "todo" },
  "FE-09": { title: "审批/待办聚合", priority: "P2", status: "partial", note: "并行会话已建 Plan B 审批引擎 v1" },
  "FE-12": { title: "Skill 仓库 CI", priority: "P2", status: "todo" },
  "FE-13": { title: "运营配置自动化复查（lark-cli）", priority: "P2", status: "todo" },
};

const PRD_MILESTONES = [
  { id: "M1", title: "地基", items: ["FE-01", "FE-02", "FE-11"] },
  { id: "M2", title: "资产与智能", items: ["FE-03", "FE-04", "FE-05", "FE-08", "FE-10"] },
  { id: "M3", title: "个性化与自动化", items: ["FE-06", "FE-07", "FE-09", "FE-12", "FE-13"] },
];

async function buildPrdBoard(env: Env): Promise<unknown> {
  const raw = await env.REGISTRY.get("prd:status");
  let items = { ...DEFAULT_PRD_ITEMS };
  let updatedAt = "2026-10-12T00:00:00.000Z";
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { items?: Record<string, PrdItem>; updatedAt?: string };
      if (parsed.items) items = { ...DEFAULT_PRD_ITEMS, ...parsed.items };
      if (parsed.updatedAt) updatedAt = parsed.updatedAt;
    } catch { /* 用默认 */ }
  }
  const lastCommitRaw = await env.REGISTRY.get("prd:last_commit");
  let lastCommit: unknown = null;
  try {
    lastCommit = lastCommitRaw ? JSON.parse(lastCommitRaw) : null;
  } catch { lastCommit = null; }

  const milestones = PRD_MILESTONES.map((m) => ({
    ...m,
    done: m.items.filter((id) => items[id]?.status === "done").length,
    total: m.items.length,
    cards: m.items.map((id) => ({ id, ...(items[id] ?? { title: id, priority: "P2" as const, status: "todo" as const }) })),
  }));
  const all = Object.values(items);
  return {
    doc: "docs/团队AI中台PRD_V2.0.md",
    updatedAt,
    progress: { done: all.filter((i) => i.status === "done").length, total: all.length },
    milestones,
    lastCommit,
  };
}

async function toolUpdatePrd(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) throw new Error("update_prd 仅管理端可用（需 MCP_TOKEN）");
  const id = String(args.id ?? "").trim().toUpperCase();
  const status = String(args.status ?? "").trim() as PrdStatus;
  if (!DEFAULT_PRD_ITEMS[id]) throw new Error(`未知需求 id：${id}（FE-01 ~ FE-13）`);
  if (!PRD_STATUSES.includes(status)) {
    throw new Error(`status 必须是：${PRD_STATUSES.join(" | ")}`);
  }
  const note = args.note != null ? String(args.note) : undefined;

  const raw = await env.REGISTRY.get("prd:status");
  let data: { items: Record<string, PrdItem>; updatedAt: string };
  try {
    data = raw ? (JSON.parse(raw) as typeof data) : { items: {}, updatedAt: "" };
  } catch {
    data = { items: {}, updatedAt: "" };
  }
  const prev = data.items[id]?.status;
  data.items[id] = { ...DEFAULT_PRD_ITEMS[id], ...data.items[id], status, ...(note !== undefined ? { note } : {}) };
  data.updatedAt = new Date().toISOString();
  await env.REGISTRY.put("prd:status", JSON.stringify(data));

  // 状态变化推群（未配置 webhook 时静默跳过，由 notifyFeishu 内部留痕）
  if (prev !== status) {
    await notifyFeishu(env, "prd", `📋 PRD 状态变更：${id} → ${status}`,
      `${data.items[id].title}${note ? `\n备注：${note}` : ""}`,
      "https://hub.newenergycoder.club");
  }
  return {
    content: [{ type: "text", text: `✅ ${id} 状态已更新：${prev ?? "-"} → ${status}（看板 /api/prd 与门户「PRD 看板」Tab 已同步）` }],
  };
}

/** GitHub push webhook：验签 → 记录最近提交 → 推群通知 */
async function handleGithubPush(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_WEBHOOK_SECRET) {
    return json({ error: "未配置 GITHUB_WEBHOOK_SECRET：先用 wrangler secret put GITHUB_WEBHOOK_SECRET 设置后，再在 GitHub 仓库 Settings → Webhooks 添加 https://hub.newenergycoder.club/api/hooks/github（Content type: application/json，secret 同上）" }, 500);
  }
  const bodyText = await request.text();
  const sig = request.headers.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + (await hmacSha256Hex(env.GITHUB_WEBHOOK_SECRET, bodyText));
  if (!(await timingSafeEqual(sig, expected))) {
    return json({ error: "signature mismatch" }, 401);
  }
  if (request.headers.get("x-github-event") !== "push") {
    return json({ ok: true, ignored: "not a push event" });
  }
  let payload: {
    ref?: string;
    repository?: { full_name?: string; html_url?: string };
    head_commit?: { message?: string; author?: { name?: string }; url?: string; timestamp?: string } | null;
    commits?: Array<{ message?: string; author?: { name?: string }; url?: string; timestamp?: string }>;
  };
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const branch = (payload.ref ?? "").replace("refs/heads/", "") || "main";
  const commit = payload.head_commit ?? payload.commits?.[payload.commits.length - 1] ?? null;
  if (!commit) return json({ ok: true, ignored: "no commit" });

  const shortMsg = String(commit.message ?? "").split("\n")[0].slice(0, 80);
  const author = commit.author?.name ?? "unknown";
  const repo = payload.repository?.full_name ?? "nec-hub";
  const entry = {
    repo, branch, message: shortMsg, author,
    url: commit.url ?? payload.repository?.html_url ?? "",
    at: new Date().toISOString(),
  };
  await env.REGISTRY.put("prd:last_commit", JSON.stringify(entry), { expirationTtl: 30 * 24 * 3600 });
  const pushResult = await notifyFeishu(env, "prd", `🔀 ${repo} 新提交（${branch}）`, `${shortMsg} — ${author}`, entry.url);
  return json({ ok: true, commit: entry, notified: pushResult.ok, notifyDetail: pushResult.detail });
}

/** HMAC-SHA256 → 小写 hex（GitHub webhook 验签用） */
async function hmacSha256Hex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
