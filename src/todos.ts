/**
 * FE-09 审批/待办聚合 — GET /api/todos（需登录）
 *
 * 聚合四类待办：
 *   ① 任务表：负责人=当前用户 且 截止<今天 且 状态≠完成 的逾期任务（跳多维表格记录直链）；
 *   ② 财务报销表：状态为待确认/进行中的记录（队员只见自己，队长/财务见全部，复用看板角色判定）；
 *   ③ 飞书审批待办：尝试调飞书审批 API；权限不足/未开通时静默降级到 warnings，不报错；
 *   ④ 本地审批底表（G-04）：4 张流程底表中状态="审批中"的单——审批人见全部，队员只见自己
 *      提交的；compliance 流程带计划发布时间 deadline，距发布 ≤24h 标 urgent（门户 T-1 标红）。
 *
 * 结果按用户缓存（KV todos:<open_id>，TTL 5 分钟），飞书免费版限流保护。
 */

import { canSeeFinanceDetail, resolveUserRole } from "./auth/role";
import { fetchFlowRecordsCached } from "./approvals/engine";
import { APPROVAL_TYPES, getFlowsConfig, isApprover, type ApprovalType } from "./approvals/flows";
import { fetchTableCached, getDashboardConfig } from "./dashboard";
import { fieldNum, fieldText, fieldTs, firstFieldText, getTenantAccessToken, type BitableRecord } from "./feishu/bitable";
import { FEISHU_API } from "./feishu/client";
import {
  APPROVAL_APPLICANT_PATTERNS,
  APPROVAL_ID_PATTERNS,
  APPROVAL_STATUS_PATTERNS,
  COMPLIANCE_PUBLISH_AT_PATTERNS,
  FINANCE_AMOUNT_PATTERNS,
  FINANCE_APPLICANT_PATTERNS,
  FINANCE_FLOW_STATUS_PATTERNS,
  FINANCE_ITEM_PATTERNS,
  OPEN_ID_PATTERNS,
  TASK_DEADLINE_PATTERNS,
  TASK_OWNER_PATTERNS,
  TASK_STATUS_PATTERNS,
  TASK_TITLE_PATTERNS,
  findFieldKey,
} from "./shared/bitable-fields";
import { json } from "./shared/http";
import { resolveSession } from "./shared/session";
import { buildRecordLink } from "./validation/service";
import type { UserRole } from "./auth/role";

/** 待办缓存 TTL（秒）：与看板一致 5 分钟 */
const TODOS_CACHE_TTL_SEC = 300;

/** 任务完成态判定（与 dashboard.ts 保持一致） */
const TASK_DONE_RE = /完成|已完|完结|done|取消|cancel|关闭|close|drop/i;

/** 报销待处理状态（待确认/进行中等） */
const FINANCE_PENDING_RE = /待确认|待审核|待审批|待处理|进行中|审批中|提交/;

export interface TodoTask {
  title: string;
  owner: string;
  status: string;
  deadline: number | null;
  daysOverdue: number | null;
  link: string;
}

export interface TodoFinanceItem {
  name: string;
  amount: number | null;
  applicant: string;
  status: string;
  link: string;
}

export interface TodoApprovalLocalItem {
  application_id: string;
  title: string;
  url: string;
  type: ApprovalType;
  /** 仅 compliance：计划发布时间（毫秒时间戳），其他流程为 null */
  deadline: number | null;
  /** compliance 且距计划发布 ≤24h（含已过点）且仍审批中 */
  urgent: boolean;
}

export interface TodosPayload {
  generatedAt: string;
  /** true = 命中 5 分钟缓存 */
  cached: boolean;
  total: number;
  tasks: TodoTask[];
  finance: { count: number; scope: "mine" | "all"; items: TodoFinanceItem[] };
  approvals: { count: number; items: Array<{ title: string; link: string }> };
  approvals_local: { count: number; items: TodoApprovalLocalItem[] };
  warnings: string[];
}

/** T-1 标红阈值：距计划发布 ≤ 24h */
const T1_URGENT_MS = 24 * 3600e3;

/**
 * G-04 本地审批底表待办：状态="审批中"的单。
 * 审批人（isApprover）见全部；普通队员只见自己提交的（申请人 open_id 匹配，兜底姓名匹配）。
 * 复用 aggregateTodos 的 todo:tbl:<type> 5 分钟缓存（fetchFlowRecordsCached）。
 */
