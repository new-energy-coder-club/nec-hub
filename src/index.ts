/**
 * NEC 团队 AI 中台 — 单体 Worker
 * 路由：
 *   GET  /                → 门户静态页（Assets）
 *   GET  /api/health      → 健康检查
 *   GET  /api/apps        → 应用广场注册表（KV）
 *   GET  /api/skills      → Skill 中心注册表（KV）
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
      if (url.pathname === "/api/health") {
        return json({ ok: true, service: env.HUB_NAME ?? "nec-hub", time: new Date().toISOString() });
      }
      if (url.pathname === "/api/apps") {
        return json(await readIndex<AppEntry>(env, "apps:index"));
      }
      if (url.pathname === "/api/skills") {
        return json(await readIndex<SkillEntry>(env, "skills:index"));
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

  return new Response(
    JSON.stringify({
      name: userData.data.name,
      en_name: userData.data.en_name,
      open_id: userData.data.open_id,
      avatar_url: userData.data.avatar_url,
    }),
    { headers: { "content-type": "application/json; charset=utf-8", ...cors } },
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

// ---------- 应用 / Skill 托管 ----------

async function serveApp(url: URL, env: Env): Promise<Response> {
  // /apps/<name>/<rest...>
  const parts = url.pathname.replace(/^\/apps\//, "").split("/").filter(Boolean);
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
    description: "只读查询飞书多维表格（队员名单/任务进度/物资台账/财务报销）。需先配置飞书自建应用凭证。",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "表名：members | tasks | inventory | finance" },
        filter: { type: "string", description: "可选过滤条件（自然语言）" },
      },
      required: ["table"],
    },
  },
];

async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (env.MCP_TOKEN) {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!(await timingSafeEqual(token, env.MCP_TOKEN))) {
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
        serverInfo: { name: "nec-hub-mcp", version: "0.1.0" },
        instructions:
          "NEC 团队 AI 中台 MCP。deploy_app 部署静态应用到应用广场；publish_skill 上架 Skill；query_bitable 查询飞书多维表格（待配置）。",
      });
    case "ping":
      return rpc(id, {});
    case "notifications/initialized":
      return new Response(null, { status: 202 });
    case "tools/list":
      return rpc(id, { tools: TOOLS });
    case "tools/call":
      return await callTool(id, msg.params ?? {}, env, request);
    default:
      return rpcError(id, -32601, `Method not found: ${String(msg.method)}`);
  }
}

async function callTool(
  id: string | number | null,
  params: Record<string, unknown>,
  env: Env,
  request: Request,
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
      case "publish_skill":
        return rpc(id, await toolPublishSkill(args, env));
      case "query_bitable":
        return rpc(id, await toolQueryBitable(args, env));
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

async function toolPublishSkill(args: Record<string, unknown>, env: Env) {
  const skillName = String(args.name ?? "");
  if (!NAME_RE.test(skillName)) throw new Error("Skill 名不合法：小写字母/数字/连字符");
  const content = String(args.content ?? "");
  if (!content.includes("---")) throw new Error("content 看起来不是合法的 SKILL.md（缺少 frontmatter）");
  await env.APPS_BUCKET.put(`skills/${skillName}/SKILL.md`, content);
  const entry: SkillEntry = {
    name: skillName,
    description: String(args.description ?? ""),
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

async function toolQueryBitable(args: Record<string, unknown>, env: Env) {
  const table = String(args.table ?? "");
  if (!["members", "tasks", "inventory", "finance"].includes(table)) {
    throw new Error("table 必须是 members | tasks | inventory | finance 之一");
  }
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    return {
      content: [
        {
          type: "text",
          text: "⚠️ 飞书自建应用尚未配置（FEISHU_APP_ID / FEISHU_APP_SECRET）。请在飞书开放平台创建企业自建应用并用 wrangler secret 配置后重试。当前为 MVP 阶段，此工具为占位实现。",
        },
      ],
    };
  }
  // 第二阶段：tenant_access_token → bitable API
  return {
    content: [{ type: "text", text: "飞书多维表格查询将在第二阶段接入，当前仅完成凭证校验。" }],
  };
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
