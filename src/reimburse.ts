/**
 * 报销提交（上传单据/付款凭证 → R2；按字段类型写入财务报销表）
 */

import { createBitableRecord, getTenantAccessToken, listBitableFields, matchField } from "./feishu/bitable";
import { getDashboardConfig } from "./dashboard";
import { json } from "./shared/http";
import { resolveSession } from "./shared/session";

/**
 * POST /api/reimburse（multipart/form-data，需登录）
 * 字段：item / amount / date(YYYY-MM-DD) / note / receipt(单据文件) / payment(付款凭证文件)
 * 流程：文件 → R2 receipts/ 存档；再按字段名模糊匹配写入飞书「财务报销」表并清看板缓存。
 * 表的字段类型不同（日期 vs 文本），先读 fields 元数据按 ui_type 序列化。
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
      const fAttach = matchField(metas, [/凭证/, /单据/, /附件/, /票据/], /Text/i);
      const keys = Object.values(files);
      if (fAttach && keys.length) record[fAttach.field_name] = keys.join("\n");

      if (Object.keys(record).length === 0) {
        result.warning = "财务报销表未匹配到可写字段（事项/金额/报销时间），已仅存档凭证文件";
      } else {
        const created = await createBitableRecord(token, cfg.base, cfg.tables.finance, record);
        result.recordId = created.record_id;
        await env.REGISTRY.delete("dashboard:cache:finance");
      }
    } catch (err) {
      result.warning = "凭证已存档，但写入财务报销表失败：" + (err instanceof Error ? err.message : String(err));
    }
  } else {
    result.warning = "未配置财务报销表或飞书应用，已仅存档凭证文件";
  }
  return json(result);
}
