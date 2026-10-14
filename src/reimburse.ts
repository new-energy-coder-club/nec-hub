/**
 * 报销域：提交（上传单据/付款凭证 → R2；按字段类型写入财务报销表）
 *        + 审批动作（approve / reject / pay，角色门禁 + 状态机，对齐 main 引擎语义）
 *        + 我的报销列表（GET /api/reimburse/mine）
 */

import {
  bitableRecordLink,
  createBitableRecord,
  fieldText,
  fieldTs,
  findFieldKey,
  getTenantAccessToken,
  listBitableFields,
  listBitableRecords,
  matchField,
  updateBitableRecord,
  type BitableRecord,
} from "./feishu/bitable";
import { notifyFeishu } from "./feishu/notify";
import { getDashboardConfig } from "./dashboard";
import { canSeeFinanceDetail, resolveUserRole } from "./auth/role";
import { json } from "./shared/http";
import { resolveSession } from "./shared/session";

/**
 * POST /api/reimburse（multipart/form-data，需登录）
 * 字段：item / amount / date(YYYY-MM-DD) / note / receipt(单据文件) / payment(付款凭证文件)
 * 流程：文件 → R2 receipts/ 存档；再按字段名模糊匹配写入飞书「财务报销」表并清看板缓存。
 * 表的字段类型不同（日期 vs 文本），先读 fields 元数据按 ui_type 序列化。
 * 提交即进入"审批中"状态并生成申请单号 BX-<年>-<序号4位>。
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

  // 2. 写入财务报销表（字段名模糊匹配；写失败不影响已存档的凭证）
  const cfg = await getDashboardConfig(env);
  if (cfg?.tables.finance && env.FEISHU_APP_ID && env.FEISHU_APP_SECRET) {
    try {
      const token = await getTenantAccessToken(env);
      const metas = await listBitableFields(token, cfg.base, cfg.tables.finance);
      const record: Record<string, unknown> = {};

      const fItem = matchField(metas, [/^事项/, /事项/, /用途/, /摘要/], /Text/i);
      const fInvno = invno ? matchField(metas, [/发票号/, /票号/, /invoice/i], /Text/i) : undefined;
      if (fInvno) record[fInvno.field_name] = invno;
      if (fItem) {
        const suffix: string[] = [];
        if (note) suffix.push(note);
        if (invno && !fInvno) suffix.push("发票号 " + invno);
        record[fItem.field_name] = suffix.length ? item + "（" + suffix.join("；") + "）" : item;
      }
      const fAmount = matchField(metas, [/报销金额/, /^金额/, /金额/, /费用/, /amount/i], /Number|Currency/i);
      if (fAmount) record[fAmount.field_name] = amount;
      const fDate = matchField(metas, [/报销时间/, /报销日期/, /^日期/, /日期/, /时间/, /^date/i]);
      if (fDate) {
        record[fDate.field_name] = /DateTime/i.test(fDate.ui_type)
          ? Date.parse(dateStr + "T00:00:00+08:00")
          : dateStr;
      }
      const fApplicant = matchField(metas, [/^申请人$/, /申请人/, /报销人/, /经手人/, /提交人/], /Text/i);
      if (fApplicant) record[fApplicant.field_name] = session.user.name;
      const fApplicantOid = matchField(metas, [/open[_ -]?id/i], /Text/i);
      if (fApplicantOid) record[fApplicantOid.field_name] = session.user.open_id;
      const fStatus = matchField(metas, [/^状态/, /状态/], /Text|Select/i);
      if (fStatus) record[fStatus.field_name] = "审批中";
      const fAppId = matchField(metas, [/^申请单号/, /申请单号/, /单号/], /Text/i);
      if (fAppId) {
        const existing = await listBitableRecords(token, cfg.base, cfg.tables.finance);
        record[fAppId.field_name] = nextReimburseId(existing);
      }
      const fAttach = matchField(metas, [/凭证/, /单据/, /附件/, /票据/], /Text/i);
      const keys = Object.values(files);
      if (fAttach && keys.length) record[fAttach.field_name] = keys.join("\n");

      if (Object.keys(record).length === 0) {
        result.warning = "财务报销表未匹配到可写字段（事项/金额/报销时间），已仅存档凭证文件";
      } else {
        const created = await createBitableRecord(token, cfg.base, cfg.tables.finance, record);
        result.recordId = created.record_id;
        result.application_id = record[fAppId!.field_name];
        result.status = "审批中";
        await env.REGISTRY.delete("dashboard:cache:finance");
        // 群通知（N-01）：webhook 未配置/发送失败均不阻断提交
        if (result.application_id && result.recordId) {
          await notifyFeishu(
            env,
            "reimburse",
            `📋 新报销申请 ${result.application_id}（${session.user.name} ¥${amount}）`,
            [`事项：${item}`, `金额：¥${amount}`, `报销时间：${dateStr}`, ...(note ? [`备注：${note}`] : [])].join("\n"),
            bitableRecordLink(cfg.base, cfg.tables.finance, String(result.recordId)),
          );
        }
      }
    } catch (err) {
      result.warning = "凭证已存档，但写入财务报销表失败：" + (err instanceof Error ? err.message : String(err));
    }
  } else {
    result.warning = "未配置财务报销表或飞书应用，已仅存档凭证文件";
  }
  return json(result);
}

/** 申请单号：BX-<年>-<序号4位>（序号 = 现有记录数 + 1；并发下可能出现重号，由数据校验兜底） */
function nextReimburseId(existing: BitableRecord[]): string {
  const year = new Date().getFullYear();
  const seq = String(existing.length + 1).padStart(4, "0");
  return `BX-${year}-${seq}`;
}

