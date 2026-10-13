/**
 * 登录态 HTTP 处理器（/api/whoami、/auth/logout）
 */

import { json } from "../shared/http";
import { destroySession, resolveSession, sessionCookie } from "../shared/session";
import { resolveUserRole } from "./role";

export async function handleWhoami(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const s = await resolveSession(env, request, ctx);
  if (!s) return json({ authenticated: false, user: null });
  const role = await resolveUserRole(env, s.user, ctx);
  const res = json({ authenticated: true, user: { ...s.user, ...role } });
  if (s.renewed) res.headers.set("set-cookie", sessionCookie(s.renewed));
  return res;
}

export async function handleLogout(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  await destroySession(env, request, ctx);
  const res = json({ ok: true });
  res.headers.set("set-cookie", sessionCookie("", 0));
  return res;
}
