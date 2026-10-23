/**
 * 数据看板（飞书多维表格聚合 + KV 缓存）
 *
 * 表缓存（dashboard:cache:<table>，TTL 见 DASH_CACHE_TTL_SEC）供 buildDashboard / 角色解析 / 数据校验共用；
 * Cron 快触发器（每 8 分钟）预热，让用户请求始终命中热缓存。
 * 聚合逻辑在 ./aggregates；资料页在 ../docs。
 */

import {
  BitableRecord,
  getTenantAccessToken,
  listBitableRecords,
} from "../feishu/bitable";
import { KV_KEYS } from "../shared/kv-keys";
import { resolveSession } from "../shared/session";
// 注意：auth/role 反向 import 本模块（getDashboardConfig / fetchTableCached），
// 两侧均为运行时调用，无模块加载期循环求值。
import { canSeeFinanceDetail, resolveUserRole } from "../auth/role";
import {
  aggregateFinance,
  aggregateGoals,
  aggregateInventory,
  aggregateMembers,
  aggregateTasks,
} from "./aggregates";

/** 数据看板配置（KV key: dashboard:config，由 MCP config_dashboard 写入） */
export interface DashboardConfig {
  /** 多维表格 app_token（表格 URL 中 /base/ 之后的一段） */
  base: string;
  /** 逻辑表名 → table_id（tbl 开头）；goals 为 FE-04 赛季目标表 */
  tables: Partial<Record<"members" | "tasks" | "inventory" | "finance" | "goals", string>>;
  updatedAt: string;
}

export const DASH_TABLES = ["members", "tasks", "inventory", "finance", "goals"] as const;
export type DashTable = (typeof DASH_TABLES)[number];

export interface TableFetchResult {
  records: BitableRecord[];
  cachedAt: string;
  /** true = 本次刷新失败，返回的是过期缓存 */
  stale?: boolean;
  error?: string;
}

/** 看板数据缓存 TTL（秒）。原为 5 分钟；2026-10-15 调整为 15 分钟，同日因 KV 免费档 1,000 次/日写配额
 *  被打爆再调整为 30 分钟——快触发器预热配合 fetchTableCached 按 TTL 过期才写，5 张表写量 ≤240 次/日。 */
const DASH_CACHE_TTL_SEC = 1800;

export async function getDashboardConfig(env: Env): Promise<DashboardConfig | null> {
  const raw = await env.REGISTRY.get(KV_KEYS.dashboardConfig);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DashboardConfig;
  } catch {
    return null;
  }
}

