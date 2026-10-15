/**
 * 数据看板（飞书多维表格聚合 + KV 缓存）与资料页
 *
 * 5 分钟表缓存（dashboard:cache:<table>）供 buildDashboard / 角色解析 / 数据校验共用；
 * Cron 每 4 分钟预热，让用户请求始终命中热缓存。
 */

import {
  BitableRecord,
  fieldNum,
  fieldText,
  fieldTs,
  findFieldKey,
  firstFieldText,
  getTenantAccessToken,
  listBitableRecords,
} from "./feishu/bitable";
import { readIndex } from "./hosting";
import { resolveSession } from "./shared/session";
import { buildRecordLink } from "./validation/service";
// 注意：auth/role 反向 import 本模块（getDashboardConfig / fetchTableCached），
// 两侧均为运行时调用，无模块加载期循环求值。
import { canSeeFinanceDetail, resolveUserRole } from "./auth/role";

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

/** 看板数据缓存 TTL（秒）。方案文档约定：看板类接口 5 分钟级缓存，避免打满飞书免费配额 */
const DASH_CACHE_TTL_SEC = 300;

export async function getDashboardConfig(env: Env): Promise<DashboardConfig | null> {
  const raw = await env.REGISTRY.get("dashboard:config");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DashboardConfig;
  } catch {
    return null;
  }
}

/** 读一张表：命中 5 分钟缓存直接返回；刷新失败时降级返回过期缓存 */
export async function fetchTableCached(env: Env, cfg: DashboardConfig, key: DashTable, ctx?: ExecutionContext): Promise<TableFetchResult> {
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
  const write = env.REGISTRY.put(`dashboard:cache:${key}`, JSON.stringify({ data: records, cachedAt: Date.now() }));
  if (ctx) ctx.waitUntil(write);
  else await write;
  return { records, cachedAt: new Date().toISOString() };
}

/** Cron 预热：刷新所有已配置看板表的缓存，让用户请求始终命中热缓存 */
export async function prewarmDashboard(env: Env): Promise<void> {
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) return;
  const cfg = await getDashboardConfig(env);
  if (!cfg) return;
  await Promise.allSettled(
    DASH_TABLES.filter((k) => cfg.tables[k]).map((k) => refreshTableCache(env, cfg, k)),
  );
}

const TASK_DONE_RE = /完成|已完|完结|done|取消|cancel|关闭|close|drop/i;

/** 赛季目标完成状态判定（FE-04）：状态含完成/达成类词或完成度 100 即视为达标 */
const GOAL_DONE_RE = /完成|达成|达标|done|close/i;

/** 资料页注册表 KV key */
export const DOCS_REGISTRY_KEY = "docs:registry";

/** 资料页条目（KV key: docs:registry，由 MCP publish_doc 写入） */
export interface DocEntry {
  id: string;
  title: string;
  description: string;
  /** 分类：brand=品牌规范 template=文档模板 sop=制度SOP training=培训材料 */
  category: "brand" | "template" | "sop" | "training";
  /** 为空字符串表示占位条目，前端展示「即将上线」且不可点击 */
  url: string;
  visibility: string;
  maintainer: string;
  updatedAt: string;
  source: string;
}

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
    title: "NEC VI 规范手册 V1.1",
    description: "标准色值、语义色、字体系统、最小尺寸、禁用示例完整规范",
    category: "brand",
    url: "/brand/NEC-VI-Manual_V1.1.md",
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
    description: "项目立项/技术评审/成果总结通用报告结构（即将上线）",
    category: "template",
    url: "",
    visibility: "all",
    maintainer: "待认领",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "meeting-minutes-template",
    title: "会议纪要模板",
    description: "例会/评审会标准纪要结构，含行动项追踪（即将上线）",
    category: "template",
    url: "",
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
    description: "中台资产/账号/文档/权限交接 checklist（即将上线）",
    category: "sop",
    url: "",
    visibility: "all",
    maintainer: "待认领",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "mech-onboarding",
    title: "机械组入门教程",
    description: "机械组常用工具链、设计规范、常用元件手册（即将上线）",
    category: "training",
    url: "",
    visibility: "all",
    maintainer: "待认领",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "elec-onboarding",
    title: "电控组入门教程",
    description: "电路设计、嵌入式开发、调试工具使用指南（即将上线）",
    category: "training",
    url: "",
    visibility: "all",
    maintainer: "待认领",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "vision-onboarding",
    title: "视觉组入门教程",
    description: "OpenCV/深度学习/相机标定/部署流程（即将上线）",
    category: "training",
    url: "",
    visibility: "all",
    maintainer: "待认领",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
];

