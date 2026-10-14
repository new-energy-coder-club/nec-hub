/**
 * 赛季目标管理 — 路由注册
 *
 * 入口骨架（配置接口 / 503 / 会话 / 401 / 500 兜底）统一由 shared/module-gateway 提供。
 */

import { json } from "../shared/http";
import { withModuleGate, type ModuleRouteContext } from "../shared/module-gateway";
import { SeasonGoalsAdapter } from "./adapter";
import { CollectService, UserInputError, type SubmitBody } from "./collect.service";
import { getSeasonGoalsConfig, setSeasonGoalsConfig } from "./config";
import { PlanService } from "./plan.service";
import type { SeasonGoalsConfig } from "./types";

export async function handleSeasonGoals(request: Request, env: Env, pathname: string): Promise<Response | null> {
  return withModuleGate(
    {
      configPath: "/api/season-goals/config",
      label: "赛季目标管理",
      logTag: "season-goals",
      getConfig: getSeasonGoalsConfig,
      handleConfig,
      handler: handleAuthed,
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
    const body = (await request.json()) as SubmitBody;
    return respond(() => collect.submit(session.name, body));
  }

  // 采纳 / 拒绝
  if (pathname === "/api/season-goals/collect/approve" && request.method === "POST") {
    const body = (await request.json()) as { recordId?: string };
    if (!body.recordId) return json({ error: "缺少 recordId" }, 400);
    return respond(() => collect.approve(body.recordId as string));
  }
  if (pathname === "/api/season-goals/collect/reject" && request.method === "POST") {
    const body = (await request.json()) as { recordId?: string };
    if (!body.recordId) return json({ error: "缺少 recordId" }, 400);
    return respond(() => collect.reject(body.recordId as string));
  }

  // 自动规划：GET 预览（不落库），POST 生成草稿到收集单
  if (pathname === "/api/season-goals/plan" && request.method === "GET") {
    const plan = new PlanService(env, adapter, cfg);
    return json(await plan.preview());
  }
  if (pathname === "/api/season-goals/plan" && request.method === "POST") {
    const plan = new PlanService(env, adapter, cfg);
    return json(await plan.apply());
  }

  return null;
}

async function handleConfig(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { action?: string; base?: string; tables?: Record<string, string> };
  if (body.action === "get" || !body.action) {
    const cfg = await getSeasonGoalsConfig(env);
    return json({ configured: !!cfg, base: cfg?.base ?? null, tables: cfg?.tables ?? {} });
  }
  if (body.action !== "set") return json({ error: "action 必须是 get | set" }, 400);
  if (!body.base || !body.tables) return json({ error: "缺少 base 或 tables" }, 400);

  const cfg = await setSeasonGoalsConfig(env, { base: body.base, tables: body.tables as SeasonGoalsConfig["tables"] });
  return json({ ok: true, config: cfg });
}
