/**
 * 飞书免登（auth code 兑换用户信息）+ user_access_token 校验
 *
 * 注意：本模块用的是 app_access_token（应用自身身份，authen/v1 登录态接口用），
 * 与 feishu/bitable.ts 的 getTenantAccessToken（tenant_access_token，多维表格读写用）
 * 是两种不同 token，刻意不合并。
 */

import { createSession, sessionCookie, type HubUser } from "../shared/session";
import { KV_KEYS } from "../shared/kv-keys";
import { FEISHU_API, cachedToken, type CachedToken } from "../feishu/client";

/** 未命中白名单时回退的固定允许源（门户主域） */
const CORS_FALLBACK_ORIGIN = "https://hub.newenergycoder.club";

/**
 * 威胁模型：登录接口会写会话 Cookie，回显任意 Origin 会让恶意站点带凭据跨域读响应，
 * 故仅放行 *.newenergycoder.club（含根域）与本地开发端口，未命中回退固定门户域。
 */
function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    if (u.protocol === "https:" && (u.hostname === "newenergycoder.club" || u.hostname.endsWith(".newenergycoder.club"))) {
      return true;
    }
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": isAllowedOrigin(origin) ? origin : CORS_FALLBACK_ORIGIN,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

/** “记住上次登录”提示 Cookie：非 HttpOnly，前端可读；仅存姓名/头像/时间等展示信息 */
const LAST_LOGIN_COOKIE = "nec_last_login";
/** 提示 Cookie 有效期 30 天；登出时不清除，用于下次打开门户显示"上次登录：某某" */
const LAST_LOGIN_TTL_SEC = 30 * 24 * 3600;

/** 展示用"上次登录"Cookie：URI 编码的 JSON（name/avatar_url/at），不含任何凭据 */
function lastLoginCookie(user: HubUser): string {
  const payload = encodeURIComponent(
    JSON.stringify({ name: user.name, avatar_url: user.avatar_url ?? "", at: new Date().toISOString() }),
  );
  return `${LAST_LOGIN_COOKIE}=${payload}; Path=/; SameSite=Lax; Secure; Max-Age=${LAST_LOGIN_TTL_SEC}`;
}

