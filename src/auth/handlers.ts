/**
 * 登录态 HTTP 处理器（/api/whoami、/auth/logout、/api/auth/logout-all）
 */

import { json } from "../shared/http";
import { destroySession, resolveSession, revokeUserSessions, sessionCookie } from "../shared/session";
import { resolveUserRole } from "./role";

export async function handleWhoami(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const s = await resolveSession(env, request, ctx);
  if (!s) return json({ authenticated: false, user: null });
  const role = await resolveUserRole(env, s.user, ctx);
  return json({ authenticated: true, user: { ...s.user, ...role } });
}

export async function handleLogout(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  await destroySession(env, request, ctx);
  const res = json({ ok: true });
  res.headers.set("set-cookie", sessionCookie("", 0));
  return res;
}

/** 退出所有设备：删除当前用户名下全部会话 key，并清除本机 Cookie */
export async function handleLogoutAll(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const s = await resolveSession(env, request, ctx);
  if (!s) return json({ error: "请先登录" }, 401);
  const revoked = await revokeUserSessions(env, s.user.open_id, ctx);
  const res = json({ ok: true, revoked });
  res.headers.set("set-cookie", sessionCookie("", 0));
  return res;
}
