/**
 * 管理后台 API — 门户「管理」Tab 数据源
 *
 *   GET  /api/admin/overview          → 管理总览（租户接入状态、活跃会话数、成员名单聚合、模块配置状态）
 *   GET  /api/admin/sessions          → 会话清单（按 open_id 分组聚合，latestExpiresAt 倒序）
 *   POST /api/admin/sessions/revoke   → 强制下线指定 open_id 的全部会话（允许踢自己）
 *   POST /api/admin/config/dashboard  → 写 dashboard:config（复用 MCP config_dashboard 的校验口径）
 *   POST /api/admin/config/flows      → 写 flows:config（复用 MCP config_flows 的深合并 + 校验口径）
 *
 * 鉴权：登录 + 角色命中 ROLES.LEADER（队长/组长）或 ROLES.CONFIG_ADMIN（队长/指导/管理员）。
 * 只暴露掩码后的接入信息与配置状态位，不回显任何完整 secret。
 */

import { ROLES, hasRole, resolveUserRole } from "../auth/role";
import { fetchTableCached, getDashboardConfig } from "../dashboard";
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
