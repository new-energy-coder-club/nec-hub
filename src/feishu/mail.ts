/**
 * 飞书邮箱发信通道（PRD 审批与通知中心 N-02 邮件通道）
 *
 * 用户身份链路：登录授权（scope 含 mail:user_mailbox.message:modify）→ refresh_token 持久化
 * （KV feishu:user_token:<open_id>）→ getUserAccessToken 自动续期 → 建草稿 + 发送。
 * 草稿 API：POST /mail/v1/user_mailboxes/me/drafts（body.raw = base64url 编码的 RFC 5822 EML，≤37.5MB）
 * 发送 API：POST /mail/v1/user_mailboxes/me/drafts/{draft_id}/send（高险写操作；发送失败草稿会保留在发件人邮箱）
 * 发件地址：优先 GET /mail/v1/user_mailboxes/me/profile → primary_email_address 写入 From；
 *   取不到（邮箱读取 scope 未授）时省略 From，服务端按 user_mailbox_id=me 补主邮箱地址。
 */

import { getUserAccessToken } from "./user-token";

const FEISHU_API = "https://open.feishu.cn/open-apis";

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

/** base64 正文按 76 字符折行（RFC 2045） */
function wrap76(b64: string): string {
  return b64.replace(/(.{1,76})/g, "$1\n").replace(/\n$/, "");
}

/** 收件人列表 → RFC 5322 地址行（首版只支持纯邮箱，不支持显示名） */
function addrLine(addrs: string[]): string {
  return addrs.map((a) => `<${a.trim()}>`).join(", ");
}

export interface BuildEmlOptions {
  from?: { address: string; name?: string };
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
}

/** 构造 RFC 5822 EML（纯文本 / HTML 二选一，html 优先）。from 缺省时不写 From 头——服务端按 user_mailbox_id=me 补主邮箱地址（lark-cli 同款行为） */
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
}

export interface SendMailResult {
  ok: boolean;
  detail: string;
}

/** 用已解析的 user_access_token 发信：profile（可选）→ 建草稿 → 发送草稿 */
export async function sendMailWithToken(userToken: string, opts: SendMailOptions): Promise<SendMailResult> {
  const address = await getUserMailboxAddress(userToken);
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

/** 团队邮件通道入口：openId 的授权 token（KV 自动续期）代发 */
export async function sendFeishuMail(env: Env, openId: string, opts: SendMailOptions): Promise<SendMailResult> {
  const token = await getUserAccessToken(env, openId);
  if (!token) {
    return { ok: false, detail: "发件账号未登录过中台或授权已过期——请其先在中台门户登录一次（scope 已含邮箱权限）" };
  }
  return sendMailWithToken(token, opts);
}