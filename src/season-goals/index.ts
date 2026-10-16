/**
 * 赛季目标管理 — 路由注册
 *
 * 入口骨架（配置接口 / 503 / 会话 / 401 / 500 兜底）统一由 shared/module-gateway 提供。
 */

import { ROLES, resolveUserRole } from "../auth/role";
import { json, readJson } from "../shared/http";
import { withModuleGate, CONFIG_ADMIN_ROLES, type ModuleRouteContext } from "../shared/module-gateway";
import { SeasonGoalsAdapter } from "./adapter";
import { CollectService, UserInputError, type SubmitBody } from "./collect.service";
import { getSeasonGoalsConfig, setSeasonGoalsConfig } from "./config";
import { PlanService } from "./plan.service";
import type { SeasonGoalsConfig } from "./types";

/** 审批（采纳/拒绝）与自动规划落库的管理角色口径，与 validation/home 的 LEADER 一致 */
const LEADER_ROLE_RE = ROLES.LEADER;

export async function handleSeasonGoals(request: Request, env: Env, pathname: string): Promise<Response | null> {
  return withModuleGate(
    {
      configPath: "/api/season-goals/config",
      label: "赛季目标管理",
      logTag: "season-goals",
      getConfig: getSeasonGoalsConfig,
      handleConfig,
      handler: handleAuthed,
      configRoles: CONFIG_ADMIN_ROLES,
    },
    request,
    env,
    pathname,
  );
}

async function handleAuthed(ctx: ModuleRouteContext<SeasonGoalsConfig>): Promise<Response | null> {
  const { request, env, cfg, session, pathname } = ctx;
  const adapter = new SeasonGoalsAdapter(env, cfg);
  const collect = new CollectService(adapter);

  // 管理操作角色门禁：不匹配（含名单未配置/未命中）一律 403，不做降级
  const requireLeader = async (action: string): Promise<Response | null> => {
    const role = await resolveUserRole(env, session);
    if (!LEADER_ROLE_RE.test(role.role)) {
      return json({ error: `权限不足：${action}仅队长/组长可执行（当前角色：${role.role}）` }, 403);
    }
    return null;
  };

  // 入参错误返回 400，其余异常交网关 500 兜底
  const respond = async (fn: () => Promise<unknown>): Promise<Response> => {
    try {
      return json(await fn());
    } catch (err) {
      if (err instanceof UserInputError) return json({ error: err.message }, 400);
      throw err;
    }
  };

  // 目标看板
  if (pathname === "/api/season-goals/goals" && request.method === "GET") {
    return json(await adapter.listGoals());
  }

  // 收集单列表
  if (pathname === "/api/season-goals/collect" && request.method === "GET") {
    return json(await collect.list());
  }

  // 提交收集单
  if (pathname === "/api/season-goals/submit" && request.method === "POST") {
    const body = await readJson<SubmitBody>(request);
    if (!body) return json({ error: "请求体必须是 JSON" }, 400);
    return respond(() => collect.submit(session.name, body));
  }

  // 采纳 / 拒绝（管理操作）
  if (pathname === "/api/season-goals/collect/approve" && request.method === "POST") {
    const denied = await requireLeader("采纳收集单");
    if (denied) return denied;
    const body = await readJson<{ recordId?: string }>(request);
    if (!body) return json({ error: "请求体必须是 JSON" }, 400);
    if (!body.recordId) return json({ error: "缺少 recordId" }, 400);
    return respond(() => collect.approve(body.recordId as string));
  }
  if (pathname === "/api/season-goals/collect/reject" && request.method === "POST") {
    const denied = await requireLeader("拒绝收集单");
    if (denied) return denied;
    const body = await readJson<{ recordId?: string }>(request);
    if (!body) return json({ error: "请求体必须是 JSON" }, 400);
    if (!body.recordId) return json({ error: "缺少 recordId" }, 400);
    return respond(() => collect.reject(body.recordId as string));
  }

  // 自动规划：GET 预览（不落库），POST 生成草稿到收集单（管理操作）
  if (pathname === "/api/season-goals/plan" && request.method === "GET") {
    const plan = new PlanService(env, adapter, cfg);
    return json(await plan.preview());
  }
  if (pathname === "/api/season-goals/plan" && request.method === "POST") {
    const denied = await requireLeader("自动规划落库");
    if (denied) return denied;
    const plan = new PlanService(env, adapter, cfg);
    return json(await plan.apply());
  }

  return null;
}

async function handleConfig(request: Request, env: Env): Promise<Response> {
  const body = (await readJson<{ action?: string; base?: string; tables?: Record<string, string> }>(request)) ?? {};
  if (body.action === "get" || !body.action) {
    const cfg = await getSeasonGoalsConfig(env);
    return json({ configured: !!cfg, base: cfg?.base ?? null, tables: cfg?.tables ?? {} });
  }
  if (body.action !== "set") return json({ error: "action 必须是 get | set" }, 400);
  if (!body.base || !body.tables) return json({ error: "缺少 base 或 tables" }, 400);

  const cfg = await setSeasonGoalsConfig(env, { base: body.base, tables: body.tables as SeasonGoalsConfig["tables"] });
  return json({ ok: true, config: cfg });
}