async function buildLocalApprovalTodos(
  env: Env,
  user: { name: string; open_id: string },
  role: UserRole,
): Promise<{ count: number; items: TodoApprovalLocalItem[] }> {
  const cfg = await getFlowsConfig(env);
  const items: TodoApprovalLocalItem[] = [];
  const now = Date.now();
  for (const type of APPROVAL_TYPES) {
    const res = await fetchFlowRecordsCached(env, type);
    if (!res) continue;
    const { records, base, tableId } = res;
    const statusKey = findFieldKey(records, APPROVAL_STATUS_PATTERNS);
    if (!statusKey) continue;
    const idKey = findFieldKey(records, APPROVAL_ID_PATTERNS);
    const openIdKey = findFieldKey(records, OPEN_ID_PATTERNS);
    const applicantKey = findFieldKey(records, APPROVAL_APPLICANT_PATTERNS);
    const deadlineKey = type === "compliance" ? findFieldKey(records, COMPLIANCE_PUBLISH_AT_PATTERNS) : null;
    const seeAll = isApprover(role, cfg[type].approvers);
    for (const r of records) {
      if (fieldText(r.fields[statusKey]) !== "审批中") continue;
      if (!seeAll) {
        const mine =
          (openIdKey && fieldText(r.fields[openIdKey]) === user.open_id) ||
          (!openIdKey && applicantKey && personMatches(fieldText(r.fields[applicantKey]), user.name));
        if (!mine) continue;
      }
      const appId = idKey ? fieldText(r.fields[idKey]) : r.record_id;
      const deadline = deadlineKey ? fieldTs(r.fields[deadlineKey]) : null;
      items.push({
        application_id: appId,
        title: `${appId} ${firstFieldText(r)}`.trim(),
        url: buildRecordLink(base, tableId, r.record_id),
        type,
        deadline,
        urgent: type === "compliance" && deadline !== null && deadline - now <= T1_URGENT_MS,
      });
    }
  }
  // urgent（T-1）置顶，其余按 deadline 升序（无 deadline 排最后）
  items.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return (a.deadline ?? Infinity) - (b.deadline ?? Infinity);
  });
  return { count: items.length, items: items.slice(0, 20) };
}

/** 记录的人名字段是否包含当前用户（负责人/申请人等多值字段按分隔符拆分后精确比对） */
function personMatches(raw: string, name: string): boolean {
  if (!name) return false;
  return raw
    .split(/[、,，;；\/\s]+/)
    .map((s) => s.trim())
    .some((n) => n === name);
}

function buildTodoTasks(records: BitableRecord[], userName: string, base: string, tableId: string): TodoTask[] {
  const statusKey = findFieldKey(records, TASK_STATUS_PATTERNS);
  const ownerKey = findFieldKey(records, TASK_OWNER_PATTERNS);
  const titleKey = findFieldKey(records, TASK_TITLE_PATTERNS);
  const deadlineKey = findFieldKey(records, TASK_DEADLINE_PATTERNS);
  if (!ownerKey || !deadlineKey) return [];
  // 今天 00:00（本地时区）：截止 < 今天零点才算逾期（今天到期的还不算逾期）
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startOfToday = today.getTime();
  const out: TodoTask[] = [];
  for (const r of records) {
    const owner = fieldText(r.fields[ownerKey]);
    if (!personMatches(owner, userName)) continue;
    const status = statusKey ? fieldText(r.fields[statusKey]) : "";
    if (status && TASK_DONE_RE.test(status)) continue;
    const deadline = fieldTs(r.fields[deadlineKey]);
    if (deadline === null || deadline >= startOfToday) continue;
    out.push({
      title: (titleKey ? fieldText(r.fields[titleKey]) : "") || firstFieldText(r),
      owner,
      status: status || "未标注",
      deadline,
      daysOverdue: Math.floor((startOfToday - deadline) / 86400000),
      link: buildRecordLink(base, tableId, r.record_id),
    });
  }
  return out.sort((a, b) => (a.deadline ?? 0) - (b.deadline ?? 0));
}

function buildTodoFinance(
  records: BitableRecord[],
  userName: string,
  seeAll: boolean,
  base: string,
  tableId: string,
): { count: number; items: TodoFinanceItem[] } {
  const statusKey = findFieldKey(records, FINANCE_FLOW_STATUS_PATTERNS);
  const itemKey = findFieldKey(records, FINANCE_ITEM_PATTERNS);
  const amountKey = findFieldKey(records, FINANCE_AMOUNT_PATTERNS);
  const applicantKey = findFieldKey(records, FINANCE_APPLICANT_PATTERNS);
  if (!statusKey) return { count: 0, items: [] };
  const items: TodoFinanceItem[] = [];
  for (const r of records) {
    const status = fieldText(r.fields[statusKey]);
    if (!status || !FINANCE_PENDING_RE.test(status)) continue;
    const applicant = applicantKey ? fieldText(r.fields[applicantKey]) : "";
    if (!seeAll && !personMatches(applicant, userName)) continue;
    items.push({
      name: (itemKey ? fieldText(r.fields[itemKey]) : "") || firstFieldText(r),
      amount: amountKey ? fieldNum(r.fields[amountKey]) : null,
      applicant,
      status,
      link: buildRecordLink(base, tableId, r.record_id),
    });
  }
  return { count: items.length, items: items.slice(0, 20) };
}

