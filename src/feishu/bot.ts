/**
 * 飞书群自定义机器人 webhook（共享层）
 *
 * 加签算法（对齐官方示例）：把 `${timestamp}\n${secret}` 作为 HMAC-SHA256 密钥，对空内容签名，Base64 输出。
 * 消息体协议：bot/v2/hook 要求 `msg_type` 字段，text 嵌套在 `content` 里。
 *
 * 两层接口：
 *   - sendFeishuBotText(webhook, text, secret?) — 低层单次发送，失败抛错（FE-05 校验推送、图纸评审通知用）
 *   - notifyFeishu(env, flow, title, content, link?) — 按流程分流 webhook（FEISHU_BOT_WEBHOOK_<FLOW> ?? FEISHU_BOT_WEBHOOK），
 *     失败重试 2 次（1s、4s）并留痕 KV notify:failed；未配置 webhook 时降级返回不抛错（审批引擎/GitHub webhook/PRD 状态变更用）
 */

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

/** 动态读 Env 字符串变量（webhook 按流程名拼接变量名用） */
function envSecret(env: Env, key: string): string | undefined {
  return (env as unknown as Record<string, string | undefined>)[key];
}

/** 通知失败记录（KV notify:failed，7 天 TTL，截断 100 条，管理端可查） */
export async function recordNotifyFailure(env: Env, flow: string, title: string, detail: string): Promise<void> {
  try {
    const raw = await env.REGISTRY.get("notify:failed");
    let list: Array<{ flow: string; title: string; detail: string; at: string }> = [];
    try {
      list = raw ? (JSON.parse(raw) as typeof list) : [];
    } catch {
      list = [];
    }
    list.unshift({ flow, title, detail, at: new Date().toISOString() });
    await env.REGISTRY.put("notify:failed", JSON.stringify(list.slice(0, 100)), { expirationTtl: 7 * 24 * 3600 });
  } catch {
    /* 记录失败不阻断主流程 */
  }
}

/**
 * 飞书群机器人 webhook 通知（PRD V1.1 N-01）。
 * webhook 选择：FEISHU_BOT_WEBHOOK_<FLOW> ?? FEISHU_BOT_WEBHOOK；secret 同名 _SECRET 后缀。
 * 失败（网络异常/code!==0）重试 2 次（1s、4s），仍失败写 KV notify:failed；调用方不抛错。
 */
export async function notifyFeishu(env: Env, flow: string, title: string, content: string, link?: string): Promise<{ ok: boolean; detail: string }> {
  const flowKey = flow.toUpperCase();
  const webhook = envSecret(env, `FEISHU_BOT_WEBHOOK_${flowKey}`) ?? env.FEISHU_BOT_WEBHOOK;
  if (!webhook) return { ok: false, detail: "未配置 webhook" };
  const secret = envSecret(env, `FEISHU_BOT_WEBHOOK_${flowKey}_SECRET`) ?? env.FEISHU_BOT_WEBHOOK_SECRET;
  const text = title + "\n" + content + (link ? "\n去处理：" + link : "");
  let attempt = 0;
  let lastErr = "";
  while (attempt < 3) {
    attempt++;
    try {
      await sendFeishuBotText(webhook, text, secret);
      return { ok: true, detail: "ok" };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt === 1 ? 1000 : 4000));
  }
  await recordNotifyFailure(env, flow, title, lastErr);
  return { ok: false, detail: `发送失败（重试 2 次）：${lastErr}` };
}
