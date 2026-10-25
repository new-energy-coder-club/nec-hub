/**
 * 权限角色解析（FE-01）
 *
 * 按"队员名单"表（config_dashboard 的 members 表）解析用户角色：
 * 表未配置/读取失败 → 默认"队员"（不锁死登录）；未匹配 → "external"（仅公开区）。
 * 会话存取本身在 ../shared/session。
 */

import { BitableRecord, fieldText, findFieldKey } from "../feishu/bitable";
import { fetchTableCached, getDashboardConfig, type TableFetchResult } from "../dashboard";
import { KV_KEYS } from "../shared/kv-keys";
import type { HubUser } from "../shared/session";

/** 角色解析缓存 TTL（秒）。负结果不入缓存，保证移除队员后下一次请求即失效 */
const ROLE_CACHE_TTL_SEC = 60;

/** 环境变量超级管理员兜底：ADMIN_OPEN_IDS（逗号/空格分隔的 open_id 列表）。
 *  用于飞书名单表未配置/拉取失败时的自救通道：命中即视为「维护者」——
 *  只覆盖 CONFIG_ADMIN 口径（管理后台/域名/模块配置），不含队长/财务等其它角色权限。 */
export function envSuperAdminRole(env: Env, openId: string): UserRole | null {
  const raw = (env as Env & { ADMIN_OPEN_IDS?: string }).ADMIN_OPEN_IDS;
  if (!raw) return null;
  return raw.split(/[,\s]+/).filter(Boolean).includes(openId)
    ? { role: "维护者", group: "指导", matched: true }
    : null;
}

export interface UserRole {
  role: string;
  group: string;
  /** true = 在队员名单表中匹配到该用户 */
  matched: boolean;
}

/** 角色判定正则注册表：全后端角色口径集中在此，各调用点引用而不是各自写字面量。
 *  注意：各常量保持既有调用点的原有语义，仅做集中管理，不代表统一授权口径（口径变更是产品决策）。 */
export const ROLES = {
  /** 队长/组长：全量校验、周报手动触发、组默认首页、赛季目标管理操作 */
  LEADER: /队长|组长/,
  /** 财务明细可见（含指导）：看板财务区与 MCP finance 表查询 */
  FINANCE: /队长|财务|指导/i,
  /** 报销审批/打款与单据台账查看：队长/财务 */
  FINANCE_MANAGER: /队长|财务/,
  /** 队长硬编码放行（限组流程提交、审批人兜底） */
  CAPTAIN: /队长/,
  /** 配置写权限管理员：模块 config 接口、域名申请、管理后台 */
  CONFIG_ADMIN: /队长|指导|管理员|维护者|admin/i,
  /** 询价管理：报价回填、选定供应商 */
  INQUIRY_MANAGER: /队长|采购|项目经理/,
} as const;

export function hasRole(role: string, re: RegExp): boolean {
  return re.test(role);
}

/** 财务明细可见角色（看板明细与 MCP finance 表查询共用） */
const FINANCE_ROLE_RE = ROLES.FINANCE;

export async function resolveUserRole(env: Env, user: HubUser, ctx?: ExecutionContext): Promise<UserRole> {
  const fallback = envSuperAdminRole(env, user.open_id);
  if (fallback) return fallback;
  const cacheKey = KV_KEYS.role(user.open_id);
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
  if (!rec) {
    // 本地账号（账号密码登录，open_id 为 local:<username>）兜底"队员"：实习生等无飞书身份成员可正常用门户；
    // 后续把姓名录入名单表即可升级为指定角色（matched=false 不入缓存，立即生效）
    if (user.open_id.startsWith("local:")) return { role: "队员", group: "", matched: false };
    return { role: "external", group: "", matched: false };
  }
  return {
    role: (roleKey ? fieldText(rec.fields[roleKey]) : "") || "队员",
    group: groupKey ? fieldText(rec.fields[groupKey]) : "",
    matched: true,
  };
}

/** 在名单表记录里定位当前用户：仅 open_id 精确匹配 + 姓名精确匹配。
 *  曾有"双向包含"兜底（飞书显示名带前缀如 "DarrenPig 朱佩韦" 也能命中），但重名/昵称包含关系会误配权限，
 *  已移除——显示名与名单姓名不一致时须在队员名单补录 open_id（管理 Tab 可见缺录人数）。 */
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
  return hasRole(role.role, FINANCE_ROLE_RE);
}
