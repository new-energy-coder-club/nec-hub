/**
 * 管理后台 API（/api/admin/*）——两个子集合并：
 *
 * A. 门户「管理」Tab 数据源（handleAdminOverview/Sessions/RevokeSessions/Config）：
 *   GET  /api/admin/overview          → 管理总览（租户接入状态、活跃会话数、成员名单聚合、模块配置状态）
 *   GET  /api/admin/sessions          → 会话清单（按 open_id 分组聚合，latestExpiresAt 倒序）
 *   POST /api/admin/sessions/revoke   → 强制下线指定 open_id 的全部会话（允许踢自己）
 *   POST /api/admin/config/dashboard  → 写 dashboard:config（复用 MCP config_dashboard 的校验口径）
 *   POST /api/admin/config/flows      → 写 flows:config（复用 MCP config_flows 的深合并 + 校验口径）
 *   鉴权：登录 + LEADER（队长/组长）或 CONFIG_ADMIN。只暴露掩码信息，不回显完整 secret。
 *
 * B. Cloudflare 线上配置与本地账号（handleAdmin，CONFIG_ADMIN：队长/指导/管理员/维护者）：
 *   GET  /api/admin/cf/status       → CF 凭证配置状态（不回显 token）
 *   GET  /api/admin/cf/dns?name=&type=  → 列 DNS 记录
 *   POST /api/admin/cf/dns          → 建 DNS 记录 {type, name, content, proxied?}（允许 * 泛解析）
 *   POST /api/admin/cf/dns/delete   → 删 DNS 记录 {id}
 *   POST /api/admin/cf/purge        → 清边缘缓存 {files?} {prefixes?} {purge_everything, confirm}
 *   GET  /api/admin/probe?url=      → 服务端探测任意 https URL 的状态与关键响应头（排障用）
 *   GET  /api/admin/accounts        → 本地账号列表（账号密码登录）
 *   POST /api/admin/accounts        → 建号 {username, name, password?}（密码缺省自动生成，仅响应回显一次）
 *   POST /api/admin/accounts/reset  → 重置密码 {username, password?}
 *   POST /api/admin/accounts/delete → 删号 {username}（已有会话最长存活 7 天自然过期）
 *   依赖 secrets：CF_API_TOKEN + CF_ZONE_ID（与域名分发系统共用）。
 *   注意：CF_API_TOKEN 若只有 Zone.DNS 权限，purge_cache 会返回 Cloudflare 403——错误原样透出，提示换 token。
 */

import { ROLES, hasRole, resolveUserRole } from "../auth/role";
import {
  createAccount,
  deleteAccount,
  listAccounts,
  resetAccountPassword,
} from "../auth/password";
import { fetchTableCached, getDashboardConfig } from "../dashboard";
import {
  cfApi,
  cfConfigured,
  createRawDnsRecord,
  deleteDnsRecord,
  listDnsRecords,
  purgeCache,
} from "../domains/cloudflare";
import { domainZone } from "../domains/service";
import { BitableRecord, fieldText, findFieldKey } from "../feishu/bitable";
import { json, readJson } from "../shared/http";
import { KV_KEYS, KV_PREFIXES } from "../shared/kv-keys";
import { resolveSession, revokeUserSessions, type HubUser, type SessionData } from "../shared/session";

/** 会话计数单页上限：KV list 单页最多 1000 个 key，门户规模内足够（与 cla 名单同口径） */
const SESSION_LIST_LIMIT = 1000;

/** 管理接口统一门控：返回会话或 401/403 响应；label 为各接口的拒绝文案主体 */
async function requireAdmin(
  request: Request,
  env: Env,
  ctx: ExecutionContext | undefined,
  label: string,
): Promise<{ user: HubUser } | Response> {
  const s = await resolveSession(env, request, ctx);
  if (!s) return json({ error: "请先登录" }, 401);
  const role = await resolveUserRole(env, s.user, ctx);
  if (!hasRole(role.role, ROLES.LEADER) && !hasRole(role.role, ROLES.CONFIG_ADMIN)) {
    return json({ error: `权限不足：${label}（当前角色：${role.role}）` }, 403);
  }
  return s;
}

