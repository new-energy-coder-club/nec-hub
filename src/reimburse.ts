/**
 * 报销旧端点兼容壳：/api/reimburse 系列 → 委托 approvals 引擎（flow key "reimburse"）。
 *
 * 状态机/写表/通知全部由引擎承担（runApprovalAction / submitApprovalCore），本文件只保留：
 *   - POST /api/reimburse                → 表单校验 + 凭证 R2 存档 + submitApprovalCore
 *   - POST /api/reimburse/<单号>/<action> → 角色门禁 + runApprovalAction（approve/reject/pay）
 *   - GET  /api/reimburse/mine           → 纯读列表（数据源 = 引擎 reimburse 底表）
 * 对外请求/响应形状与旧实现一致，前端与脚本零改动。
 */

import {
  fieldText,
  fieldTs,
  getTenantAccessToken,
  queryBitableRecords,
} from "./feishu/bitable";
import { canSeeFinanceDetail, resolveUserRole } from "./auth/role";
import { ApprovalError, getFlowBase, getFlowsConfig } from "./approvals/flows";
import { runApprovalAction, submitApprovalCore, type ApprovalAction } from "./approvals/engine";
import { syncReimburseDocStatus } from "./erp/reimburse";
import {
  FINANCE_AMOUNT_PATTERNS,
  FINANCE_ITEM_PATTERNS,
  REIMBURSE_APPROVER_PATTERNS,
  REIMBURSE_COMMENT_PATTERNS,
  REIMBURSE_ID_PATTERNS,
  REIMBURSE_OPEN_ID_PATTERNS,
  REIMBURSE_STATUS_PATTERNS,
  REIMBURSE_SUBMIT_TIME_PATTERNS,
  findFieldKey,
} from "./shared/bitable-fields";
import { json } from "./shared/http";
import { resolveSession } from "./shared/session";

/**
 * POST /api/reimburse（multipart/form-data，需登录）
 * 字段：item / amount / date(YYYY-MM-DD) / note / invno / receipt(单据文件) / payment(付款凭证文件)
 * 流程：文件 → R2 receipts/ 存档；再委托审批引擎写入 reimburse 底表（状态=审批中，
 * 单号 BX-<年>-<序号4位> 走 core/serial.ts）。引擎侧失败不阻断已存档凭证，降级为 warning 返回。
 */
export async function handleReimburse(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "请先登录后再提交报销" }, 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "请求必须是 multipart/form-data" }, 400);
  }

  const item = String(form.get("item") ?? "").trim();
  const amount = Number(String(form.get("amount") ?? "").replace(/[,，¥￥\s]/g, ""));
  const dateStr = String(form.get("date") ?? "").trim();
  const note = String(form.get("note") ?? "").trim();
  const invno = String(form.get("invno") ?? "").trim();
  if (!item) return json({ error: "请填写报销事项" }, 400);
  if (!Number.isFinite(amount) || amount <= 0) return json({ error: "请填写有效金额" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return json({ error: "请选择报销时间" }, 400);

  // 1. 单据与付款凭证 → R2（10MB 上限）
  const day = dateStr.replace(/-/g, "");
  const files: Record<string, string> = {};
  for (const [field, label] of [["receipt", "单据"], ["payment", "付款凭证"]] as const) {
    const f = form.get(field);
    if (f instanceof File && f.size > 0) {
      if (f.size > 10 * 1024 * 1024) return json({ error: label + "超过 10MB 上限" }, 400);
      const safe = (f.name || field).replace(/[^\w.\-一-龥]+/g, "_").slice(-60);
      const key = "receipts/" + day + "/" + crypto.randomUUID() + "-" + safe;
      await env.APPS_BUCKET.put(key, await f.arrayBuffer(), {
        httpMetadata: { contentType: f.type || "application/octet-stream" },
      });
      files[field] = key;
    }
  }

  const result: Record<string, unknown> = { ok: true, files };

  // 2. 委托审批引擎写 reimburse 底表（引擎失败降级 warning，与旧行为一致：凭证已存档）
  try {
    const role = await resolveUserRole(env, session.user, ctx);
    // 报销时间折进事项文本：底表日期列类型不固定（DateTime/Text），文本最稳且信息不丢
    const suffix = [`报销时间 ${dateStr}`, ...(note ? [note] : [])];
    const fields: Record<string, unknown> = {
      事项: `${item}（${suffix.join("；")}）`,
      报销金额: amount,
      发票号: invno,
    };
    const keys = Object.values(files);
    if (keys.length) fields["发票照片"] = keys.join("\n");
    const submitted = await submitApprovalCore(env, { type: "reimburse", fields, user: session.user, role, source: "portal" });
    result.application_id = submitted.application_id;
    result.status = submitted.status;
    // 引擎已写 approval:map:<单号> → record_id，读回供旧前端提示「已写入财务报销表」
    const map = (await env.REGISTRY.get(`approval:map:${submitted.application_id}`, "json")) as { record_id?: string } | null;
    if (map?.record_id) result.recordId = map.record_id;
    await env.REGISTRY.delete("dashboard:cache:finance");
  } catch (err) {
    result.warning =
      err instanceof ApprovalError
        ? err.message
        : "凭证已存档，但写入财务报销表失败：" + (err instanceof Error ? err.message : String(err));
  }
  return json(result);
}

/** 旧端点支持的审批动作（引擎动作全集的子集） */
const LEGACY_ACTIONS = ["approve", "reject", "pay"] as const;

/**
 * POST /api/reimburse/<applicationId>/<action>，action ∈ approve | reject | pay
 * 仅队长/财务可执行；reject 必带 comment。状态机委托 runApprovalAction（幂等 + 409 前置校验）。
 */
export async function handleReimburseAction(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  applicationId: string,
  action: string,
): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "请先登录" }, 401);
  if (!(LEGACY_ACTIONS as readonly string[]).includes(action)) {
    return json({ error: "未知动作：支持 approve | reject | pay" }, 400);
  }

  const role = await resolveUserRole(env, session.user, ctx);
  if (!canSeeFinanceDetail(role)) {
    return json({ error: "权限不足：报销审批仅队长/财务角色可执行", role: role.role }, 403);
  }

  let comment = "";
  if (action === "reject") {
    const body = (await request.json().catch(() => ({}))) as { comment?: string };
    comment = String(body.comment ?? "").trim();
    if (!comment) return json({ error: "驳回必须填写审批意见（comment）" }, 400);
  }

  try {
    const res = await runApprovalAction(env, {
      type: "reimburse",
      appId: applicationId.trim(),
      action: action as ApprovalAction,
      comment,
      onStatusChange: syncReimburseDocStatus,
      user: session.user,
      role,
    });
    await env.REGISTRY.delete("dashboard:cache:finance");
    return json({ application_id: applicationId, status: res.status });
  } catch (err) {
    if (err instanceof ApprovalError) {
      // 409 冲突保留旧响应形状（application_id + 当前状态 + error）
      if (err.status === 409) {
        return json({ application_id: applicationId, status: err.info?.current, error: err.message }, 409);
      }
      return json({ error: err.message }, err.status);
    }
    throw err;
  }
}

