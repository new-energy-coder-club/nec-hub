/**
 * 新增机图纸评审流程 — 飞书群机器人通知（复用 FEISHU_WEBHOOK_URL）
 *
 * 未配置 webhook 时静默跳过；推送失败只记日志，不阻断主流程。
 */

import { pushFeishuWebhook } from "../validation/service";

export async function notifyFeishuGroup(env: Env, text: string): Promise<void> {
  if (!env.FEISHU_WEBHOOK_URL) return;
  try {
    await pushFeishuWebhook(env.FEISHU_WEBHOOK_URL, text);
  } catch (err) {
    console.error("[drawing-review] webhook notify failed:", err);
  }
}
