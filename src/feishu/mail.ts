/**
 * 飞书邮箱发信通道（PRD 审批与通知中心 N-02 邮件通道 / PRD V1.2 G-05：结论改为优先飞书邮箱并落地开发）
 *
 * 同一入口兼容两种调用形态：
 *  - 指定发信人：sendFeishuMail(env, openId, opts)（MCP send-mail 等工具），用该用户 OAuth
 *    user_access_token（KV feishu:user_token:<open_id>，getUserAccessToken 临期自动续期）代发，mailbox 固定 me。
 *  - 团队通道：sendFeishuMail(env, input)（notify / approvals 调用），发信人取 MAIL_SENDER_OPEN_ID
 *    （该用户须已完成门户 OAuth 授权），收件人由调用方给出（flow 配置 mailTo 或 env MAIL_TO 兜底，
 *    defaultMailRecipients 逗号/分号解析）。启用条件缺失即返回 disabled，业务不受影响、不抛错。
 *
 * 草稿两段式：
 *   POST /mail/v1/user_mailboxes/{mailbox}/drafts          { raw: <base64url EML> }
 *   POST /mail/v1/user_mailboxes/{mailbox}/drafts/{id}/send
 *
 * EML（RFC 5322）：中文主题/显示名走 RFC 2047 encoded-word；HTML 正文 base64 传输并按 76 列折行。
 * 发件地址：指定发信人形态优先 GET /mail/v1/user_mailboxes/me/profile → primary_email_address 写入 From，
 *   取不到（邮箱读取 scope 未授）时省略 From，服务端按 user_mailbox_id=me 补主邮箱地址；
 *   团队形态可选 MAIL_FROM（EML From 头，默认省略由邮箱主地址填充）、MAIL_MAILBOX（默认 "me"）。
 * 发送失败草稿保留在发件人邮箱可手动补发；团队形态失败写 notify:failed 留痕（复用 N-01 机制），不抛错。
 */

import { getUserAccessToken } from "./user-token";
import { recordNotifyFailure } from "./bot";
import { FEISHU_API, envVar } from "./client";

export interface MailSendInput {
  to: string[];
  subject: string;
  /** HTML 正文（内联样式，邮件客户端兼容） */
  html: string;
}

export interface MailSendResult {
  ok: boolean;
  detail: string;
  /** true = 通道未配置（区别于发送失败），调用方可静默跳过 */
  disabled?: boolean;
}

/** 邮件通道是否启用：只需发信人 open_id（收件人由调用方决定） */
export function mailChannelEnabled(env: Env): boolean {
  return !!envVar(env, "MAIL_SENDER_OPEN_ID");
}

