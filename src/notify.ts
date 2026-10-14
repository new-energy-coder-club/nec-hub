/**
 * 通知通道调度层（PRD V1.2 §7.2：在 notifyFeishu 之上抽象 NotifyChannel）
 *
 * 通道：feishu_bot（主通道，群机器人 webhook）+ email（飞书邮箱 OpenAPI，降级/增强通道）。
 * 通道选择：群机器人始终发送；邮件按流程 flows:config 的 mailTo 配置决定是否发送
 * （未配置 mailTo 时 fallback env MAIL_TO），通道未启用（缺 MAIL_SENDER_OPEN_ID /
 * 发信人未授权）时静默跳过，不影响主通道。
 */

import { notifyFeishu } from "./feishu/bot";
import { approvalResultMailHtml, defaultMailRecipients, sendFeishuMail } from "./feishu/mail";
import { getFlowsConfig } from "./approvals/flows";
import type { ApprovalType } from "./approvals/flows";

export type NotifyChannel = "feishu_bot" | "email";

export interface NotifyResult {
  bot: { ok: boolean; detail: string };
  mail?: { ok: boolean; detail: string; disabled?: boolean };
}

/** 审批结果通知：群机器人 + 邮件（若该流程配置了收件人） */
export async function notifyApprovalResult(
  env: Env,
  type: ApprovalType,
  title: string,
  content: string,
  link: string | undefined,
  opts: { applicant?: string; typeLabel?: string } = {},
): Promise<NotifyResult> {
  const bot = await notifyFeishu(env, type, title, content, link);

  const cfg = await getFlowsConfig(env);
  const mailTo = cfg[type]?.mailTo?.length ? cfg[type].mailTo : defaultMailRecipients(env);
  if (!mailTo.length) return { bot };

  const mail = await sendFeishuMail(env, {
    to: mailTo,
    subject: title,
    html: approvalResultMailHtml({ title, applicant: opts.applicant, typeLabel: opts.typeLabel, summary: content, link }),
  });
  return { bot, mail };
}
