/**
 * FE-09 审批/待办聚合 — GET /api/todos（需登录）
 *
 * 聚合三类待办：
 *   ① 任务表：负责人=当前用户 且 截止<今天 且 状态≠完成 的逾期任务（跳多维表格记录直链）；
 *   ② 财务报销表：状态为待确认/进行中的记录（队员只见自己，队长/财务见全部，复用看板角色判定）；
 *   ③ 飞书审批待办：尝试调飞书审批 API；权限不足/未开通时静默降级到 warnings，不报错。
 *
 * 结果按用户缓存（KV todos:<open_id>，TTL 5 分钟），飞书免费版限流保护。
 */

import { canSeeFinanceDetail, resolveUserRole } from "./auth/role";
import { fetchTableCached, getDashboardConfig } from "./dashboard";
import { fieldNum, fieldText, fieldTs, findFieldKey, firstFieldText, getTenantAccessToken, type BitableRecord } from "./feishu/bitable";
import { json } from "./shared/http";
import { applyRenewedSession, resolveSession } from "./shared/session";
import { buildRecordLink } from "./validation/service";

/** 待办缓存 TTL（秒）：与看板一致 5 分钟 */
const TODOS_CACHE_TTL_SEC = 300;

/** 任务完成态判定（与 dashboard.ts 保持一致） */
const TASK_DONE_RE = /完成|已完|完结|done|取消|cancel|关闭|close|drop/i;

/** 报销待处理状态（待确认/进行中等） */
const FINANCE_PENDING_RE = /待确认|待审核|待审批|待处理|进行中|审批中|提交/;

const FEISHU_API = "https://open.feishu.cn/open-apis";

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

export interface TodosPayload {
  generatedAt: string;
  /** true = 命中 5 分钟缓存 */
  cached: boolean;
  total: number;
  tasks: TodoTask[];
  finance: { count: number; scope: "mine" | "all"; items: TodoFinanceItem[] };
  approvals: { count: number; items: Array<{ title: string; link: string }> };
  warnings: string[];
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
  const statusKey = findFieldKey(records, [/^状态/, /状态/, /进度/, /status/i]);
  const ownerKey = findFieldKey(records, [/负责人/, /执行人/, /owner/i, /assignee/i]);
  const titleKey = findFieldKey(records, [/^任务/, /任务/, /事项/, /标题/, /title/i]);
  const deadlineKey = findFieldKey(records, [/截止/, /deadline/i, /完成时间/, /日期/]);
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
  const statusKey = findFieldKey(records, [/^状态/, /流程/, /进度/, /status/i]);
  const itemKey = findFieldKey(records, [/^事项/, /事项/, /用途/, /摘要/]);
  const amountKey = findFieldKey(records, [/报销金额/, /^金额/, /金额/, /费用/, /amount/i]);
  const applicantKey = findFieldKey(records, [/^申请人$/, /申请人/, /报销人/, /经手人/, /提交人/]);
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

  const cfg = await getDashboardConfig(env);
  if (!cfg) {
    warnings.push("数据看板未配置，仅聚合飞书审批待办");
  } else {
    const role = await resolveUserRole(env, user, ctx);
    const seeAllFinance = canSeeFinanceDetail(role);
    const [t, f] = await Promise.all([fetchTableCached(env, cfg, "tasks", ctx), fetchTableCached(env, cfg, "finance", ctx)]);
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

  if (env.FEISHU_APP_ID && env.FEISHU_APP_SECRET) {
    try {
      approvals = await fetchApprovalTodos(env, user.open_id);
    } catch (err) {
      warnings.push(`飞书审批待办不可用（审批 API scope 未开通或未授权），已降级为任务/报销聚合：${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    warnings.push("飞书应用未配置，跳过审批待办聚合");
  }

  const payload: TodosPayload = {
    generatedAt: new Date().toISOString(),
    cached: false,
    total: tasks.length + finance.count + approvals.count,
    tasks,
    finance,
    approvals,
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
    return applyRenewedSession(json(await buildTodos(env, session.user, ctx)), session.renewed);
  } catch (err) {
    // 聚合失败不 500：返回空待办 + 错误说明，门户待办条自动隐藏
    return applyRenewedSession(json({
      generatedAt: new Date().toISOString(),
      cached: false,
      total: 0,
      tasks: [],
      finance: { count: 0, scope: "mine", items: [] },
      approvals: { count: 0, items: [] },
      warnings: [`待办聚合失败：${err instanceof Error ? err.message : String(err)}`],
    } satisfies TodosPayload), session.renewed);
  }
}