/** 读一张表：命中 TTL 内缓存直接返回；刷新失败时降级返回过期缓存 */
export async function fetchTableCached(env: Env, cfg: DashboardConfig, key: DashTable, ctx?: ExecutionContext): Promise<TableFetchResult> {
  const tableId = cfg.tables[key];
  if (!tableId) return { records: [], cachedAt: "", error: "未配置 table_id" };
  const cacheKey = KV_KEYS.dashboardCache(key);
  const cached = await env.REGISTRY.get(cacheKey, "json") as
    | { data: BitableRecord[]; cachedAt: number }
    | null;
  if (cached && cached.cachedAt > Date.now() - DASH_CACHE_TTL_SEC * 1000) {
    return { records: cached.data, cachedAt: new Date(cached.cachedAt).toISOString() };
  }
  try {
    return await refreshTableCache(env, cfg, key, ctx);
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

/** 强制刷新一张表并写缓存（Cron 预热与缓存过期共用；有 ctx 时缓存写不阻塞响应） */
export async function refreshTableCache(env: Env, cfg: DashboardConfig, key: DashTable, ctx?: ExecutionContext): Promise<TableFetchResult> {
  const tableId = cfg.tables[key];
  if (!tableId) return { records: [], cachedAt: "", error: "未配置 table_id" };
  const token = await getTenantAccessToken(env);
  const records = await listBitableRecords(token, cfg.base, tableId);
  const write = env.REGISTRY.put(KV_KEYS.dashboardCache(key), JSON.stringify({ data: records, cachedAt: Date.now() }));
  if (ctx) ctx.waitUntil(write);
  else await write;
  return { records, cachedAt: new Date().toISOString() };
}

/** Cron 预热：走 fetchTableCached 按 TTL 过期才重写（不再无条件 put），让用户请求始终命中热缓存 */
export async function prewarmDashboard(env: Env, ctx?: ExecutionContext): Promise<void> {
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) return;
  const cfg = await getDashboardConfig(env);
  if (!cfg) return;
  await Promise.allSettled(
    DASH_TABLES.filter((k) => cfg.tables[k]).map((k) => fetchTableCached(env, cfg, k, ctx)),
  );
}

export async function buildDashboard(env: Env, request: Request, ctx?: ExecutionContext): Promise<unknown> {
  const cfg = await getDashboardConfig(env);
  if (!cfg) {
    return {
      configured: false,
      hint: "数据看板尚未接入飞书多维表格。让 Agent 调用 NEC-MCP 的 config_dashboard（action=set）配置 base 与 tables 后即可展示。",
    };
  }
  // FE-01：按登录角色决定财务区可见级别（hidden=未登录 / summary=队员 / full=队长·财务）
  const session = await resolveSession(env, request, ctx);
  const role = session ? await resolveUserRole(env, session.user, ctx) : null;
  const financeLevel = !session || !role ? "hidden" : canSeeFinanceDetail(role) ? "full" : "summary";
  const fetched: Record<DashTable, TableFetchResult> = {
    members: { records: [], cachedAt: "" },
    tasks: { records: [], cachedAt: "" },
    inventory: { records: [], cachedAt: "" },
    finance: { records: [], cachedAt: "" },
    goals: { records: [], cachedAt: "" },
  };
  // ?fresh=1 手动刷新：绕过 5 分钟缓存强制拉飞书，失败时降级回 fetchTableCached（返回过期快照而非报错）
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  await Promise.all(DASH_TABLES.map(async (k) => {
    if (fresh) {
      try {
        fetched[k] = await refreshTableCache(env, cfg, k, ctx);
        return;
      } catch { /* 降级走缓存路径 */ }
    }
    fetched[k] = await fetchTableCached(env, cfg, k, ctx);
  }));

  const wrap = (r: TableFetchResult, agg: Record<string, unknown>) => ({
    ...agg,
    ...(r.error ? { error: r.error } : {}),
    ...(r.stale ? { stale: true } : {}),
    cachedAt: r.cachedAt,
  });

  const financeAgg = aggregateFinance(fetched.finance.records);

  return {
    configured: true,
    base: cfg.base,
    generatedAt: new Date().toISOString(),
    stale: DASH_TABLES.some((k) => fetched[k].stale),
    members: wrap(fetched.members, aggregateMembers(fetched.members.records)),
    tasks: wrap(fetched.tasks, aggregateTasks(fetched.tasks.records, cfg.base, cfg.tables.tasks as string)),
    inventory: wrap(fetched.inventory, aggregateInventory(fetched.inventory.records)),
    finance: wrap(fetched.finance, {
      visibility: financeLevel,
      ...(financeLevel === "hidden"
        ? {}
        : {
            records: financeAgg.records,
            monthCount: financeAgg.monthCount,
            // summary（队员）只给笔数，不给金额合计——团队报销总额对普通队员不公开
            ...(financeLevel === "full"
              ? {
                  totalAmount: financeAgg.totalAmount,
                  monthAmount: financeAgg.monthAmount,
                  prevMonthAmount: financeAgg.prevMonthAmount,
                  recent: financeAgg.recent,
                }
              : {}),
          }),
    }),
    goals: aggregateGoals(fetched.goals.records, cfg.base, cfg.tables.goals),
  };
}