/** 飞书 App ID 掩码：前 6 位 + "***"；未配置返回 null */
function maskAppId(appId: string | undefined): string | null {
  if (!appId) return null;
  return appId.slice(0, 6) + "***";
}

interface MembersOverview {
  total: number;
  withOpenId: number;
  missingOpenId: number;
  roleCounts: Record<string, number>;
}

/** 队员名单聚合：dashboard:config 未配置或拉取失败时返回 null（前端显示"未配置"） */
async function buildMembersOverview(env: Env, ctx?: ExecutionContext): Promise<MembersOverview | null> {
  const cfg = await getDashboardConfig(env);
  if (!cfg?.tables?.members) return null;
  let records: BitableRecord[];
  try {
    const m = await fetchTableCached(env, cfg, "members", ctx);
    if (m.error) return null;
    records = m.records;
  } catch {
    return null;
  }
  const openIdKey = findFieldKey(records, [/open_?id/, /飞书/i]);
  const roleKey = findFieldKey(records, [/权限角色/, /角色/, /role/i]);
  let withOpenId = 0;
  const roleCounts: Record<string, number> = {};
  for (const r of records) {
    if (openIdKey && fieldText(r.fields[openIdKey])) withOpenId++;
    const role = (roleKey ? fieldText(r.fields[roleKey]) : "") || "未标注";
    roleCounts[role] = (roleCounts[role] ?? 0) + 1;
  }
  return { total: records.length, withOpenId, missingOpenId: records.length - withOpenId, roleCounts };
}

/** flows:config 各流程是否含 tableId+base（读原始 KV，不走 getFlowsConfig 的默认值深合并） */
async function flowsConfigured(env: Env): Promise<{ reimburse: boolean; drawing: boolean; hardware: boolean; compliance: boolean }> {
  const out = { reimburse: false, drawing: false, hardware: false, compliance: false };
  const raw = await env.REGISTRY.get(KV_KEYS.flowsConfig);
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, { tableId?: string; base?: string } | undefined>;
    for (const k of Object.keys(out) as Array<keyof typeof out>) {
      const f = parsed[k];
      out[k] = !!(f && f.tableId && f.base);
    }
  } catch {
    /* 配置损坏按全部未配置处理 */
  }
  return out;
}

export async function handleAdminOverview(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const gate = await requireAdmin(request, env, ctx, "管理总览仅限队长/组长/管理员查看");
  if (gate instanceof Response) return gate;

  // 活跃会话计数：REGISTRY.list 前缀计数（单页上限 1000）
  const sessions = await env.REGISTRY.list({ prefix: KV_PREFIXES.session });

  const dashCfg = await getDashboardConfig(env);
  const validateRulesRaw = await env.REGISTRY.get(KV_KEYS.validateRules);

  return json({
    tenant: {
      hubName: env.HUB_NAME ?? "nec-hub",
      feishuAppId: maskAppId(env.FEISHU_APP_ID),
      loginEnabled: Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET),
      mcpEnabled: Boolean(env.MCP_TOKEN),
    },
    sessions: { active: Math.min(sessions.keys.length, SESSION_LIST_LIMIT) },
    members: await buildMembersOverview(env, ctx),
    modules: {
      dashboard: {
        configured: !!dashCfg,
        tables: dashCfg ? Object.entries(dashCfg.tables).filter(([, v]) => !!v).map(([k]) => k) : [],
      },
      flows: await flowsConfigured(env),
      validateRules: validateRulesRaw ? "custom" : "default",
    },
  });
}

// ---------- 会话管理 ----------

export interface AdminSessionUser {
  open_id: string;
  name: string;
  avatar_url?: string;
  sessions: number;
  latestCreatedAt: string;
  latestExpiresAt: number;
}

