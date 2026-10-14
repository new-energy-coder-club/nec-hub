/**
 * 飞书邮箱 OpenAPI 发信通道（PRD V1.2 G-05：结论改为优先飞书邮箱并落地开发）
 *
 * 链路：构建 EML（RFC 822，HTML 正文）→ base64url → 创建草稿 → 发送草稿：
 *   POST /mail/v1/user_mailboxes/{mailbox}/drafts            { raw: <base64url EML> }
 *   POST /mail/v1/user_mailboxes/{mailbox}/drafts/{id}/send
 * 身份：user_access_token（复用 user-token.ts 的 KV 存取与临期自动刷新）。
 *
 * 启用条件（缺一即 disabled，业务不受影响，不抛错）：
 *   - MAIL_SENDER_OPEN_ID：发信人 open_id（该用户须已完成门户 OAuth 授权，KV 中有 user_token）
 *   - 收件人由调用方给出（flow 配置 mailTo 或 env MAIL_TO 兜底，逗号分隔）
 * 可选：MAIL_FROM（EML From 头，默认省略由邮箱主地址填充）、MAIL_MAILBOX（默认 "me"）。
 */

import { getUserAccessToken } from "./user-token";
import { recordNotifyFailure } from "./bot";

const FEISHU_API = "https://open.feishu.cn/open-apis";

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

/** 动态读 Env 字符串变量（与 bot.ts envSecret 同思路，避免 Env 类型硬编码） */
function envVar(env: Env, key: string): string | undefined {
  const v = (env as unknown as Record<string, string | undefined>)[key];
  return v?.trim() || undefined;
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

/** RFC 2047 encoded-word：非 ASCII 头字段（Subject）必须编码 */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${base64Utf8(value)}?=`;
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64url(text: string): string {
  return base64Utf8(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 构建最小 EML：HTML 正文 base64 传输，避免 7bit 中文问题 */
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
  const bodyB64 = base64Utf8(input.html).replace(/.{1,76}/g, "$&\r\n");
  return headers.join("\r\n") + "\r\n\r\n" + bodyB64;
}

/** 审批结果邮件模板（PRD V1.1 N-02：纯 HTML 内联样式一封） */
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

/**
 * 发送邮件（草稿两段式）。未启用返回 disabled；发送失败写 notify:failed 留痕（复用 N-01 机制），不抛错。
 */
export async function sendFeishuMail(env: Env, input: MailSendInput): Promise<MailSendResult> {
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
      body: JSON.stringify({ raw: base64url(buildEml(env, input)) }),
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
