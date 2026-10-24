/**
 * 飞书群自定义机器人 webhook（共享层）
 *
 * 加签算法（对齐官方示例）：把 `${timestamp}\n${secret}` 作为 HMAC-SHA256 密钥，对空内容签名，Base64 输出。
 * 消息体协议：bot/v2/hook 要求 `msg_type` 字段，text 嵌套在 `content` 里。
 *
 * 接口：
 *   - sendFeishuBotText(webhook, text, secret?) — 低层单次发送，失败抛错（FE-05 校验推送、图纸评审通知用）
 *   - resolveFlowWebhook(env, flow) — 流程专属 webhook 优先，回退 BOT 主群与旧版 FEISHU_WEBHOOK_URL 主群
 *   - notifyFeishu(env, flow, title, content, link?) — 使用统一映射发送，失败重试 2 次（1s、4s）并留痕 KV notify:failed；
 *     未配置 webhook 时降级返回不抛错（审批引擎/GitHub webhook/PRD 状态变更用）
 */

import { KV_KEYS } from "../shared/kv-keys";
import { envSecret } from "./client";

/** 飞书加签：HMAC-SHA256(`${timestamp}\n${secret}`) → Base64 */
export async function feishuBotSign(secret: string, timestamp: number): Promise<string> {
  // 飞书官方算法：把 `${timestamp}\n${secret}` 作为 HMAC 密钥，对空内容签名（官方 Python 示例即 hmac.new(string_to_sign, digestmod=sha256)）
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${timestamp}\n${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new Uint8Array(0));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/** 发送 text 消息到群机器人 webhook；配置 secret 时带加签；失败（code!==0）抛错 */
export async function sendFeishuBotText(webhookUrl: string, text: string, secret?: string): Promise<void> {
  const body: Record<string, unknown> = { msg_type: "text", content: { text } };
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    body.timestamp = timestamp;
    body.sign = await feishuBotSign(secret, timestamp);
  }
  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await resp.json()) as { code?: number; msg?: string };
  if (data.code !== 0) throw new Error(`飞书群机器人推送失败：${data.msg ?? `code ${data.code}`}`);
}

/** 通知失败记录（KV notify:failed，7 天 TTL，截断 100 条，管理端可查） */
export async function recordNotifyFailure(env: Env, flow: string, title: string, detail: string): Promise<void> {
  try {
    const raw = await env.REGISTRY.get(KV_KEYS.notifyFailed);
    let list: Array<{ flow: string; title: string; detail: string; at: string }> = [];
    try {
      list = raw ? (JSON.parse(raw) as typeof list) : [];
    } catch {
      list = [];
    }
    list.unshift({ flow, title, detail, at: new Date().toISOString() });
    await env.REGISTRY.put(KV_KEYS.notifyFailed, JSON.stringify(list.slice(0, 100)), { expirationTtl: 7 * 24 * 3600 });
  } catch {
    /* 记录失败不阻断主流程 */
  }
}

export interface FlowWebhook {
  url?: string;
  secret?: string;
}

/** 按流程解析 webhook：流程专属配置优先，其后依次回退 BOT 主群与旧版主群。
 *  命名规则：FEISHU_BOT_WEBHOOK_<FLOW 大写>（drawing_review → FEISHU_BOT_WEBHOOK_DRAWING_REVIEW，
 *  hardware_review → FEISHU_BOT_WEBHOOK_HARDWARE_REVIEW，contract → FEISHU_BOT_WEBHOOK_CONTRACT）。 */
export function resolveFlowWebhook(env: Env, flow: string): FlowWebhook {
  const flowKey = flow.toUpperCase();
  const flowUrl = envSecret(env, `FEISHU_BOT_WEBHOOK_${flowKey}`);
  const flowSecret = envSecret(env, `FEISHU_BOT_WEBHOOK_${flowKey}_SECRET`);
  if (flowUrl !== undefined) {
    return { url: flowUrl, secret: flowSecret ?? env.FEISHU_BOT_WEBHOOK_SECRET };
  }
  if (env.FEISHU_BOT_WEBHOOK !== undefined) {
    return { url: env.FEISHU_BOT_WEBHOOK, secret: env.FEISHU_BOT_WEBHOOK_SECRET };
  }
  return { url: env.FEISHU_WEBHOOK_URL, secret: env.FEISHU_WEBHOOK_SECRET };
}

/**
 * 飞书群机器人 webhook 通知（PRD V1.1 N-01）。
 * 失败（网络异常/code!==0）重试 2 次（1s、4s），仍失败写 KV notify:failed；调用方不抛错。
 */
export async function notifyFeishu(env: Env, flow: string, title: string, content: string, link?: string): Promise<{ ok: boolean; detail: string }> {
  const { url, secret } = resolveFlowWebhook(env, flow);
  if (!url) return { ok: false, detail: "未配置 webhook" };
  const text = title + "\n" + content + (link ? "\n去处理：" + link : "");
  let attempt = 0;
  let lastErr = "";
  while (attempt < 3) {
    attempt++;
    try {
      await sendFeishuBotText(url, text, secret);
      return { ok: true, detail: "ok" };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt === 1 ? 1000 : 4000));
  }
  await recordNotifyFailure(env, flow, title, lastErr);
  return { ok: false, detail: `发送失败（重试 2 次）：${lastErr}` };
}