/** 审批动作状态机：当前状态不符 → 409；已是目标状态 → 幂等返回 */
const REIMBURSE_ACTIONS: Record<string, { from: string; to: string; needComment?: boolean }> = {
  approve: { from: "审批中", to: "已通过" },
  reject: { from: "审批中", to: "已驳回", needComment: true },
  pay: { from: "已通过", to: "已打款" },
};

/**
 * POST /api/reimburse/<applicationId>/<action>，action ∈ approve | reject | pay
 * 仅队长/财务可执行；reject 必带 comment。
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
  const spec = REIMBURSE_ACTIONS[action];
  if (!spec) return json({ error: "未知动作：支持 approve | reject | pay" }, 400);

  const role = await resolveUserRole(env, session.user, ctx);
  if (!canSeeFinanceDetail(role)) {
    return json({ error: "权限不足：报销审批仅队长/财务角色可执行", role: role.role }, 403);
  }

  let comment = "";
  if (spec.needComment) {
    const body = (await request.json().catch(() => ({}))) as { comment?: string };
    comment = String(body.comment ?? "").trim();
    if (!comment) return json({ error: "驳回必须填写审批意见（comment）" }, 400);
  }

  const cfg = await getDashboardConfig(env);
  if (!cfg?.tables.finance) return json({ error: "未配置财务报销表" }, 400);
  const token = await getTenantAccessToken(env);
  const records = await listBitableRecords(token, cfg.base, cfg.tables.finance);
  const idKey = findFieldKey(records, [/^申请单号/, /申请单号/, /单号/]);
  const rec = records.find(
    (r) => idKey !== null && fieldText(r.fields[idKey]) === applicationId.trim(),
  );
  if (!rec) return json({ error: `找不到申请单 ${applicationId}` }, 404);

  const statusKey = findFieldKey(records, [/^状态/, /状态/]);
  if (!statusKey) return json({ error: "财务报销表缺少「状态」字段，无法执行审批动作" }, 500);
  const current = fieldText(rec.fields[statusKey]);
  if (current === spec.to) return json({ application_id: applicationId, status: spec.to }); // 幂等
  if (current !== spec.from) {
    return json({ application_id: applicationId, status: current, error: `状态不符：当前「${current}」，该动作要求「${spec.from}」` }, 409);
  }

  const metas = await listBitableFields(token, cfg.base, cfg.tables.finance);
  const updates: Record<string, unknown> = { [statusKey]: spec.to };
  const fApprover = matchField(metas, [/^审批人$/, /审批人/, /审核人/], /Text/i);
  if (fApprover) updates[fApprover.field_name] = session.user.name;
  const fComment = matchField(metas, [/审批意见/, /^意见/, /意见/], /Text/i);
  if (fComment && comment) updates[fComment.field_name] = comment;
  const fDoneAt = matchField(metas, [/审批完成时间/, /完成时间/]);
  if (fDoneAt) {
    updates[fDoneAt.field_name] = /DateTime/i.test(fDoneAt.ui_type)
      ? Date.now()
      : new Date().toISOString();
  }

  await updateBitableRecord(token, cfg.base, cfg.tables.finance, rec.record_id, updates);
  await env.REGISTRY.delete("dashboard:cache:finance");

  // 群通知（N-01）：审批结果/状态变更推送；未配置 webhook 时静默降级
  const link = bitableRecordLink(cfg.base, cfg.tables.finance, rec.record_id);
  if (action === "approve" || action === "reject") {
    await notifyFeishu(
      env,
      "reimburse",
      action === "approve" ? `✅ 已通过 ${applicationId}` : `❌ 已驳回 ${applicationId}`,
      `审批人：${session.user.name}${comment ? `\n审批意见：${comment}` : ""}`,
      link,
    );
  } else {
    await notifyFeishu(env, "reimburse", `📌 ${applicationId} 状态更新：${spec.to}`, `操作人：${session.user.name}`, link);
  }
  return json({ application_id: applicationId, status: spec.to });
}

/** GET /api/reimburse/mine：当前用户的报销申请（按提交时间倒序，最多 20 条） */
export async function handleReimburseMine(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "请先登录" }, 401);
  const cfg = await getDashboardConfig(env);
  if (!cfg?.tables.finance) return json({ records: [], hint: "未配置财务报销表" });

  const token = await getTenantAccessToken(env);
  const records = await listBitableRecords(token, cfg.base, cfg.tables.finance);
  const oidKey = findFieldKey(records, [/open[_ -]?id/i]);
  const mine = records.filter((r) => oidKey !== null && fieldText(r.fields[oidKey]) === session.user.open_id);
  const idKey = findFieldKey(mine, [/^申请单号/, /申请单号/, /单号/]);
  const statusKey = findFieldKey(mine, [/^状态/, /状态/]);
  const timeKey = findFieldKey(mine, [/^提交时间/, /提交时间/]);
  const itemKey = findFieldKey(mine, [/^事项/, /事项/, /用途/, /摘要/]);
  const amountKey = findFieldKey(mine, [/报销金额/, /^金额/, /金额/, /费用/, /amount/i]);
  const approverKey = findFieldKey(mine, [/^审批人$/, /审批人/, /审核人/]);
  const commentKey = findFieldKey(mine, [/审批意见/, /^意见/, /意见/]);

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