/** GET /api/reimburse/mine：当前用户的报销申请（数据源 = 引擎 reimburse 底表，按提交时间倒序，最多 20 条） */
export async function handleReimburseMine(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "请先登录" }, 401);
  const flow = (await getFlowsConfig(env)).reimburse;
  const base = flow.tableId ? await getFlowBase(env, flow) : "";
  if (!flow.tableId || !base) return json({ records: [], hint: "未配置财务报销表" });

  const token = await getTenantAccessToken(env);
  // filter 下推按 open_id 只拉本人的单；search 失败回退全表扫描（match 保留字段名模糊匹配，语义不变）
  const records = await queryBitableRecords(
    token,
    base,
    flow.tableId,
    [{ field_name: "申请人 open_id", operator: "is", value: [session.user.open_id] }],
    (r, rs) => {
      const k = findFieldKey(rs, REIMBURSE_OPEN_ID_PATTERNS);
      return k !== null && fieldText(r.fields[k]) === session.user.open_id;
    },
  );
  const oidKey = findFieldKey(records, REIMBURSE_OPEN_ID_PATTERNS);
  const mine = records.filter((r) => oidKey !== null && fieldText(r.fields[oidKey]) === session.user.open_id);
  const idKey = findFieldKey(mine, REIMBURSE_ID_PATTERNS);
  const statusKey = findFieldKey(mine, REIMBURSE_STATUS_PATTERNS);
  const timeKey = findFieldKey(mine, REIMBURSE_SUBMIT_TIME_PATTERNS);
  const itemKey = findFieldKey(mine, FINANCE_ITEM_PATTERNS);
  const amountKey = findFieldKey(mine, FINANCE_AMOUNT_PATTERNS);
  const approverKey = findFieldKey(mine, REIMBURSE_APPROVER_PATTERNS);
  const commentKey = findFieldKey(mine, REIMBURSE_COMMENT_PATTERNS);

  const sorted = [...mine].sort((a, b) => {
    const ta = timeKey ? (fieldTs(a.fields[timeKey]) ?? 0) : 0;
    const tb = timeKey ? (fieldTs(b.fields[timeKey]) ?? 0) : 0;
    return tb - ta;
  });

  return json({
    records: sorted.slice(0, 20).map((r) => ({
      application_id: idKey ? fieldText(r.fields[idKey]) : "",
      status: statusKey ? fieldText(r.fields[statusKey]) : "未知",
      fields: {
        ...(idKey ? { 申请单号: fieldText(r.fields[idKey]) } : {}),
        ...(itemKey ? { 事项: fieldText(r.fields[itemKey]) } : {}),
        ...(amountKey ? { 金额: fieldText(r.fields[amountKey]) } : {}),
        ...(timeKey ? { 提交时间: fieldText(r.fields[timeKey]) } : {}),
        ...(approverKey ? { 审批人: fieldText(r.fields[approverKey]) } : {}),
        ...(commentKey ? { 审批意见: fieldText(r.fields[commentKey]) } : {}),
      },
    })),
  });
}