/** 默认收件人：env MAIL_TO，逗号/分号分隔 */
export function defaultMailRecipients(env: Env): string[] {
  return (envVar(env, "MAIL_TO") ?? "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------- 编码工具 ----------

/** UTF-8 → 标准 Base64 */
export function utf8ToB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** 标准 Base64 → base64url（raw 字段用） */
export function toBase64Url(s: string): string {
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 2047 encoded-word（Subject / 显示名等含非 ASCII 的邮件头） */
export function encodeHeaderWord(s: string): string {
  return `=?UTF-8?B?${utf8ToB64(s)}?=`;
}

/** RFC 2047 encoded-word：非 ASCII 头字段（Subject）必须编码，ASCII 保持原样 */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return encodeHeaderWord(value);
}

/** base64 正文按 76 字符折行（RFC 2045，plain 版） */
function wrap76(b64: string): string {
  return b64.replace(/(.{1,76})/g, "$1\n").replace(/\n$/, "");
}

/** 收件人列表 → RFC 5322 地址行（只支持纯邮箱，不支持显示名） */
function addrLine(addrs: string[]): string {
  return addrs.map((a) => `<${a.trim()}>`).join(", ");
}

// ---------- EML 构建 ----------

export interface BuildEmlOptions {
  from?: { address: string; name?: string };
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
}

/** 构造 RFC 5322 EML（纯文本 / HTML 二选一，html 优先）。from 缺省时不写 From 头——服务端按 user_mailbox_id=me 补主邮箱地址（lark-cli 同款行为） */
export function buildPlainEml(opts: BuildEmlOptions): string {
  const isHtml = Boolean(opts.html);
  const body = isHtml ? (opts.html ?? "") : (opts.text ?? "");
  const fromLine = opts.from
    ? `From: ${opts.from.name ? `${encodeHeaderWord(opts.from.name)} <${opts.from.address}>` : `<${opts.from.address}>`}`
    : "";
  return [
    ...(fromLine ? [fromLine] : []),
    `To: ${addrLine(opts.to)}`,
    ...(opts.cc?.length ? [`Cc: ${addrLine(opts.cc)}`] : []),
    ...(opts.bcc?.length ? [`Bcc: ${addrLine(opts.bcc)}`] : []),
    `Subject: ${encodeHeaderWord(opts.subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: ${isHtml ? "text/html" : "text/plain"}; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    "",
    wrap76(utf8ToB64(body)),
  ].join("\r\n");
}

/** 构建最小 EML（团队通道用）：HTML 正文 base64 传输，避免 7bit 中文问题 */
export function buildEml(env: Env, input: MailSendInput): string {
  const headers = [
    `Date: ${new Date().toUTCString()}`,
    `To: ${input.to.join(", ")}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const from = envVar(env, "MAIL_FROM");
  if (from) headers.unshift(`From: ${from}`);
  // base64 正文按 76 列折行（RFC 2045）
  const bodyB64 = utf8ToB64(input.html).replace(/.{1,76}/g, "$&\r\n");
  return headers.join("\r\n") + "\r\n\r\n" + bodyB64;
}

/** 审批结果邮件模板（纯 HTML 内联样式一封） */
export function approvalResultMailHtml(fields: {
  title: string;
  applicant?: string;
  typeLabel?: string;
  summary?: string;
  link?: string;
}): string {
  const rows: Array<[string, string]> = [];
  if (fields.applicant) rows.push(["申请人", fields.applicant]);
  if (fields.typeLabel) rows.push(["类型", fields.typeLabel]);
  const kvRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px;color:#666;border-bottom:1px solid #eee;">${k}</td>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #eee;">${v}</td></tr>`,
    )
    .join("");
  const summary = fields.summary
    ? `<p style="margin:12px 0;color:#333;white-space:pre-line;">${fields.summary}</p>`
    : "";
  const link = fields.link
    ? `<p style="margin:16px 0;"><a href="${fields.link}" style="display:inline-block;padding:8px 20px;background:#3370ff;color:#fff;text-decoration:none;border-radius:6px;">查看详情</a></p>`
    : "";
  return (
    `<div style="max-width:560px;font-family:system-ui,sans-serif;font-size:14px;">` +
    `<h3 style="margin:0 0 12px;">${fields.title}</h3>` +
    (kvRows ? `<table style="border-collapse:collapse;">${kvRows}</table>` : "") +
    summary +
    link +
    `<p style="margin-top:20px;color:#999;font-size:12px;">本邮件由 NEC 团队 AI 中台自动发出，请勿直接回复。</p>` +
    `</div>`
  );
}

// ---------- 发送 ----------

/** 发件 user token → 主邮箱地址；未获批邮箱权限/接口异常返回 null */
export async function getUserMailboxAddress(userToken: string): Promise<string | null> {
  try {
    const resp = await fetch(`${FEISHU_API}/mail/v1/user_mailboxes/me/profile`, {
      headers: { authorization: `Bearer ${userToken}` },
    });
    const data = (await resp.json()) as { code?: number; msg?: string; data?: { primary_email_address?: string } };
    if (data.code !== 0) return null;
    return data.data?.primary_email_address || null;
  } catch {
    return null;
  }
}

export interface SendMailOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  /** 管理端显式指定发件地址（send_as 别名等）；缺省自动取 user profile 主邮箱 */
  fromAddress?: string;
}

export interface SendMailResult {
  ok: boolean;
  detail: string;
}

/** 用已解析的 user_access_token 发信：profile（可选）→ 建草稿 → 发送草稿 */
export async function sendMailWithToken(userToken: string, opts: SendMailOptions): Promise<SendMailResult> {
  const address = opts.fromAddress ?? (await getUserMailboxAddress(userToken));
  const eml = buildPlainEml({
    ...(address ? { from: { address } } : {}), // profile 拿不到地址（邮箱读取 scope 未授）时省略 From，服务端按 me 补主地址
    to: opts.to,
    cc: opts.cc,
    bcc: opts.bcc,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });

  // 1. 建草稿（用户身份 user_mailbox_id = me）
  const draftResp = await fetch(`${FEISHU_API}/mail/v1/user_mailboxes/me/drafts`, {
    method: "POST",
    headers: { authorization: `Bearer ${userToken}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ raw: toBase64Url(utf8ToB64(eml)) }),
  });
  const draftData = (await draftResp.json()) as { code?: number; msg?: string; data?: { draft?: { id?: string } } };
  const draftId = draftData.data?.draft?.id;
  if (draftData.code !== 0 || !draftId) {
    return { ok: false, detail: `草稿创建失败：${draftData.msg ?? `code ${draftData.code}`}` };
  }

  // 2. 发送草稿；发送失败草稿保留在发件人飞书邮箱，可手动补发
  const sendResp = await fetch(`${FEISHU_API}/mail/v1/user_mailboxes/me/drafts/${draftId}/send`, {
    method: "POST",
    headers: { authorization: `Bearer ${userToken}`, "content-type": "application/json; charset=utf-8" },
    body: "{}",
  });
  const sendData = (await sendResp.json()) as { code?: number; msg?: string };
  if (sendData.code !== 0) {
    return { ok: false, detail: `发送失败（草稿 ${draftId} 已保留在发件人邮箱可手动补发）：${sendData.msg ?? `code ${sendData.code}`}` };
  }
  return { ok: true, detail: `已发送（draft ${draftId}）` };
}

/**
 * 团队邮件通道入口（两种形态统一收口）：
 *  - sendFeishuMail(env, openId, opts)：指定发信人 openId 代发（授权 token 自动续期、mailbox 固定 me）；
 *  - sendFeishuMail(env, input)：自动发信（发信人取 MAIL_SENDER_OPEN_ID），未配置/无收件人/发信人未授权
 *    返回 disabled（调用方静默跳过）；发送失败写 notify:failed 留痕（复用 N-01 机制），不抛错。
 */
export async function sendFeishuMail(
  env: Env,
  openIdOrInput: string | MailSendInput,
  opts?: SendMailOptions,
): Promise<MailSendResult> {
  if (typeof openIdOrInput === "string") {
    if (!opts) return { ok: false, detail: "缺少发信参数（to/subject 等）" };
    const token = await getUserAccessToken(env, openIdOrInput);
    if (!token) {
      return { ok: false, detail: "发件账号未登录过中台或授权已过期——请其先在中台门户登录，并在「我的任务」完成一次授权（含邮箱权限）" };
    }
    return sendMailWithToken(token, opts);
  }

  const input = openIdOrInput;
  const senderOpenId = envVar(env, "MAIL_SENDER_OPEN_ID");
  if (!senderOpenId) return { ok: false, disabled: true, detail: "邮件通道未启用（未配置 MAIL_SENDER_OPEN_ID）" };
  if (!input.to.length) return { ok: false, disabled: true, detail: "邮件通道未启用（无收件人）" };

  const token = await getUserAccessToken(env, senderOpenId);
  if (!token) {
    return { ok: false, disabled: true, detail: "邮件通道未启用（发信人未完成 OAuth 授权或授权已失效）" };
  }

  const mailbox = envVar(env, "MAIL_MAILBOX") ?? "me";
  const authHeaders = { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${token}` };
  try {
    const draftResp = await fetch(`${FEISHU_API}/mail/v1/user_mailboxes/${encodeURIComponent(mailbox)}/drafts`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ raw: toBase64Url(utf8ToB64(buildEml(env, input))) }),
    });
    const draftData = (await draftResp.json()) as {
      code?: number;
      msg?: string;
      data?: { draft_id?: string; draft?: { id?: string } };
    };
    // 飞书草稿接口实际返回 data.draft.id（早期按文档猜的 data.draft_id 是错的，验收实测纠正）
    const draftId = draftData.data?.draft_id ?? draftData.data?.draft?.id;
    if (draftData.code !== 0 || !draftId) {
      throw new Error(`创建草稿失败：${draftData.msg ?? `code ${draftData.code}`}`);
    }

    const sendResp = await fetch(
      `${FEISHU_API}/mail/v1/user_mailboxes/${encodeURIComponent(mailbox)}/drafts/${encodeURIComponent(draftId)}/send`,
      { method: "POST", headers: authHeaders, body: "{}" },
    );
    const sendData = (await sendResp.json()) as { code?: number; msg?: string; data?: { message_id?: string } };
    if (sendData.code !== 0) {
      throw new Error(`发送草稿失败：${sendData.msg ?? `code ${sendData.code}`}`);
    }
    return { ok: true, detail: `ok（message_id=${sendData.data?.message_id ?? "unknown"}）` };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await recordNotifyFailure(env, "mail", input.subject, reason);
    return { ok: false, detail: `发送失败：${reason}` };
  }
}