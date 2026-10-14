/**
 * 门户会话（nec_session Cookie）— index.ts 与各 /api 子模块共用
 *
 * 7 天有效期，剩余不足一半时**同 sid 原地滑动续期**（不轮换 sid，旧 Cookie 继续有效；
 * 轮换方案会导致续期发生在未回写 Cookie 的接口时把用户踢下线）。renewed 字段保留以兼容
 * 现有调用方，但恒为 undefined，applyRenewedSession 自然空转。
 */

export const SESSION_COOKIE = "nec_session";
/** 会话有效期 7 天；剩余不足一半时同 sid 原地滑动续期（不轮换，旧 Cookie 不失效） */
export const SESSION_TTL_SEC = 7 * 24 * 3600;

export interface HubUser {
  name: string;
  open_id: string;
  avatar_url?: string;
}

export interface SessionData extends HubUser {
  createdAt: string;
  expiresAt: number;
}

export function parseCookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(sid: string, maxAge = SESSION_TTL_SEC): string {
  return `${SESSION_COOKIE}=${sid}; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}

export async function createSession(env: Env, user: HubUser): Promise<string> {
  const sid = crypto.randomUUID();
  const data: SessionData = {
    ...user,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + SESSION_TTL_SEC * 1000,
  };
  await env.REGISTRY.put(`session:${sid}`, JSON.stringify(data), { expirationTtl: SESSION_TTL_SEC });
  return sid;
}

/** 解析会话；剩余有效期不足一半时同 sid 原地滑动续期（Cookie 无需回写，renewed 恒空） */
export async function resolveSession(
  env: Env,
  request: Request,
  ctx?: ExecutionContext,
): Promise<{ user: HubUser; renewed?: string } | null> {
  const sid = parseCookies(request)[SESSION_COOKIE];
  if (!sid) return null;
  const raw = await env.REGISTRY.get(`session:${sid}`);
  if (!raw) return null;
  let data: SessionData;
  try {
    data = JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
  if (!data.open_id || data.expiresAt <= Date.now()) {
    await env.REGISTRY.delete(`session:${sid}`);
    return null;
  }
  const user: HubUser = { name: data.name, open_id: data.open_id, avatar_url: data.avatar_url };
  if (data.expiresAt - Date.now() < (SESSION_TTL_SEC * 1000) / 2) {
    const write = env.REGISTRY.put(
      `session:${sid}`,
      JSON.stringify({ ...data, expiresAt: Date.now() + SESSION_TTL_SEC * 1000 }),
      { expirationTtl: SESSION_TTL_SEC },
    );
    if (ctx) ctx.waitUntil(write);
    else await write;
  }
  return { user };
}

/** 滑动续期时把新 sid 写回响应 Cookie（子模块路由在出口统一调用） */
export function applyRenewedSession<T extends Response | null>(res: T, renewed?: string): T {
  if (res && renewed) res.headers.set("set-cookie", sessionCookie(renewed));
  return res;
}

export async function destroySession(env: Env, request: Request, ctx?: ExecutionContext): Promise<void> {
  const sid = parseCookies(request)[SESSION_COOKIE];
  if (!sid) return;
  const del = env.REGISTRY.delete(`session:${sid}`);
  if (ctx) ctx.waitUntil(del);
  else await del;
}
