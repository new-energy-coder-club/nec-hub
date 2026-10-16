/**
 * 飞书邮箱 MCP 工具：send_mail（N-02 邮件通道）
 */

import { validateUserToken } from "../../auth/feishu-auth";
import { sendFeishuMail } from "../../feishu/mail";
import { resolveOpenIds } from "../../feishu/member-directory";
import type { McpToolDef } from "./shared";

/** send_mail：飞书邮箱发信（N-02 邮件通道）。本人传 user_token；管理端可指定 from（姓名/open_id）代发 */
export async function toolSendMail(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  // 1. 发件人身份：user_token 本人优先；否则管理端 from（姓名或 ou_ open_id）
  const userToken = String(args.user_token ?? "").trim();
  let fromOpenId = "";
  if (userToken) {
    const u = await validateUserToken(userToken);
    fromOpenId = u.openId;
  } else if (hasMcpToken) {
    const from = String(args.from ?? "").trim();
    if (!from) throw new Error("管理端发信需指定 from（队员姓名或 ou_ 开头的 open_id）");
    const { resolved, missing } = await resolveOpenIds(env, [from]);
    if (!resolved[0]) {
      throw new Error(`from 未解析：${missing.join("、")}（传 ou_ 开头的 open_id，或队员名单里的姓名）`);
    }
    fromOpenId = resolved[0].openId;
  } else {
    throw new Error("发送邮件需要 user_token（本人发信）或管理端 MCP_TOKEN（可指定 from 代发）");
  }

  // 2. 收件人与内容校验
  const asList = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
  const to = asList(args.to);
  if (!to.length) throw new Error("to 至少一个收件人邮箱");
  const cc = asList(args.cc);
  const bcc = asList(args.bcc);
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const bad = [...to, ...cc, ...bcc].find((e) => !EMAIL_RE.test(e));
  if (bad) throw new Error(`邮箱格式无效：${bad}`);
  const subject = String(args.subject ?? "").trim();
  if (!subject) throw new Error("subject 不能为空");
  const text = String(args.text ?? "").trim();
  const html = String(args.html ?? "").trim();
  if (!text && !html) throw new Error("text 与 html 至少提供一个");

  // 发件地址覆盖（send_as 别名等；仅管理端可指定，本人发信以 user_token 主邮箱为准）
  const fromAddress = String(args.from_address ?? "").trim();
  if (fromAddress && !hasMcpToken) {
    throw new Error("from_address 仅管理端可指定（本人发信请勿传该字段）");
  }
  if (fromAddress && !EMAIL_RE.test(fromAddress)) throw new Error(`邮箱格式无效：${fromAddress}`);

  // 3. 发信（建草稿 + 发送；失败不抛错，草稿可由发件人手动补发）
  const result = await sendFeishuMail(env, fromOpenId, {
    to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    subject,
    text: text || undefined,
    html: html || undefined,
    ...(fromAddress ? { fromAddress } : {}),
  });
  if (!result.ok) {
    return { content: [{ type: "text", text: `⚠️ 邮件未送达：${result.detail}` }] };
  }
  return { content: [{ type: "text", text: `✅ 邮件已发送（to=${to.join(", ")}）：${result.detail}` }] };
}

export const sendMailTool: McpToolDef = {
  name: "send_mail",
  description:
    "用飞书邮箱发信（PRD 审批与通知中心 N-02 邮件通道）。本人发信传 user_token；管理端（MCP_TOKEN）传 from（队员姓名或 ou_ 开头的 open_id，用其已绑定的授权代发，发件账号需在中台登录授权过）。text 与 html 至少一个，二者都有时用 html。发送失败时草稿保留在发件人邮箱可手动补发。",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "管理端（MCP_TOKEN）专用：发件人，队员姓名或 ou_ 开头的 open_id（姓名须在队员名单表）" },
      from_address: { type: "string", description: "可选（管理端）：显式指定发件邮箱地址（如 send_as 别名）；缺省自动取发件人主邮箱（需要邮箱读取权限）" },
      to: { type: "array", items: { type: "string" }, description: "收件人邮箱列表，至少一个" },
      cc: { type: "array", items: { type: "string" }, description: "可选：抄送邮箱列表" },
      bcc: { type: "array", items: { type: "string" }, description: "可选：密送邮箱列表" },
      subject: { type: "string", description: "邮件主题" },
      text: { type: "string", description: "纯文本正文（与 html 至少一个）" },
      html: { type: "string", description: "HTML 正文（与 text 二选一，都有时用 html）" },
      user_token: { type: "string", description: "飞书 user_access_token；本人发信必填（管理端指定 from 时忽略）" },
    },
    required: ["to", "subject"],
  },
  impl: (args, env, ctx) => toolSendMail(args, env, ctx.hasMcpToken),
};
