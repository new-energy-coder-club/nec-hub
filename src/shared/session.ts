/**
 * 门户会话（nec_session Cookie）— index.ts 与各 /api 子模块共用
 *
 * 7 天有效期，剩余不足一半时**同 sid 原地滑动续期**（不轮换 sid，旧 Cookie 继续有效；
 * 轮换方案会导致续期发生在未回写 Cookie 的接口时把用户踢下线）。
 */

import { KV_KEYS, KV_PREFIXES } from "./kv-keys";

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
  await env.REGISTRY.put(KV_KEYS.session(sid), JSON.stringify(data), { expirationTtl: SESSION_TTL_SEC });
  return sid;
}

/** 解析会话；剩余有效期不足一半时同 sid 原地滑动续期（Cookie 无需回写） */
export async function resolveSession(
  env: Env,
  request: Request,
  ctx?: ExecutionContext,
): Promise<{ user: HubUser } | null> {
  const sid = parseCookies(request)[SESSION_COOKIE];
  if (!sid) return null;
  const raw = await env.REGISTRY.get(KV_KEYS.session(sid));
  if (!raw) return null;
  let data: SessionData;
  try {
    data = JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
  if (!data.open_id || data.expiresAt <= Date.now()) {
    await env.REGISTRY.delete(KV_KEYS.session(sid));
    return null;
  }
  const user: HubUser = { name: data.name, open_id: data.open_id, avatar_url: data.avatar_url };
  if (data.expiresAt - Date.now() < (SESSION_TTL_SEC * 1000) / 2) {
    const write = env.REGISTRY.put(
      KV_KEYS.session(sid),
      JSON.stringify({ ...data, expiresAt: Date.now() + SESSION_TTL_SEC * 1000 }),
      { expirationTtl: SESSION_TTL_SEC },
    );
    if (ctx) ctx.waitUntil(write);
    else await write;
  }
  return { user };
}

export async function destroySession(env: Env, request: Request, ctx?: ExecutionContext): Promise<void> {
  const sid = parseCookies(request)[SESSION_COOKIE];
  if (!sid) return;
  const del = env.REGISTRY.delete(KV_KEYS.session(sid));
  if (ctx) ctx.waitUntil(del);
  else await del;
}

/** 删除某 open_id 名下全部会话 key（logout-all 与管理员强制下线共用），返回删除数量；坏记录跳过 */
export async function revokeUserSessions(env: Env, openId: string, ctx?: ExecutionContext): Promise<number> {
  let revoked = 0;
  let cursor: string | undefined;
  do {
    const page = await env.REGISTRY.list({ prefix: KV_PREFIXES.session, ...(cursor ? { cursor } : {}) });
    const raws = await Promise.all(page.keys.map((k) => env.REGISTRY.get(k.name)));
    for (let i = 0; i < page.keys.length; i++) {
      const raw = raws[i];
      if (!raw) continue;
      try {
        const data = JSON.parse(raw) as SessionData;
        if (data.open_id !== openId) continue;
      } catch {
        continue; // 坏记录不归属任何人，跳过
      }
      const del = env.REGISTRY.delete(page.keys[i].name);
      if (ctx) ctx.waitUntil(del);
      else await del;
      revoked++;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return revoked;
}
