/**
 * R-01 报销助手 ERP 化接口（D1 存储 + R2 附件）
 *
 * 路由（均需登录）：
 *   GET  /api/erp/reimburse/meta        → 费用项目目录（D1 expense_items）+ 我的收款账户
 *   PUT  /api/erp/reimburse/payee       → 保存我的收款账户（D1 payees，按 open_id upsert）
 *   POST /api/erp/reimburse/submit      → 整单提交：SOP 校验 → 审批引擎写底表 → D1 单据快照
 *   GET  /api/erp/reimburse/docs/mine   → 我的单据列表（D1，降序 20 条）
 *   GET  /api/erp/reimburse/manage      → 报销单据台账（队长/财务，SQL 层 q 过滤/排序/分页）
 *   GET  /api/erp/reimburse/docs/<单号> → 单据详情（本人或队长/财务），供查看/复制
 *
 * 分工：审批状态以飞书底表为准（引擎写）；D1 只存 ERP 整单快照（明细行/收款/附件 key），
 * status 由审批引擎 onStatusChange 钩子回写对齐（syncReimburseDocStatus），
 * 附件二进制仍在 R2 receipts/ 前缀（/api/approvals/upload 上传）。
 */

import { canSeeFinanceDetail, ROLES, resolveUserRole } from "../auth/role";
import { ApprovalError, type ApprovalType } from "../approvals/flows";
import { submitApprovalCore } from "../approvals/engine";
import { json } from "../shared/http";
import { resolveSession } from "../shared/session";

export interface ErpLine {
  cat: string;
  item: string;
  date: string;
  invno: string;
  amount: string;
  note: string;
}

export interface ErpPayee {
  method: string;
  account_name: string;
  account_no: string;
  bank: string;
}

interface DocRow {
  application_id: string;
  open_id: string;
  applicant: string;
  payload_json: string;
  status: string;
  created_at: number;
}

function lineOf(v: unknown): ErpLine {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    cat: String(o.cat ?? "").trim(),
    item: String(o.item ?? "").trim(),
    date: String(o.date ?? "").trim(),
    invno: String(o.invno ?? "").trim(),
    amount: String(o.amount ?? "").trim(),
    note: String(o.note ?? "").trim(),
  };
}

function payeeOf(v: unknown): ErpPayee {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    method: String(o.method ?? "").trim(),
    account_name: String(o.account_name ?? "").trim(),
    account_no: String(o.account_no ?? "").trim(),
    bank: String(o.bank ?? "").trim(),
  };
}

const INVNO_RE = /^\d{8}$|^\d{20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 解析 D1 快照里的明细行（损坏/缺失时返回空数组） */
function parsePayloadLines(payloadJson: string): ErpLine[] {
  try {
    const p = JSON.parse(payloadJson) as { lines?: unknown };
    return Array.isArray(p.lines) ? (p.lines as unknown[]).map(lineOf) : [];
  } catch {
    return [];
  }
}

/** 有效明细摘要：行数 / 合计金额（2 位小数）/ 首行事项。docs/mine 与 manage 台账共用 */
function parseDocSummary(payloadJson: string): { lines: number; total: number; firstItem: string } {
  const ls = parsePayloadLines(payloadJson).filter((l) => l.cat && l.item);
  return {
    lines: ls.length,
    total: Math.round(ls.reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100) / 100,
    firstItem: ls[0]?.item ?? "",
  };
}

/** 服务端 SOP 校验（与页面同源规则）：返回错误信息数组，空 = 通过 */
export function validateErpDoc(lines: ErpLine[], noinv: string, attachmentCount: number): string[] {
  const errors: string[] = [];
  const filled = lines.filter((l) => l.cat || l.item || l.amount || l.invno || l.date);
  if (!filled.length) {
    errors.push("至少填写一行明细");
    return errors;
  }
  filled.forEach((l, i) => {
    const no = i + 1;
    if (!l.cat) errors.push(`第 ${no} 行缺费用项目`);
    if (!l.item) errors.push(`第 ${no} 行缺事项说明`);
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(l.amount) || Number(l.amount) <= 0) errors.push(`第 ${no} 行金额须为 >0 的数字（最多两位小数）`);
    if (l.invno && !INVNO_RE.test(l.invno)) errors.push(`第 ${no} 行发票号须为 8 或 20 位数字`);
    if (l.date) {
      if (!DATE_RE.test(l.date)) errors.push(`第 ${no} 行开票日期格式不正确`);
      else {
        const d = Date.parse(l.date + "T00:00:00+08:00");
        const yearStart = Date.parse(new Date().getFullYear() + "-01-01T00:00:00+08:00");
        if (d < yearStart || d > Date.now()) errors.push(`第 ${no} 行开票日期须在本赛季内且不晚于今天`);
      }
    }
  });
  // 与审批引擎 conditional 对齐：发票照片为空 → 无票说明必填
  if (attachmentCount === 0 && !noinv.trim()) errors.push("须上传发票照片附件，或填写无票说明");
  return [...new Set(errors)];
}

