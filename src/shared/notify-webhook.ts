import { sendFeishuBotText } from "../feishu/bot";

/** 推送飞书群自定义机器人（text 消息）；未配置 webhook 时调用方应跳过。 */
export async function pushFeishuWebhook(webhookUrl: string, text: string, secret?: string): Promise<void> {
  await sendFeishuBotText(webhookUrl, text, secret);
}
