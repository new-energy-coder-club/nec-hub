/**
 * 飞书免登（auth code 兑换用户信息）+ user_access_token 校验
 *
 * 注意：本模块用的是 app_access_token（应用自身身份，authen/v1 登录态接口用），
 * 与 feishu/bitable.ts 的 getTenantAccessToken（tenant_access_token，多维表格读写用）
 * 是两种不同 token，刻意不合并。
 */

import { createSession, sessionCookie, type HubUser } from "../shared/session";

const FEISHU_API = "https://open.feishu.cn/open-apis";

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "*";
  return {
    "access-control-allow-origin": origin,
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
  const { code } = (await request.json()) as { code?: string };
  if (!code) return jsonCors({ error: "missing code" }, 400);

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
    data?: { access_token?: string };
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

  // 5. 另签发"上次登录"提示 Cookie（非 HttpOnly，前端可读；仅姓名/头像/时间等展示信息）
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

/** 实例内 app_access_token 缓存 + in-flight 去重（同 getTenantAccessToken 的模式） */
let appTokenMem: { token: string; expireAt: number } | null = null;
let appTokenInflight: Promise<string> | null = null;

async function getAppAccessToken(env: Env): Promise<string> {
  if (appTokenMem && appTokenMem.expireAt > Date.now()) return appTokenMem.token;
  appTokenInflight ??= fetchAppAccessToken(env).finally(() => {
    appTokenInflight = null;
  });
  return appTokenInflight;
}

async function fetchAppAccessToken(env: Env): Promise<string> {
  const cached = await env.REGISTRY.get("feishu:app_access_token", "json") as
    | { token: string; expireAt: number }
    | null;
  if (cached && cached.expireAt > Date.now()) {
    appTokenMem = cached;
    return cached.token;
  }

  const resp = await fetch(`${FEISHU_API}/auth/v3/app_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const data = (await resp.json()) as { code?: number; msg?: string; app_access_token?: string; expire?: number };
  if (data.code !== 0 || !data.app_access_token) {
    throw new Error(`获取 app_access_token 失败：${data.msg ?? "unknown"}`);
  }
  const expireAt = Date.now() + ((data.expire ?? 7200) - 300) * 1000;
  appTokenMem = { token: data.app_access_token, expireAt };
  await env.REGISTRY.put("feishu:app_access_token", JSON.stringify(appTokenMem));
  return data.app_access_token;
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
