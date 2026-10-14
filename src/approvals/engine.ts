/**
 * 审批引擎核心（REST 与 MCP 共用）：发起 → 状态机动作 → 待办聚合
 *
 * 状态机落多维表格"状态"字段（Plan B）；审批结果与状态变更推飞书群机器人（notifyFeishu）。
 * 底表记录链接复用 validation/service 的 buildRecordLink（与门户「数据健康」一致）。
 */

import { getDashboardConfig, fetchTableCached } from "../dashboard";
import {
  createBitableRecord,
  fieldNum,
  fieldText,
  findFieldKey,
  firstFieldText,
  getTenantAccessToken,
  listBitableRecords,
  updateBitableRecord,
  type BitableRecord,
} from "../feishu/bitable";
import { notifyFeishu } from "../feishu/bot";
import type { HubUser } from "../shared/session";
import type { UserRole } from "../auth/role";
import { buildRecordLink } from "../validation/service";
import {
  APPROVAL_TYPES,
  ApprovalError,
  evalFlowFields,
  findRecordByAppId,
  getFlowBase,
  getFlowsConfig,
  isApprover,
  nextAppId,
  type ApprovalType,
} from "./flows";

export const APPROVAL_LABELS: Record<ApprovalType, string> = {
  reimburse: "报销申请",
  drawing: "图纸审批",
  hardware: "硬件申请",
  compliance: "合规申请",
};

/** 通知标题：📋 新报销申请 BX-2026-0001（张三 ¥120） */
function approvalNotifyTitle(type: ApprovalType, applicationId: string, applicant: string, fields: Record<string, unknown>): string {
  let extra = "";
  if (type === "reimburse") {
    const amount = fieldNum(fields["报销金额"]);
    if (amount !== null) extra = ` ¥${amount}`;
  }
  return `📋 新${APPROVAL_LABELS[type]} ${applicationId}（${applicant}${extra}）`;
}

/** 通知正文：取前几个非空业务字段（key：value 逐行） */
function approvalNotifyContent(fields: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of Object.keys(fields)) {
    if (k === "applicant_open_id") continue;
    const v = fieldText(fields[k]).trim();
    if (!v) continue;
    parts.push(`${k}：${v.length > 60 ? v.slice(0, 60) + "…" : v}`);
    if (parts.length >= 4) break;
  }
  return parts.join("\n") || "（无附加信息）";
}

export interface ApprovalSubmitInput {
  type: ApprovalType;
  fields: Record<string, unknown>;
  /** 门户提交：当前登录用户；MCP 代提交：null */
  user: HubUser | null;
  /** 当前用户角色（门户路径）；MCP 代提交为 null（组别写空） */
  role: UserRole | null;
  /** MCP 代提交的申请人姓名（门户路径忽略） */
  applicantName?: string;
  source: "portal" | "mcp";
}

/** 发起审批：校验 → 写底表（状态=审批中）→ 单号回填 → KV 映射 → 通知审批人群 */
export async function submitApprovalCore(env: Env, input: ApprovalSubmitInput): Promise<{ application_id: string; status: string }> {
  const cfg = await getFlowsConfig(env);
  const flow = cfg[input.type];
  if (!flow.tableId) {
    throw new ApprovalError(`流程未配置：先用 MCP config_flows 配置 ${input.type} 的 tableId`);
  }
  const applicant = input.user?.name ?? (input.applicantName ?? "").trim();
  if (!applicant) {
    throw new ApprovalError("申请人姓名为空：门户提交需登录，MCP 代提交需 applicant_name");
  }
  const applicantOpenId = input.user?.open_id ??
    (String(input.fields.applicant_open_id ?? "").trim() || "mcp-admin");
  const missing = evalFlowFields(flow, input.fields);
  if (missing.length) {
    throw new ApprovalError(`字段校验未通过，缺少：${missing.join("、")}`);
  }
  const base = await getFlowBase(env, flow);
  if (!base) {
    throw new ApprovalError("流程未配置 base：先用 config_flows 配置 base（或 config_dashboard 配置看板 base）");
  }
  const token = await getTenantAccessToken(env);
  const existing = await listBitableRecords(token, base, flow.tableId);
  const applicationId = nextAppId(flow.prefix, existing.length);
  const row: Record<string, unknown> = {
    ...input.fields,
    申请人: applicant,
    "申请人 open_id": applicantOpenId,
    组别: input.role?.group ?? "",
    状态: "审批中",
    提交时间: Date.now(),
    申请单号: applicationId,
  };
  const created = await createBitableRecord(token, base, flow.tableId, row);
  const recordId = created.record_id;
  await env.REGISTRY.put(
    `approval:map:${applicationId}`,
    JSON.stringify({ type: input.type, record_id: recordId }),
    { expirationTtl: 90 * 24 * 3600 },
  );
  const link = buildRecordLink(base, flow.tableId, recordId);
  await notifyFeishu(env, input.type, approvalNotifyTitle(input.type, applicationId, applicant, input.fields), approvalNotifyContent(input.fields), link);
  // Plan B 会签：金额达阈值时额外提醒（两级审批为 Plan A 能力，Plan B 用通知实现）
  const coField = flow.thresholds?.amountField ?? "";
  const coSign = flow.thresholds?.coSign ?? 0;
  const amount = coField ? fieldNum(input.fields[coField]) : null;
  if (coSign > 0 && amount !== null && amount >= coSign && flow.thresholds?.notifyRoles) {
    await notifyFeishu(
      env,
      input.type,
      `⚠️ 金额会签提醒 ${applicationId}：${coField} ¥${amount} ≥ ${coSign}`,
      `请 ${flow.thresholds.notifyRoles} 复核`,
      link,
    );
  }
  return { application_id: applicationId, status: "审批中" };
}

