/**
 * 权限角色解析（FE-01）
 *
 * 按"队员名单"表（config_dashboard 的 members 表）解析用户角色：
 * 表未配置/读取失败 → 默认"队员"（不锁死登录）；未匹配 → "external"（仅公开区）。
 * 会话存取本身在 ../shared/session。
 */

import { BitableRecord, fieldText, findFieldKey } from "../feishu/bitable";
import { fetchTableCached, getDashboardConfig, type TableFetchResult } from "../dashboard";
import type { HubUser } from "../shared/session";

/** 角色解析缓存 TTL（秒）。负结果不入缓存，保证移除队员后下一次请求即失效 */
const ROLE_CACHE_TTL_SEC = 60;

export interface UserRole {
  role: string;
  group: string;
  /** true = 在队员名单表中匹配到该用户 */
  matched: boolean;
}

/** 财务明细可见角色（看板明细与 MCP finance 表查询共用） */
const FINANCE_ROLE_RE = /队长|财务|指导/i;

export async function resolveUserRole(env: Env, user: HubUser, ctx?: ExecutionContext): Promise<UserRole> {
  const cacheKey = `role:${user.open_id}`;
  const cached = await env.REGISTRY.get(cacheKey, "json") as UserRole | null;
  if (cached) return cached;
  const role = await lookupRoleFresh(env, user, ctx);
  if (role.matched) {
    const write = env.REGISTRY.put(cacheKey, JSON.stringify(role), { expirationTtl: ROLE_CACHE_TTL_SEC });
    if (ctx) ctx.waitUntil(write);
    else await write;
  } else {
    const del = env.REGISTRY.delete(cacheKey); // 负结果即时生效
    if (ctx) ctx.waitUntil(del);
    else await del;
  }
  return role;
}

async function lookupRoleFresh(env: Env, user: HubUser, ctx?: ExecutionContext): Promise<UserRole> {
  const cfg = await getDashboardConfig(env);
  const tableId = cfg?.tables?.members;
  if (!cfg || !tableId) return { role: "队员", group: "", matched: false };
  // 复用看板 members 表缓存，避免与同请求内的 buildDashboard 重复拉飞书
  let m: TableFetchResult;
  try {
    m = await fetchTableCached(env, cfg, "members", ctx);
  } catch {
    return { role: "队员", group: "", matched: false };
  }
  if (m.error) return { role: "队员", group: "", matched: false };
  const records = m.records;
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

export function canSeeFinanceDetail(role: UserRole): boolean {
  return FINANCE_ROLE_RE.test(role.role);
}