/** ERP 整单 → 审批引擎底表字段（事项带明细全文，金额=合计，发票号去重合并） */
export function buildApprovalFields(lines: ErpLine[], note: string, noinv: string, attachmentKeys: string[]): Record<string, unknown> {
  const filled = lines.filter((l) => l.cat && l.item && Number(l.amount) > 0);
  const total = Math.round(filled.reduce((s, l) => s + Number(l.amount), 0) * 100) / 100;
  const invnos = [...new Set(filled.map((l) => l.invno).filter(Boolean))];
  const detail = filled
    .map((l) =>
      l.item +
      `（${l.cat} ¥${Number(l.amount).toFixed(2)}` +
      (l.date ? ` · 开票 ${l.date}` : "") +
      (l.invno ? ` · 发票 ${l.invno}` : "") +
      (l.note ? ` · ${l.note}` : "") +
      "）",
    )
    .join("\n");
  const fields: Record<string, unknown> = {
    事项: detail + (note.trim() ? `\n备注：${note.trim()}` : ""),
    报销金额: total,
    发票号: invnos.join("、"),
    无票说明: noinv.trim(),
    来源: "报销助手",
  };
  if (attachmentKeys.length) fields["发票照片"] = attachmentKeys.join("\n");
  return fields;
}

export async function handleErpReimburse(
  request: Request,
  env: Env,
  pathname: string,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  if (pathname === "/api/erp/reimburse/meta" && request.method === "GET") return await handleMeta(request, env, ctx);
  if (pathname === "/api/erp/reimburse/payee" && request.method === "PUT") return await handlePutPayee(request, env, ctx);
  if (pathname === "/api/erp/reimburse/submit" && request.method === "POST") return await handleSubmit(request, env, ctx);
  if (pathname === "/api/erp/reimburse/docs/mine" && request.method === "GET") return await handleDocsMine(request, env, ctx);
  if (pathname === "/api/erp/reimburse/manage" && request.method === "GET") return await handleManage(request, env, ctx);
  const docMatch = pathname.match(/^\/api\/erp\/reimburse\/docs\/([A-Za-z0-9-]+)$/);
  if (docMatch && request.method === "GET") return await handleDocDetail(request, env, docMatch[1], ctx);
  return null;
}

/**
 * 审批状态回写 D1 快照（审批引擎 runApprovalAction 的 onStatusChange 钩子）：
 * 仅报销流，把 reimburse_docs.status 对齐到底表最新状态；D1 无此单号时静默 0 行更新。
 */
export async function syncReimburseDocStatus(
  env: Env,
  change: { type: ApprovalType; appId: string; status: string },
): Promise<void> {
  if (change.type !== "reimburse") return;
  await env.ERP_DB.prepare("UPDATE reimburse_docs SET status = ? WHERE application_id = ?")
    .bind(change.status, change.appId)
    .run();
}

/** 费用项目目录 + 我的收款账户 */
async function handleMeta(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "unauthorized" }, 401);
  const [itemsRes, payee] = await Promise.all([
    env.ERP_DB.prepare("SELECT code, grp, name FROM expense_items WHERE enabled = 1 ORDER BY code").all(),
    env.ERP_DB.prepare("SELECT method, account_name, account_no, bank FROM payees WHERE open_id = ?")
      .bind(session.user.open_id)
      .first<ErpPayee>(),
  ]);
  return json({ items: itemsRes.results ?? [], payee: payee ?? null });
}

/** 保存我的收款账户（下次自动带出） */
async function handlePutPayee(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "unauthorized" }, 401);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const p = payeeOf(body);
  if (p.account_no && !/^[\dA-Za-z -]{4,40}$/.test(p.account_no)) {
    return json({ error: "收款账号格式不正确（4-40 位数字/字母）" }, 400);
  }
  await env.ERP_DB.prepare(
    "INSERT INTO payees (open_id, method, account_name, account_no, bank, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(open_id) DO UPDATE SET method=excluded.method, account_name=excluded.account_name, account_no=excluded.account_no, bank=excluded.bank, updated_at=excluded.updated_at",
  )
    .bind(session.user.open_id, p.method, p.account_name, p.account_no, p.bank, Date.now())
    .run();
  return json({ ok: true, payee: p });
}

/** 整单提交：SOP 校验 → 审批引擎（写底表 + 群通知）→ D1 快照 */
async function handleSubmit(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "unauthorized" }, 401);
  const role = await resolveUserRole(env, session.user, ctx);
  if (role.role === "external") return json({ error: "forbidden", role: role.role }, 403);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const lines = (Array.isArray(body.lines) ? body.lines : []).map(lineOf).slice(0, 50);
  const note = String(body.note ?? "").trim();
  const noinv = String(body.noinv ?? "").trim();
  const payee = payeeOf(body.payee);
  const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
    .map((k) => String(k ?? "").trim())
    .filter((k) => /^receipts\/\d{8}\/[\w.\-一-龥]+$/.test(k))
    .slice(0, 10);

  const errors = validateErpDoc(lines, noinv, attachments.length);
  if (errors.length) return json({ error: "SOP 校验未通过", detail: errors }, 400);

  const fields = buildApprovalFields(lines, note, noinv, attachments);
  try {
    const result = await submitApprovalCore(env, { type: "reimburse", fields, user: session.user, role, source: "portal" });
    const payload = { lines, note, noinv, payee, attachments, fields };
    await env.ERP_DB.prepare(
      "INSERT INTO reimburse_docs (application_id, open_id, applicant, payload_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(result.application_id, session.user.open_id, session.user.name, JSON.stringify(payload), result.status, Date.now())
      .run();
    return json(result);
  } catch (err) {
    if (err instanceof ApprovalError) return json({ error: err.message }, err.status);
    throw err;
  }
}