export const APPROVAL_ACTIONS = ["approve", "reject", "pay", "start", "archive", "arrive", "issue", "publish"] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

/** 动作 → 目标状态与前置状态（幂等：目标状态=当前状态直接返回成功） */
export const ACTION_TARGET: Record<ApprovalAction, { from: RegExp; to: string }> = {
  approve: { from: /^审批中$/, to: "已通过" },
  reject: { from: /^审批中$/, to: "已驳回" },
  pay: { from: /^已通过$/, to: "已打款" },
  start: { from: /^已通过$/, to: "加工中" },
  archive: { from: /^加工中$/, to: "已归档" },
  arrive: { from: /^已通过$/, to: "已到货" },
  issue: { from: /^已通过$/, to: "已领用" },
  publish: { from: /^已通过$/, to: "已发布" },
};

export interface ApprovalActionInput {
  type: ApprovalType;
  appId: string;
  action: ApprovalAction;
  comment?: string;
  link?: string;
  user: HubUser;
  role: UserRole;
}

export async function runApprovalAction(env: Env, input: ApprovalActionInput): Promise<{ application_id: string; status: string }> {
  const cfg = await getFlowsConfig(env);
  const flow = cfg[input.type];
  if (!flow.tableId) {
    throw new ApprovalError(`流程未配置：先用 MCP config_flows 配置 ${input.type} 的 tableId`);
  }
  const base = await getFlowBase(env, flow);
  if (!base) throw new ApprovalError("流程未配置 base");
  const token = await getTenantAccessToken(env);
  const records = await listBitableRecords(token, base, flow.tableId);
  const record = findRecordByAppId(records, input.appId);
  if (!record) throw new ApprovalError(`底表中未找到申请单号 ${input.appId}`, 404);

  const statusKey = findFieldKey(records, [/^状态$/, /状态/, /进度/]) ?? "状态";
  const current = fieldText(record.fields[statusKey]);
  const target = ACTION_TARGET[input.action].to;

  // 角色前置校验
  if (input.action === "approve" || input.action === "reject" || input.action === "arrive" || input.action === "issue") {
    if (!isApprover(input.role, flow.approvers)) {
      throw new ApprovalError(`当前角色（${input.role.role}）无权执行 ${input.action}`, 403);
    }
  } else if (input.action === "pay") {
    if (!/财务|队长/.test(input.role.role)) {
      throw new ApprovalError("已打款仅财务/队长可标记", 403);
    }
  } else {
    // start / archive / publish：仅申请人本人
    const applicantKey = findFieldKey(records, [/^申请人$/, /申请人/, /报销人/]);
    const openIdKey = findFieldKey(records, [/open_?id|飞书/i]);
    const isOwner =
      (openIdKey && fieldText(record.fields[openIdKey]) === input.user.open_id) ||
      (applicantKey && fieldText(record.fields[applicantKey]) === input.user.name);
    if (!isOwner) throw new ApprovalError("仅申请人本人可执行该动作", 403);
  }

  // 幂等：目标状态=当前状态 → 直接返回当前状态
  if (current === target) return { application_id: input.appId, status: current };
  if (!ACTION_TARGET[input.action].from.test(current)) {
    throw new ApprovalError(`当前状态为「${current || "空"}」，不能执行 ${input.action} →「${target}」`, 409);
  }
  if (input.action === "reject" && !(input.comment ?? "").trim()) {
    throw new ApprovalError("驳回必须填写审批意见（comment）");
  }
  if (input.action === "publish" && !(input.link ?? "").trim()) {
    throw new ApprovalError("publish 必须提供发布链接（link）");
  }

  const patch: Record<string, unknown> = { [statusKey]: target };
  if (input.action === "approve" || input.action === "reject") {
    patch["审批人"] = input.user.name;
    patch["审批意见"] = input.comment ?? "";
    patch["审批完成时间"] = Date.now();
  }
  if (input.action === "publish") patch["发布后链接"] = (input.link ?? "").trim();
  await updateBitableRecord(token, base, flow.tableId, record.record_id, patch);

  const link = buildRecordLink(base, flow.tableId, record.record_id);
  if (input.action === "approve" || input.action === "reject") {
    const verdict = input.action === "approve" ? "✅ 已通过" : "❌ 已驳回";
    await notifyFeishu(
      env,
      input.type,
      `${verdict} ${input.appId}`,
      `审批人：${input.user.name}${input.comment ? `\n审批意见：${input.comment}` : ""}`,
      link,
    );
  } else {
    await notifyFeishu(env, input.type, `📌 ${input.appId} 状态更新：${target}`, `操作人：${input.user.name}`, link);
  }
  return { application_id: input.appId, status: target };
}

