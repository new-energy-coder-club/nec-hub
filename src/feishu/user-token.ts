/**
 * 飞书用户级 token 存取（"我的任务"等代用户调飞书 API 的模块共用）
 *
 * 与 bitable.ts 的 tenant_access_token（应用身份）不同：这里存的是每个登录用户
 * OAuth 授权换来的 user_access_token + refresh_token（KV key：feishu:user_token:<open_id>）。
 */

import { getAppAccessToken } from "../auth/feishu-auth";
import { FEISHU_API } from "./client";

/** user_access_token 临期阈值：剩余不足 5 分钟就走 refresh 续期 */
const REFRESH_AHEAD_MS = 5 * 60 * 1000;

export interface FeishuUserToken {
  user_access_token: string;
  refresh_token: string;
  /** user_access_token 过期时间（epoch ms） */
  expires_at: number;
  /** refresh_token 过期时间（epoch ms），过期即视为解绑 */
  refresh_expires_at: number;
}

export function userTokenKey(openId: string): string {
  return `feishu:user_token:${openId}`;
}

/** 读取用户 user_access_token；临期自动 refresh 并回写 KV；refresh 也失效返回 null（视为未绑定） */
export async function getUserAccessToken(env: Env, openId: string): Promise<string | null> {
  const rec = (await env.REGISTRY.get(userTokenKey(openId), "json")) as FeishuUserToken | null;
  if (!rec?.refresh_token) return null;
  const now = Date.now();
  if (rec.expires_at - REFRESH_AHEAD_MS > now) return rec.user_access_token;
  if (rec.refresh_expires_at <= now) {
    await clearUserToken(env, openId);
    return null;
  }

  const appToken = await getAppAccessToken(env);
  const resp = await fetch(`${FEISHU_API}/authen/v1/oidc/refresh_access_token`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${appToken}`,
    },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: rec.refresh_token }),
  });
  const data = (await resp.json()) as {
    code?: number;
    msg?: string;
    data?: { access_token?: string; refresh_token?: string; expires_in?: number; refresh_expires_in?: number };
  };
  if (data.code !== 0 || !data.data?.access_token || !data.data.refresh_token) {
    // refresh 失败（多为 refresh_token 已失效）：清除绑定，前端引导重新授权
    await clearUserToken(env, openId);
    return null;
  }
  const next: FeishuUserToken = {
    user_access_token: data.data.access_token,
    refresh_token: data.data.refresh_token,
    expires_at: now + (data.data.expires_in ?? 7200) * 1000,
    refresh_expires_at: now + (data.data.refresh_expires_in ?? 30 * 24 * 3600) * 1000,
  };
  await env.REGISTRY.put(userTokenKey(openId), JSON.stringify(next), {
    expirationTtl: Math.max(60, Math.floor((next.refresh_expires_at - now) / 1000)),
  });
  return next.user_access_token;
}

/** 解绑：删除用户授权 token */
export async function clearUserToken(env: Env, openId: string): Promise<void> {
  await env.REGISTRY.delete(userTokenKey(openId));
}
