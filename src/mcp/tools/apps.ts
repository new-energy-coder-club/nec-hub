/**
 * 应用广场 MCP 工具：deploy_app / register_app / sync_vercel
 */

import { domainZone } from "../../domains/service";
import { readIndex, upsertIndex, type AppEntry } from "../../hosting";
import { NAME_RE, type McpToolDef } from "./shared";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function toolDeployApp(args: Record<string, unknown>, env: Env, request: Request) {
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
  // 先整体校验（纯同步、无副作用），再并行上传 R2
  const bodies: Array<{ path: string; body: string | Uint8Array }> = [];
  for (const f of files) {
    const p = String(f.path ?? "");
    if (!p || p.includes("..") || p.startsWith("/")) throw new Error(`非法文件路径：${p}`);
    let body: string | Uint8Array;
    if (typeof f.text === "string") body = f.text;
    else if (typeof f.base64 === "string") body = base64ToBytes(f.base64);
    else throw new Error(`文件 ${p} 缺少 text 或 base64 内容`);
    bodies.push({ path: p, body });
  }
  await Promise.all(bodies.map((f) => env.APPS_BUCKET.put(`apps/${appName}/${f.path}`, f.body)));
  const origin = new URL(request.url).origin;
  // 让边缘缓存里的旧版本立即失效（含 /apps/<name>/ 路径与 <name>.<zone> 直达域名）
  const appHost = `https://${appName}.${domainZone(env)}`;
  await Promise.all([
    caches.default.delete(new Request(`${origin}/apps/${appName}/`, { method: "GET" })),
    caches.default.delete(new Request(`${appHost}/`, { method: "GET" })),
    ...files.flatMap((f) => [
      caches.default.delete(new Request(`${origin}/apps/${appName}/${String(f.path)}`, { method: "GET" })),
      caches.default.delete(new Request(`${appHost}/${String(f.path)}`, { method: "GET" })),
    ]),
  ]);
  const entry: AppEntry = {
    name: appName,
    title: String(args.title ?? appName),
    author: String(args.author ?? "未知"),
    visibility: String(args.visibility ?? "all"),
    version: String(args.version ?? "0.1.0"),
    updatedAt: new Date().toISOString(),
    url: `${origin}/apps/${appName}/`,
    description: args.description ? String(args.description) : undefined,
  };
  const list = await upsertIndex(env, "apps:index", entry);
  return {
    content: [
      {
        type: "text",
        text: `✅ 应用已上架：${entry.title}\n访问链接：${entry.url}\n独立域名：https://${appName}.${domainZone(env)}/（泛解析直达，无需申请）\n共上传 ${files.length} 个文件，应用广场现有 ${list.length} 个应用。`,
      },
    ],
  };
}

export async function toolRegisterApp(args: Record<string, unknown>, env: Env) {
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
    description: args.description ? String(args.description) : undefined,
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

export async function toolSyncVercel(args: Record<string, unknown>, env: Env) {
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
  // Vercel 项目列表与本地注册表互不依赖，并行拉取
  const listRespPromise = fetch(`https://api.vercel.com/v9/projects?slug=${encodeURIComponent(team)}&limit=100`, { headers });
  const registry = await readIndex<AppEntry>(env, "apps:index");
  const listResp = await listRespPromise;
  const listData = (await listResp.json()) as { projects?: Array<{ name?: string }>; error?: { message?: string } };
  if (!listResp.ok || !listData.projects) {
    throw new Error(`Vercel API 错误：${listData.error?.message ?? listResp.status}`);
  }

  const existingHosts = new Set(
    registry.map((a) => { try { return new URL(a.url).host; } catch { return ""; } }),
  );
  const existingNames = new Set(registry.map((a) => a.name));

  // 各项目详情请求互不依赖，并行拉取；确认模式下的注册表写回仍顺序执行（避免 KV 读写竞争）
  const entries = await Promise.all(
    listData.projects.map(async (p): Promise<{ name: string; url: string; action: string } | null> => {
      const name = p.name ?? "";
      if (!name) return null;
      if (excluded.has(name) || VERCEL_DEFAULT_EXCLUDE_PREFIX.some((pre) => name.startsWith(pre))) {
        return { name, url: "-", action: "skip: 排除名单" };
      }
      if (existingNames.has(name)) {
        return { name, url: "-", action: "skip: 已在广场" };
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
        return { name, url, action: "skip: 同域名已收录" };
      }
      return { name, url, action: confirm ? "registered" : "would register" };
    }),
  );
  const plan = entries.filter((e) => e !== null);
  if (confirm) {
    for (const p of plan) {
      if (p.action !== "registered") continue;
      await upsertIndex(env, "apps:index", {
        name: p.name,
        title: p.name,
        author: "Vercel 同步",
        visibility: "all",
        version: "1.0.0",
        updatedAt: new Date().toISOString(),
        url: p.url,
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

export const deployAppTool: McpToolDef = {
  name: "deploy_app",
  description:
    "把一个 Vibe Coding 的静态应用（单页 HTML 或多文件静态站）发布到 NEC 团队中台应用广场。文件上传到团队 R2，访问路径为 /apps/<name>/。提交前必须满足：① name 匹配 ^[a-z0-9][a-z0-9-]{1,40}$（小写字母/数字/连字符，须以小写字母或数字开头，2-41 字符）；② files 必须包含入口文件 index.html，单次最多 100 个文件；③ 文本文件（HTML/CSS/JS/JSON 等）用 text 字段传 UTF-8 内容，图片/字体等二进制用 base64 字段，两者二选一；④ 文件 path 为相对路径，禁止包含 .. 或以 / 开头；⑤ 同名应用重复部署即覆盖更新，建议递增 version；⑥ 建议显式填写 title/author，便于应用广场展示。",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "应用名，即访问路径 /apps/<name>/。小写字母/数字/连字符，须以小写字母或数字开头，2-41 字符，如 inventory-check",
      },
      title: { type: "string", description: "展示名称，如 物资盘点助手；缺省用 name" },
      author: { type: "string", description: "作者（队员姓名）；缺省显示「未知」" },
      visibility: { type: "string", description: "可见范围：all 或组别名，默认 all" },
      version: { type: "string", description: "版本号，默认 0.1.0；覆盖更新时建议递增" },
      files: {
        type: "array",
        description: "静态文件列表（1-100 个），必须包含入口 index.html",
        items: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "相对路径（禁止 .. 和开头 /），如 index.html、assets/style.css",
            },
            text: { type: "string", description: "UTF-8 文本内容（与 base64 二选一）" },
            base64: { type: "string", description: "base64 内容（图片等二进制文件用）" },
          },
          required: ["path"],
        },
      },
    },
    required: ["name", "files"],
  },
  impl: (args, env, ctx) => toolDeployApp(args, env, ctx.request),
};

export const registerAppTool: McpToolDef = {
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
  impl: (args, env) => toolRegisterApp(args, env),
};

export const syncVercelTool: McpToolDef = {
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
  impl: (args, env) => toolSyncVercel(args, env),
};