// ---------- 待办聚合（MCP list_todos 用） ----------

const TODO_CACHE_TTL_SEC = 300;

/** 任务完成态判定（与 dashboard.ts / todos.ts 保持一致） */
const TASK_DONE_RE = /完成|已完|完结|done|取消|cancel|关闭|close|drop/i;

/**
 * 待办聚合：4 张流程底表中 状态="审批中" 且当前角色可审的行（按 type 分组）+ 逾期任务前 8 条。
 * 缓存键 todo:tbl:<type> 存全量列表（不带用户过滤，过滤在内存做，保证各角色角标一致）。
 */
export async function aggregateTodos(env: Env, role: UserRole): Promise<unknown> {
  const cfg = await getFlowsConfig(env);
  const dashCfg = await getDashboardConfig(env);
  const token = await getTenantAccessToken(env).catch(() => "");
  const byType: Record<string, unknown> = {};
  let cachedAt = "";

  for (const type of APPROVAL_TYPES) {
    const flow = cfg[type];
    if (!flow.tableId) continue;
    const base = flow.base || dashCfg?.base || "";
    if (!base) continue;
    const cacheKey = `todo:tbl:${type}`;
    const cached = await env.REGISTRY.get(cacheKey, "json") as
      | { data: BitableRecord[]; cachedAt: number }
      | null;
    const fresh = cached && cached.cachedAt > Date.now() - TODO_CACHE_TTL_SEC * 1000;
    let records: BitableRecord[];
    let at: string;
    if (fresh) {
      records = cached!.data;
      at = new Date(cached!.cachedAt).toISOString();
    } else if (token) {
      try {
        records = await listBitableRecords(token, base, flow.tableId);
        at = new Date().toISOString();
        await env.REGISTRY.put(cacheKey, JSON.stringify({ data: records, cachedAt: Date.now() }), { expirationTtl: TODO_CACHE_TTL_SEC });
      } catch {
        records = cached?.data ?? [];
        at = cached ? new Date(cached.cachedAt).toISOString() : "";
      }
    } else {
      records = cached?.data ?? [];
      at = cached ? new Date(cached.cachedAt).toISOString() : "";
    }
    if (!cachedAt && at) cachedAt = at;
    if (!isApprover(role, flow.approvers)) continue;
    const statusKey = findFieldKey(records, [/^状态$/, /状态/, /进度/]) ?? "状态";
    const idKey = findFieldKey(records, [/^申请单号$/, /申请单号/, /单号/]);
    const timeKey = findFieldKey(records, [/提交时间/, /创建时间/]);
    const pending = records.filter((r) => fieldText(r.fields[statusKey]) === "审批中");
    if (!pending.length) continue;
    byType[type] = pending.map((r) => ({
      application_id: idKey ? fieldText(r.fields[idKey]) : r.record_id,
      title: ((idKey ? fieldText(r.fields[idKey]) : "") + " " + firstFieldText(r)).trim(),
      url: buildRecordLink(base, flow.tableId, r.record_id),
      submitted_at: timeKey ? fieldText(r.fields[timeKey]) : "",
    }));
  }

  // 逾期任务（复用看板 tasks 表 + 5 分钟缓存）：截止 < 今天 且状态未完成，前 8 条
  const overdueTasks: Array<{ title: string; owner: string; deadline: string }> = [];
  if (dashCfg?.tables?.tasks && token) {
    const t = await fetchTableCached(env, dashCfg, "tasks");
    const tTitleKey = findFieldKey(t.records, [/^任务/, /任务/, /事项/, /标题/, /title/i]);
    const tOwnerKey = findFieldKey(t.records, [/负责人/, /执行人/, /owner/i, /assignee/i]);
    const tStatusKey = findFieldKey(t.records, [/^状态/, /状态/, /进度/, /status/i]);
    const tDeadlineKey = findFieldKey(t.records, [/截止/, /deadline/i, /完成时间/, /日期/]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    overdueTasks.push(
      ...t.records
        .filter((r) => {
          const s = tStatusKey ? fieldText(r.fields[tStatusKey]) : "";
          const d = fieldNum(r.fields[tDeadlineKey ?? ""]);
          return !!s && !TASK_DONE_RE.test(s) && d !== null && d < today.getTime();
        })
        .sort((a, b) => (fieldNum(a.fields[tDeadlineKey ?? ""]) ?? Infinity) - (fieldNum(b.fields[tDeadlineKey ?? ""]) ?? Infinity))
        .slice(0, 8)
        .map((r) => ({
          title: (tTitleKey ? fieldText(r.fields[tTitleKey]) : "") || firstFieldText(r),
          owner: tOwnerKey ? fieldText(r.fields[tOwnerKey]) : "",
          deadline: tDeadlineKey ? fieldText(r.fields[tDeadlineKey]) : "",
        })),
    );
  }
  return { by_type: byType, overdue_tasks: overdueTasks, cached_at: cachedAt || new Date().toISOString() };
}