export async function handleFeishuAuth(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request);
  const jsonCors = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", ...cors },
    });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return jsonCors({ error: "method not allowed" }, 405);
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    return jsonCors(
      { error: "飞书自建应用未配置：请先 wrangler secret put FEISHU_APP_ID / FEISHU_APP_SECRET" },
      500,
    );
  }
  let body: { code?: string; state?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonCors({ error: "请求体必须是 JSON" }, 400);
  }
  const { code, state } = body;
  if (!code) return jsonCors({ error: "missing code" }, 400);

  // 服务端签发的 state（"我的任务"重新授权等场景，oauth:state:<state>，TTL 10 分钟）一次性消费：
  // 比对不上视为伪造/过期，直接 400。门户自身登录的 state 由前端 sessionStorage 校验，不带到这里
  if (state) {
    const stateKey = KV_KEYS.oauthState(state);
    const stored = await env.REGISTRY.get(stateKey);
    if (!stored) return jsonCors({ error: "state 校验失败或已过期，请重新发起授权" }, 400);
    await env.REGISTRY.delete(stateKey);
  }

  // 1. app_access_token（KV 缓存，提前 5 分钟过期）
  const appToken = await getAppAccessToken(env);

  // 2. code → user_access_token
  const tokenResp = await fetch(`${FEISHU_API}/authen/v1/oidc/access_token`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${appToken}`,
    },
    body: JSON.stringify({ grant_type: "authorization_code", code }),
  });
  const tokenData = (await tokenResp.json()) as {
    code?: number;
    msg?: string;
    data?: {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_expires_in?: number;
    };
  };
  const userToken = tokenData.data?.access_token;
  if (tokenData.code !== 0 || !userToken) {
    return jsonCors({ error: `飞书 code 兑换失败：${tokenData.msg ?? "unknown"}（code 可能已过期，请重新登录）` }, 401);
  }

  // 3. 取用户信息
  const userResp = await fetch(`${FEISHU_API}/authen/v1/user_info`, {
    headers: { authorization: `Bearer ${userToken}` },
  });
  const userData = (await userResp.json()) as {
    code?: number;
    msg?: string;
    data?: { name?: string; en_name?: string; open_id?: string; avatar_url?: string };
  };
  if (userData.code !== 0 || !userData.data) {
    return jsonCors({ error: `获取用户信息失败：${userData.msg ?? "unknown"}` }, 502);
  }

  const user: HubUser = {
    name: userData.data.name ?? "",
    open_id: userData.data.open_id ?? "",
    avatar_url: userData.data.avatar_url,
  };
  // 4. 签发中台会话（HttpOnly Cookie；MES 跨域调用不会带上，本门户同源登录生效）
  const sid = await createSession(env, user);

  // 5. 持久化用户授权（feishu:user_token:<open_id>），供"我的任务"等模块代用户调飞书 API
  await saveUserToken(env, user.open_id, tokenData.data);

  // 6. 另签发"上次登录"提示 Cookie（非 HttpOnly，前端可读；仅姓名/头像/时间等展示信息）
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", ...cors });
  headers.append("set-cookie", sessionCookie(sid));
  headers.append("set-cookie", lastLoginCookie(user));

  return new Response(
    JSON.stringify({
      name: user.name,
      en_name: userData.data.en_name,
      open_id: user.open_id,
      avatar_url: user.avatar_url,
      session: true,
    }),
    { headers },
  );
}

/** 登录换到的 user_access_token + refresh_token 持久化（KV TTL 跟 refresh_token 寿命走，到期自动清理） */
async function saveUserToken(
  env: Env,
  openId: string,
  d?: { access_token?: string; refresh_token?: string; expires_in?: number; refresh_expires_in?: number },
): Promise<void> {
  if (!openId || !d?.access_token || !d.refresh_token) return; // 无 refresh_token 无法续期，不绑定
  const now = Date.now();
  const refreshExpiresAt = now + (d.refresh_expires_in ?? 30 * 24 * 3600) * 1000;
  await env.REGISTRY.put(
    KV_KEYS.feishuUserToken(openId),
    JSON.stringify({
      user_access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: now + (d.expires_in ?? 7200) * 1000,
      refresh_expires_at: refreshExpiresAt,
    }),
    { expirationTtl: Math.max(60, Math.floor((refreshExpiresAt - now) / 1000)) },
  );
}

/** 供 feishu/user-token.ts 续期 refresh 时复用 */
export async function getAppAccessToken(env: Env): Promise<string> {
  return cachedToken(env, KV_KEYS.feishuAppAccessToken, fetchAppAccessToken);
}

async function fetchAppAccessToken(env: Env): Promise<CachedToken> {
  const resp = await fetch(`${FEISHU_API}/auth/v3/app_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const data = (await resp.json()) as { code?: number; msg?: string; app_access_token?: string; expire?: number };
  if (data.code !== 0 || !data.app_access_token) {
    throw new Error(`获取 app_access_token 失败：${data.msg ?? "unknown"}`);
  }
  return { token: data.app_access_token, expireAt: Date.now() + ((data.expire ?? 7200) - 300) * 1000 };
}

/** 校验飞书 user_access_token，返回 open_id 与姓名（无效则抛错） */
export async function validateUserToken(userToken: string): Promise<{ openId: string; name: string }> {
  const resp = await fetch(`${FEISHU_API}/authen/v1/user_info`, {
    headers: { authorization: `Bearer ${userToken}` },
  });
  const data = (await resp.json()) as { code?: number; msg?: string; data?: { open_id?: string; name?: string } };
  if (data.code !== 0 || !data.data?.open_id) {
    throw new Error(`user_token 校验失败：${data.msg ?? "invalid token"}`);
  }
  return { openId: data.data.open_id, name: data.data.name ?? "" };
}
