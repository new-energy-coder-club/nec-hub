/**
 * 我的任务 — 绑定用户飞书任务（Task v2）并同步展示
 *
 * GET  /api/my-tasks         → 同步拉取飞书任务（KV my-tasks:<open_id> 5 分钟缓存，?refresh=1 强制刷新）；
 *                              未绑定返回 { bound: false, authorizeUrl } 引导重新走 OAuth 覆盖授权
 * POST /api/my-tasks/unbind  → 解绑（清授权 token 与任务缓存）
 */

import { FeishuUserAuthError, listUserTasks, type FeishuTask } from "../feishu/task";
import { clearUserToken, getUserAccessToken } from "../feishu/user-token";
import { json } from "../shared/http";
import { applyRenewedSession, resolveSession } from "../shared/session";

/** 任务列表缓存 TTL（秒）：与待办聚合一致 5 分钟 */
const MY_TASKS_CACHE_TTL_SEC = 300;

/** 申请的最小 scope：task:task:read 读任务；task:tasklist:read 读清单；mail:user_mailbox.message:send 邮件通道发信（G-05，与门户登录 scope 保持一致，避免重绑任务时丢掉 mail 授权） */
const FEISHU_TASK_SCOPES = "task:task:read task:tasklist:read mail:user_mailbox.message:send";

/** 复用登录跳转的 authorize URL，追加任务 scope；scope 变化后重新授权一次即完成绑定 */
function buildAuthorizeUrl(request: Request, env: Env): string | null {
  if (!env.FEISHU_APP_ID) return null;
  const u = new URL("https://open.feishu.cn/open-apis/authen/v1/authorize");
  u.searchParams.set("app_id", env.FEISHU_APP_ID);
  u.searchParams.set("redirect_uri", new URL(request.url).origin + "/");
  u.searchParams.set("state", crypto.randomUUID());
  u.searchParams.set("scope", FEISHU_TASK_SCOPES);
  return u.toString();
}

interface MyTasksCache {
  data: { tasks: FeishuTask[]; syncedAt: string };
  cachedAt: number;
}

export async function handleGetMyTasks(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "请先登录" }, 401);
  const finish = (data: unknown, status = 200) => applyRenewedSession(json(data, status), session.renewed);

  const openId = session.user.open_id;
  const token = await getUserAccessToken(env, openId);
  if (!token) return finish({ bound: false, authorizeUrl: buildAuthorizeUrl(request, env) });

  const cacheKey = `my-tasks:${openId}`;
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  if (!force) {
    const cached = (await env.REGISTRY.get(cacheKey, "json")) as MyTasksCache | null;
    if (cached && cached.cachedAt > Date.now() - MY_TASKS_CACHE_TTL_SEC * 1000) {
      return finish({ bound: true, cached: true, ...cached.data });
    }
  }

  try {
    const tasks = await listUserTasks(token);
    const data = { tasks, syncedAt: new Date().toISOString() };
    const write = env.REGISTRY.put(cacheKey, JSON.stringify({ data, cachedAt: Date.now() } satisfies MyTasksCache));
    if (ctx) ctx.waitUntil(write);
    else await write;
    return finish({ bound: true, cached: false, ...data });
  } catch (err) {
    if (err instanceof FeishuUserAuthError) {
      // token 已失效/scope 不足：清绑定与缓存，引导重新授权
      await clearUserToken(env, openId);
      await env.REGISTRY.delete(cacheKey);
      return finish({ bound: false, rebind: true, message: err.message, authorizeUrl: buildAuthorizeUrl(request, env) });
    }
    throw err;
  }
}

export async function handleUnbindMyTasks(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "请先登录" }, 401);
  await clearUserToken(env, session.user.open_id);
  await env.REGISTRY.delete(`my-tasks:${session.user.open_id}`);
  return applyRenewedSession(json({ ok: true }), session.renewed);
}
