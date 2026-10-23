/**
 * 新增机图纸评审流程 — 飞书群机器人通知
 *
 * 未配置 webhook 时静默跳过；推送失败只记日志，不阻断主流程。
 */

import { resolveFlowWebhook } from "../feishu/bot";
import { pushFeishuWebhook } from "../shared/notify-webhook";

export async function notifyFeishuGroup(env: Env, text: string): Promise<void> {
  const { url, secret } = resolveFlowWebhook(env, "drawing");
  if (!url) return;
  try {
    await pushFeishuWebhook(url, text, secret);
  } catch (err) {
    console.error("[drawing-review] webhook notify failed:", err);
  }
}