export async function buildDocs(env: Env, request: Request, ctx?: ExecutionContext): Promise<unknown> {
  let docs = await readIndex<DocEntry>(env, DOCS_REGISTRY_KEY);
  if (docs.length === 0) {
    docs = SEED_DOCS;
    await env.REGISTRY.put(DOCS_REGISTRY_KEY, JSON.stringify(docs));
  } else {
    // 历史种子里的 example.feishu.cn 占位链接 → 置空 url，前端展示「即将上线」
    const cleaned = docs.map((d) => (d.url.includes("example.feishu.cn") ? { ...d, url: "" } : d));
    if (cleaned.some((d, i) => d.url !== docs[i].url)) {
      docs = cleaned;
      await env.REGISTRY.put(DOCS_REGISTRY_KEY, JSON.stringify(docs));
    }
  }
  const session = await resolveSession(env, request, ctx);
  if (!session) {
    return docs.filter((d) => d.visibility === "all");
  }
  return docs;
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
  const tPriorityKey = findFieldKey(t.records, [/优先级/, /priority/i]);
  const tLevelKey = findFieldKey(t.records, [/层级/, /级别/, /^类型/, /分类/, /level/i]);
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
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const upcoming = upcomingSrc
    .map((r) => ({
      title: (tTitleKey ? fieldText(r.fields[tTitleKey]) : "") || firstFieldText(r),
      owner: tOwnerKey ? fieldText(r.fields[tOwnerKey]) : "",
      status: tStatusKey ? fieldText(r.fields[tStatusKey]) : "",
      deadline: tDeadlineKey ? fieldNum(r.fields[tDeadlineKey]) : null,
      priority: tPriorityKey ? fieldText(r.fields[tPriorityKey]) : "",
      level: tLevelKey ? fieldText(r.fields[tLevelKey]) : "",
      link: buildRecordLink(cfg.base, cfg.tables.tasks as string, r.record_id),
    }))
    .sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity))
    .slice(0, 8);
  // 逾期未完成任务数（全量统计，不限于 upcoming 前 8 条）
  const tasksOverdueCount = pending.filter((r) => {
    const dl = tDeadlineKey ? fieldNum(r.fields[tDeadlineKey]) : null;
    return dl !== null && dl < dayStart.getTime();
  }).length;

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
  const fApplicantKey = findFieldKey(fin.records, [/^申请人$/, /申请人/, /报销人/, /经手人/, /提交人/]);
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
  // 本月/上月金额与笔数：统计卡环比对比（本月 vs 上月）
  const nowDate = new Date();
  const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime();
  const prevMonthStart = new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, 1).getTime();
  let monthAmount = 0;
  let monthCount = 0;
  let prevMonthAmount = 0;
  for (const r of fin.records) {
    const amt = fAmountKey ? (fieldNum(r.fields[fAmountKey]) ?? 0) : 0;
    const ts = fDateKey ? fieldTs(r.fields[fDateKey]) : null;
    if (ts === null) continue;
    if (ts >= monthStart) { monthAmount += amt; monthCount++; }
    else if (ts >= prevMonthStart) prevMonthAmount += amt;
  }

  const wrap = (r: TableFetchResult, agg: Record<string, unknown>) => ({
    ...agg,
    ...(r.error ? { error: r.error } : {}),
    ...(r.stale ? { stale: true } : {}),
    cachedAt: r.cachedAt,
  });

  // 赛季目标（FE-04）：里程碑时间线 + 各组完成度 + 逾期未达标告警；未配置 goals 表时不展示
  const g = fetched.goals;
  const goalsAgg: Record<string, unknown> = { configured: Boolean(cfg.tables.goals) };
  if (cfg.tables.goals) {
    const gTitleKey = findFieldKey(g.records, [/^目标/, /目标/, /title/i]);
    const gKrKey = findFieldKey(g.records, [/关键结果/, /^KR/i, /KR/]);
    const gGroupKey = findFieldKey(g.records, [/负责组/, /组别/, /小组/, /group/i]);
    const gDeadlineKey = findFieldKey(g.records, [/截止/, /deadline/i, /日期/]);
    const gProgressKey = findFieldKey(g.records, [/完成度/, /进度/, /progress/i]);
    const gStatusKey = findFieldKey(g.records, [/^状态/, /状态/, /status/i]);
    const now = Date.now();
    const goalItems = g.records
      .map((r) => {
        let progress = gProgressKey ? fieldNum(r.fields[gProgressKey]) : null;
        // 飞书「进度」字段返回 0-1 小数，统一归一到 0-100
        if (progress !== null && progress > 0 && progress <= 1) progress = progress * 100;
        if (progress !== null) progress = Math.min(Math.max(progress, 0), 100);
        const status = gStatusKey ? fieldText(r.fields[gStatusKey]) : "";
        const deadline = gDeadlineKey ? fieldTs(r.fields[gDeadlineKey]) : null;
        const done = GOAL_DONE_RE.test(status) || progress === 100;
        return {
          title: (gTitleKey ? fieldText(r.fields[gTitleKey]) : "") || firstFieldText(r),
          kr: gKrKey ? fieldText(r.fields[gKrKey]) : "",
          group: (gGroupKey ? fieldText(r.fields[gGroupKey]) : "") || "未分组",
          deadline,
          progress,
          status,
          done,
          overdue: !done && deadline !== null && deadline < now,
          daysLeft: deadline !== null ? Math.ceil((deadline - now) / 86400000) : null,
          link: buildRecordLink(cfg.base, cfg.tables.goals as string, r.record_id),
        };
      })
      .filter((it) => it.title)
      .sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity));
    const gByGroup: Record<string, { sum: number; count: number }> = {};
    for (const it of goalItems) {
      const g0 = (gByGroup[it.group] ??= { sum: 0, count: 0 });
      g0.sum += it.progress ?? 0;
      g0.count++;
    }
    Object.assign(goalsAgg, {
      total: goalItems.length,
      items: goalItems,
      byGroup: Object.entries(gByGroup)
        .map(([name, v]) => ({ name, avg: Math.round(v.sum / v.count), count: v.count }))
        .sort((a, b) => a.avg - b.avg),
      overdueCount: goalItems.filter((it) => it.overdue).length,
      upcomingCount: goalItems.filter((it) => !it.done && it.daysLeft !== null && it.daysLeft >= 0 && it.daysLeft <= 7).length,
    });
  }

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
      overdueCount: tasksOverdueCount,
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
            monthCount,
            // summary（队员）只给笔数，不给金额合计——团队报销总额对普通队员不公开
            ...(financeLevel === "full"
              ? { totalAmount: financeTotal, monthAmount, prevMonthAmount, recent: financeRecent }
              : {}),
          }),
    }),
    goals: goalsAgg,
  };
}