/** 飞书审批待办：需要 approval 相关 scope，未开通/权限不足时静默降级 */
async function fetchApprovalTodos(env: Env, openId: string): Promise<{ count: number; items: Array<{ title: string; link: string }> }> {
  const token = await getTenantAccessToken(env);
  const resp = await fetch(`${FEISHU_API}/approval/v4/instances/search?user_id_type=open_id`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ user_id: openId, status: "PENDING", page_size: "20" }),
  });
  const data = (await resp.json()) as {
    code?: number;
    msg?: string;
    data?: { approval_code_list?: string[]; instance_code_list?: string[]; count?: number };
  };
  if (data.code !== 0) throw new Error(data.msg ?? `code ${data.code}`);
  const codes = data.data?.instance_code_list ?? data.data?.approval_code_list ?? [];
  return {
    count: data.data?.count ?? codes.length,
    items: codes.slice(0, 20).map((c) => ({
      title: `审批实例 ${c}`,
      link: `https://www.feishu.cn/approval/instance/${c}`,
    })),
  };
}

export async function buildTodos(env: Env, user: { name: string; open_id: string }, ctx?: ExecutionContext): Promise<TodosPayload> {
  const cacheKey = `todos:${user.open_id}`;
  const cached = (await env.REGISTRY.get(cacheKey, "json")) as { data: TodosPayload; cachedAt: number } | null;
  if (cached && cached.cachedAt > Date.now() - TODOS_CACHE_TTL_SEC * 1000) {
    return { ...cached.data, cached: true };
  }

  const warnings: string[] = [];
  let tasks: TodoTask[] = [];
  let finance: { count: number; scope: "mine" | "all"; items: TodoFinanceItem[] } = { count: 0, scope: "mine", items: [] };
  let approvals: { count: number; items: Array<{ title: string; link: string }> } = { count: 0, items: [] };
  let approvalsLocal: { count: number; items: TodoApprovalLocalItem[] } = { count: 0, items: [] };

  // 审批待办与看板表互不依赖，先行启动，最后统一收口（warnings 顺序保持不变）
  const approvalsPromise =
    env.FEISHU_APP_ID && env.FEISHU_APP_SECRET
      ? fetchApprovalTodos(env, user.open_id).then(
          (value) => ({ ok: true as const, value }),
          (err: unknown) => ({ ok: false as const, err }),
        )
      : null;
  const rolePromise = resolveUserRole(env, user, ctx);

  const cfg = await getDashboardConfig(env);
  if (!cfg) {
    warnings.push("数据看板未配置，仅聚合飞书审批待办");
  } else {
    // 任务/财务表读取并行（角色解析已在上方启动）
    const [t, f] = await Promise.all([fetchTableCached(env, cfg, "tasks", ctx), fetchTableCached(env, cfg, "finance", ctx)]);
    const seeAllFinance = canSeeFinanceDetail(await rolePromise);
    if (cfg.tables.tasks) {
      if (t.error) warnings.push(`任务表读取失败：${t.error}`);
      else tasks = buildTodoTasks(t.records, user.name, cfg.base, cfg.tables.tasks);
    }
    if (cfg.tables.finance) {
      if (f.error) warnings.push(`财务报销表读取失败：${f.error}`);
      else {
        const fin = buildTodoFinance(f.records, user.name, seeAllFinance, cfg.base, cfg.tables.finance);
        finance = { ...fin, scope: seeAllFinance ? "all" : "mine" };
      }
    }
  }

  // G-04 本地审批底表：失败不阻断其他待办（降级为 0 条 + warning）
  try {
    approvalsLocal = await buildLocalApprovalTodos(env, user, await rolePromise);
  } catch (err) {
    warnings.push(`本地审批底表读取失败：${err instanceof Error ? err.message : String(err)}`);
  }

  if (approvalsPromise) {
    const res = await approvalsPromise;
    if (res.ok) approvals = res.value;
    else {
      warnings.push(`飞书审批待办不可用（审批 API scope 未开通或未授权），已降级为任务/报销聚合：${res.err instanceof Error ? res.err.message : String(res.err)}`);
    }
  } else {
    warnings.push("飞书应用未配置，跳过审批待办聚合");
  }

  const payload: TodosPayload = {
    generatedAt: new Date().toISOString(),
    cached: false,
    total: tasks.length + finance.count + approvals.count + approvalsLocal.count,
    tasks,
    finance,
    approvals,
    approvals_local: approvalsLocal,
    warnings,
  };
  const write = env.REGISTRY.put(cacheKey, JSON.stringify({ data: payload, cachedAt: Date.now() }));
  if (ctx) ctx.waitUntil(write);
  else await write;
  return payload;
}

/** GET /api/todos：登录门禁；返回当前用户的聚合待办（5 分钟缓存） */
export async function handleTodos(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "请先登录" }, 401);
  try {
    return json(await buildTodos(env, session.user, ctx));
  } catch (err) {
    // 聚合失败不 500：返回空待办 + 错误说明，门户待办条自动隐藏
    return json({
      generatedAt: new Date().toISOString(),
      cached: false,
      total: 0,
      tasks: [],
      finance: { count: 0, scope: "mine", items: [] },
      approvals: { count: 0, items: [] },
      approvals_local: { count: 0, items: [] },
      warnings: [`待办聚合失败：${err instanceof Error ? err.message : String(err)}`],
    } satisfies TodosPayload);
  }
}