/** GET /api/admin/sessions：全量遍历 session: 前缀（分页），按 open_id 分组聚合，按 latestExpiresAt 倒序 */
export async function handleAdminSessions(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const gate = await requireAdmin(request, env, ctx, "会话管理仅限队长/组长/管理员查看");
  if (gate instanceof Response) return gate;

  const byUser = new Map<string, AdminSessionUser>();
  let cursor: string | undefined;
  do {
    const page = await env.REGISTRY.list({ prefix: KV_PREFIXES.session, ...(cursor ? { cursor } : {}) });
    const raws = await Promise.all(page.keys.map((k) => env.REGISTRY.get(k.name)));
    for (const raw of raws) {
      if (!raw) continue;
      let data: SessionData;
      try {
        data = JSON.parse(raw) as SessionData;
      } catch {
        continue; // 坏记录跳过
      }
      if (!data.open_id) continue;
      const row = byUser.get(data.open_id) ?? {
        open_id: data.open_id,
        name: data.name,
        avatar_url: data.avatar_url,
        sessions: 0,
        latestCreatedAt: "",
        latestExpiresAt: 0,
      };
      row.sessions++;
      if (data.createdAt > row.latestCreatedAt) row.latestCreatedAt = data.createdAt;
      if (data.expiresAt > row.latestExpiresAt) row.latestExpiresAt = data.expiresAt;
      byUser.set(data.open_id, row);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const users = [...byUser.values()].sort((a, b) => b.latestExpiresAt - a.latestExpiresAt);
  return json({ users, total: users.reduce((a, u) => a + u.sessions, 0) });
}

/** POST /api/admin/sessions/revoke：强制下线指定 open_id（允许踢自己，管理场景需要） */
export async function handleAdminRevokeSessions(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const gate = await requireAdmin(request, env, ctx, "强制下线仅限队长/组长/管理员操作");
  if (gate instanceof Response) return gate;
  const body = await readJson<{ open_id?: string }>(request);
  const openId = body?.open_id?.trim();
  if (!openId) return json({ error: "缺少 open_id 参数" }, 400);
  const revoked = await revokeUserSessions(env, openId, ctx);
  return json({ ok: true, revoked });
}

// ---------- 模块配置（dashboard / flows 的 HTTP 写入口；校验口径复用对应 MCP 工具） ----------

const ADMIN_CONFIG_MODULES = ["dashboard", "flows"] as const;
type AdminConfigModule = (typeof ADMIN_CONFIG_MODULES)[number];

export function isAdminConfigModule(m: string): m is AdminConfigModule {
  return (ADMIN_CONFIG_MODULES as readonly string[]).includes(m);
}

/** POST /api/admin/config/<dashboard|flows>：body 为对应配置 JSON；校验失败回 400 + 工具原始错误文案 */
export async function handleAdminConfig(request: Request, env: Env, ctx: ExecutionContext | undefined, module: AdminConfigModule): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const gate = await requireAdmin(request, env, ctx, "模块配置仅限队长/组长/管理员操作");
  if (gate instanceof Response) return gate;
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return json({ error: "请求体必须是 JSON" }, 400);
  try {
    if (module === "dashboard") {
      const { toolConfigDashboard } = await import("../mcp/tools/bitable-config");
      await toolConfigDashboard({ action: "set", base: body.base, tables: body.tables }, env);
    } else {
      const { toolConfigFlows } = await import("../approvals/handlers");
      // body 直接是 flows 补丁（{reimburse?: {...}, ...}），也兼容 {flows: {...}} 包装
      await toolConfigFlows({ action: "set", flows: body.flows ?? body }, env, true);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
  return json({ ok: true });
}
const DNS_TYPES = new Set(["A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA"]);
const PROBE_TIMEOUT_MS = 10_000;
/** 探测防 SSRF：禁内网/链路本地地址 */
const BLOCKED_PROBE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?(::1|fc|fd|fe80))/i;

function errJson(err: unknown, fallbackStatus = 502): Response {
  const msg = err instanceof Error ? err.message : String(err);
  // Cloudflare 权限类错误原样透出（如 purge_cache 403），状态用 502 与上游区分
  return json({ error: msg, upstream: msg.startsWith("Cloudflare API:") }, fallbackStatus);
}

export async function handleAdmin(
  request: Request,
  env: Env,
  pathname: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  // 统一鉴权：全部 /api/admin/* 需登录 + CONFIG_ADMIN
  const s = await resolveSession(env, request, ctx);
  if (!s) return json({ error: "未登录，请先在门户登录" }, 401);
  const role = await resolveUserRole(env, s.user, ctx);
  if (!ROLES.CONFIG_ADMIN.test(role.role)) {
    return json({ error: "需要管理员角色（队长/指导/管理员/维护者）" }, 403);
  }

  if (pathname === "/api/admin/cf/status" && request.method === "GET") {
    const zone = domainZone(env);
    return json({
      configured: cfConfigured(env),
      zone,
      zoneId: env.CF_ZONE_ID ? `${env.CF_ZONE_ID.slice(0, 4)}…${env.CF_ZONE_ID.slice(-4)}` : null,
      hint: cfConfigured(env)
        ? undefined
        : "未配置 CF_API_TOKEN / CF_ZONE_ID：wrangler secret put CF_API_TOKEN && wrangler secret put CF_ZONE_ID",
    });
  }

  if (pathname === "/api/admin/cf/dns" && request.method === "GET") {
    if (!cfConfigured(env)) return json({ error: "尚未配置 Cloudflare 凭证（CF_API_TOKEN / CF_ZONE_ID）" }, 503);
    const u = new URL(request.url);
    const name = u.searchParams.get("name")?.trim();
    const type = u.searchParams.get("type")?.trim().toUpperCase();
    try {
      const records = await listDnsRecords(env, name || type ? { name: name || undefined, type: type || undefined } : undefined);
      return json({ records });
    } catch (err) {
      return errJson(err);
    }
  }

  if (pathname === "/api/admin/cf/dns" && request.method === "POST") {
    if (!cfConfigured(env)) return json({ error: "尚未配置 Cloudflare 凭证（CF_API_TOKEN / CF_ZONE_ID）" }, 503);
    const body = (await request.json().catch(() => ({}))) as {
      type?: string;
      name?: string;
      content?: string;
      proxied?: boolean;
      comment?: string;
    };
    const type = (body.type ?? "").toUpperCase();
    const name = (body.name ?? "").trim().toLowerCase();
    const content = (body.content ?? "").trim();
    if (!DNS_TYPES.has(type)) return json({ error: `记录类型不支持：${type || "(空)"}（支持 ${[...DNS_TYPES].join("/")}）` }, 400);
    const zone = domainZone(env);
    if (name !== "*" && name !== zone && !name.endsWith(`.${zone}`)) {
      return json({ error: `记录名必须是 ${zone} 或其子域（* 泛解析直接写 *）` }, 400);
    }
    if (!content) return json({ error: "解析目标 content 不能为空" }, 400);
    try {
      const record = await createRawDnsRecord(env, { type, name, content, proxied: Boolean(body.proxied), comment: body.comment });
      return json({ ok: true, record });
    } catch (err) {
      return errJson(err);
    }
  }

  if (pathname === "/api/admin/cf/dns/delete" && request.method === "POST") {
    if (!cfConfigured(env)) return json({ error: "尚未配置 Cloudflare 凭证（CF_API_TOKEN / CF_ZONE_ID）" }, 503);
    const body = (await request.json().catch(() => ({}))) as { id?: string };
    if (!body.id) return json({ error: "缺少记录 id" }, 400);
    try {
      await deleteDnsRecord(env, body.id);
      return json({ ok: true, deleted: body.id });
    } catch (err) {
      return errJson(err);
    }
  }

  if (pathname === "/api/admin/cf/purge" && request.method === "POST") {
    if (!cfConfigured(env)) return json({ error: "尚未配置 Cloudflare 凭证（CF_API_TOKEN / CF_ZONE_ID）" }, 503);
    const body = (await request.json().catch(() => ({}))) as {
      files?: string[];
      prefixes?: string[];
      purge_everything?: boolean;
      confirm?: string;
    };
    try {
      if (body.purge_everything) {
        if (body.confirm !== domainZone(env)) {
          return json({ error: `清全站缓存是高危操作，请在 confirm 字段输入域名「${domainZone(env)}」确认` }, 400);
        }
        const result = await purgeCache(env, { purge_everything: true });
        return json({ ok: true, result });
      }
      const files = (body.files ?? []).filter((f) => typeof f === "string" && /^https:\/\//.test(f));
      const prefixes = (body.prefixes ?? []).filter((f) => typeof f === "string" && /^https:\/\//.test(f));
      if (files.length === 0 && prefixes.length === 0) {
        return json({ error: "至少提供一个 https:// URL（files 精确 / prefixes 前缀）" }, 400);
      }
      const result = await purgeCache(env, {
        ...(files.length ? { files: files.slice(0, 30) } : {}),
        ...(prefixes.length ? { prefixes: prefixes.slice(0, 30) } : {}),
      });
      return json({ ok: true, result });
    } catch (err) {
      return errJson(err);
    }
  }

  if (pathname === "/api/admin/probe" && request.method === "GET") {
    const raw = new URL(request.url).searchParams.get("url") ?? "";
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return json({ error: "url 参数不是合法 URL" }, 400);
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      return json({ error: "仅支持 http/https" }, 400);
    }
    if (BLOCKED_PROBE_HOST.test(target.hostname)) {
      return json({ error: "禁止探测内网/链路本地地址" }, 400);
    }
    try {
      const res = await fetch(target.toString(), {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      const headers: Record<string, string> = {};
      for (const k of ["cf-cache-status", "x-vercel-id", "x-vercel-cache", "location", "server", "content-type", "cache-control"]) {
        const v = res.headers.get(k);
        if (v) headers[k] = v;
      }
      let title: string | null = null;
      const ct = headers["content-type"] ?? "";
      if (ct.includes("text/html")) {
        const text = await res.text();
        title = text.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
      }
      return json({ status: res.status, headers, title, probedUrl: target.toString() });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  }

  // ---- 本地账号管理（账号密码登录，供实习生等无飞书身份成员使用） ----
  if (pathname === "/api/admin/accounts" && request.method === "GET") {
    try {
      return json({ accounts: await listAccounts(env) });
    } catch (err) {
      return errJson(err);
    }
  }

  if (pathname === "/api/admin/accounts" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { username?: string; name?: string; password?: string };
    try {
      const { account, password } = await createAccount(env, {
        username: body.username ?? "",
        name: body.name ?? "",
        password: body.password,
      });
      return json({ ok: true, username: account.username, name: account.name, password }, 201);
    } catch (err) {
      return errJson(err, 400);
    }
  }

  if (pathname === "/api/admin/accounts/reset" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
    if (!body.username) return json({ error: "缺少 username" }, 400);
    try {
      const { password } = await resetAccountPassword(env, body.username.trim(), body.password);
      return json({ ok: true, username: body.username.trim(), password });
    } catch (err) {
      return errJson(err, 400);
    }
  }

  if (pathname === "/api/admin/accounts/delete" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { username?: string };
    if (!body.username) return json({ error: "缺少 username" }, 400);
    try {
      const deleted = await deleteAccount(env, body.username.trim());
      return json({ ok: true, deleted, username: body.username.trim() });
    } catch (err) {
      return errJson(err, 400);
    }
  }

  // 兜底：允许后续路由继续（当前 /api/admin 均由本模块收口，返回 404 更直观）
  return json({ error: "not found" }, 404);
}