/** 我的单据列表（D1 快照，含明细行数与合计金额摘要） */
async function handleDocsMine(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "unauthorized" }, 401);
  const res = await env.ERP_DB.prepare(
    "SELECT application_id, applicant, payload_json, status, created_at FROM reimburse_docs WHERE open_id = ? ORDER BY created_at DESC LIMIT 20",
  )
    .bind(session.user.open_id)
    .all<DocRow>();
  const docs = (res.results ?? []).map((r) => ({
    application_id: r.application_id,
    status: r.status,
    created_at: r.created_at,
    ...parseDocSummary(r.payload_json),
  }));
  return json({ docs });
}

/**
 * 报销单据台账（队长/财务）：SQL 层 WHERE/LIMIT/OFFSET（D1 下推），不再全表读出。
 * q 下推为 application_id / payload_json 的 LIKE 子串匹配（明细事项序列化在 payload_json 里，
 * 与原内存过滤的「编号或明细子串」语义最接近；可能额外命中备注/收款字段，属可接受的超集）。
 * 参数：page(默认1) / pageSize(默认20,上限50) / q(trim 后编号或明细子串) / sort(desc 默认|asc)。
 */
async function handleManage(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "unauthorized" }, 401);
  const role = await resolveUserRole(env, session.user, ctx);
  if (!canSeeFinanceDetail(role)) {
    return json({ error: "forbidden", hint: "仅队长/财务可查看报销单据台账" }, 403);
  }

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize")) || 20));
  const q = (url.searchParams.get("q") ?? "").trim();
  const sort = url.searchParams.get("sort") === "asc" ? "asc" : "desc";

  // LIKE 通配符转义（ESCAPE '\'），防止 q 里的 % _ 被当成通配符
  const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const where = q ? "WHERE application_id LIKE ? ESCAPE '\\' OR payload_json LIKE ? ESCAPE '\\'" : "";
  const binds: unknown[] = q ? [like, like] : [];

  const countRow = await env.ERP_DB.prepare(`SELECT COUNT(*) AS n FROM reimburse_docs ${where}`)
    .bind(...binds)
    .first<{ n: number }>();
  const total = Number(countRow?.n ?? 0);

  const res = await env.ERP_DB.prepare(
    "SELECT application_id, open_id, applicant, payload_json, status, created_at FROM reimburse_docs " +
      `${where} ORDER BY created_at ${sort === "asc" ? "ASC" : "DESC"} LIMIT ? OFFSET ?`,
  )
    .bind(...binds, pageSize, (page - 1) * pageSize)
    .all<DocRow>();

  // 每行 payload_json 只解析一次（parseDocSummary 内部单次 JSON.parse）
  const docs = (res.results ?? []).map((r) => {
    const summary = parseDocSummary(r.payload_json);
    const paidDone = r.status === "已打款" || r.status === "已完成";
    return {
      application_id: r.application_id,
      applicant: r.applicant,
      status: r.status,
      created_at: r.created_at,
      submitted_at: r.created_at,
      title: summary.firstItem || "未填事项",
      lines: summary.lines,
      total: summary.total,
      paid: paidDone ? summary.total : null,
      handler: r.status === "审批中" ? "队长/财务审核" : r.applicant,
    };
  });
  return json({ docs, total, page, pageSize });
}

/** 单据详情：本人或队长/财务可查（复制为新单 / 查看附件用） */
async function handleDocDetail(request: Request, env: Env, appId: string, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "unauthorized" }, 401);
  const row = await env.ERP_DB.prepare(
    "SELECT application_id, open_id, applicant, payload_json, status, created_at FROM reimburse_docs WHERE application_id = ?",
  )
    .bind(appId)
    .first<DocRow>();
  if (!row) return json({ error: "单据不存在" }, 404);
  if (row.open_id !== session.user.open_id) {
    const role = await resolveUserRole(env, session.user, ctx);
    if (!ROLES.FINANCE_MANAGER.test(role.role)) {
      return json({ error: "forbidden", hint: "仅本人或队长/财务可查看单据详情" }, 403);
    }
  }
  return json({
    application_id: row.application_id,
    applicant: row.applicant,
    status: row.status,
    created_at: row.created_at,
    payload: JSON.parse(row.payload_json),
  });
}
