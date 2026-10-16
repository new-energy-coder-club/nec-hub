/**
 * 硬件评审流程 — 路由注册
 *
 * 与 drawing-review 同构：提交评审单 → 预约会议 → 保存纪要 → 提交结论 → 生成评审报告 → 评估归档。
 * 入口骨架（配置接口 / 503 / 会话 / 401 / 500 兜底）统一由 shared/module-gateway 提供。
 */

import { json, readJson } from "../shared/http";
import { handleScheduleMeeting } from "../shared/meeting.service";
import { withModuleGate, CONFIG_ADMIN_ROLES, type ModuleRouteContext } from "../shared/module-gateway";
import { HardwareReviewAdapter } from "./adapter";
import { getHardwareReviewConfig, setHardwareReviewConfig } from "./config";
import { ConclusionInput, ReviewFlowService, SubmitReviewInput } from "./flow.service";
import { GenerateReportInput, ReportService } from "./report.service";
import type { HardwareReviewConfig } from "./types";

export async function handleHardwareReview(request: Request, env: Env, pathname: string): Promise<Response | null> {
  return withModuleGate(
    {
      configPath: "/api/hardware-review/config",
      label: "硬件评审流程",
      logTag: "hardware-review",
      getConfig: getHardwareReviewConfig,
      handleConfig,
      handler: handleAuthed,
      configRoles: CONFIG_ADMIN_ROLES,
    },
    request,
    env,
    pathname,
  );
}

async function handleAuthed(ctx: ModuleRouteContext<HardwareReviewConfig>): Promise<Response | null> {
  const { request, env, cfg, session, pathname } = ctx;
  const adapter = new HardwareReviewAdapter(env, cfg);
  const flow = new ReviewFlowService(env, adapter);

  // 评审单提交
  if (pathname === "/api/hardware-review/submit" && request.method === "POST") {
    const body = await readJson<Partial<SubmitReviewInput>>(request);
    if (!body) return json({ error: "请求体必须是 JSON" }, 400);
    const input: SubmitReviewInput = {
      projectId: body.projectId,
      hardwareName: body.hardwareName,
      hardwareType: body.hardwareType,
      hardwareVersion: body.hardwareVersion,
      designerId: body.designerId,
      hardwareFiles: body.hardwareFiles || [],
      designNotes: body.designNotes,
      specification: body.specification,
    };
    const review = await flow.submit(input, session.open_id);
    return json(review);
  }

  // 评审单列表
  if (pathname === "/api/hardware-review" && request.method === "GET") {
    const list = await flow.listReviews();
    return json(list);
  }

  // 开始填写（默认填充值，供前端预填表单）
  if (pathname === "/api/hardware-review/start" && request.method === "GET") {
    const defaults = await flow.getDefaultSubmissionValues({ hardwareFiles: [] }, session.open_id);
    return json({ ok: true, defaults, timestamp: new Date().toISOString() });
  }

  // 评审单详情
  const detailMatch = pathname.match(/^\/api\/hardware-review\/([^/]+)$/);
  if (detailMatch && request.method === "GET") {
    const review = await flow.getReview(detailMatch[1]);
    if (!review) return json({ error: "评审单不存在" }, 404);
    return json(review);
  }

  // 会议预约
  const meetingMatch = pathname.match(/^\/api\/hardware-review\/([^/]+)\/meeting$/);
  if (meetingMatch && request.method === "POST") {
    return handleScheduleMeeting(
      request,
      env,
      {
        flow,
        adapter,
        topic: (review) => `硬件评审 - ${review.hardwareName} - ${review.hardwareVersion}`,
      },
      meetingMatch[1],
      session.open_id,
    );
  }

  // 会议纪要
  const minutesMatch = pathname.match(/^\/api\/hardware-review\/([^/]+)\/minutes$/);
  if (minutesMatch && request.method === "POST") {
    const body = await readJson<Parameters<ReviewFlowService["saveMinutes"]>[1]>(request);
    if (!body) return json({ error: "请求体必须是 JSON" }, 400);
    const minutes = await flow.saveMinutes(minutesMatch[1], body, session.open_id);
    return json(minutes);
  }

  // 评审结论
  const conclusionMatch = pathname.match(/^\/api\/hardware-review\/([^/]+)\/conclusion$/);
  if (conclusionMatch && request.method === "POST") {
    const body = await readJson<ConclusionInput>(request);
    if (!body) return json({ error: "请求体必须是 JSON" }, 400);
    const review = await flow.conclude(conclusionMatch[1], body, session.open_id);
    return json(review);
  }

  // 整改完成
  const rectifyMatch = pathname.match(/^\/api\/hardware-review\/([^/]+)\/rectify$/);
  if (rectifyMatch && request.method === "POST") {
    const review = await flow.completeRectification(rectifyMatch[1], session.open_id);
    return json(review);
  }

  // 评审报告生成（生成后自动流转 report_generating → assessing）
  const reportMatch = pathname.match(/^\/api\/hardware-review\/([^/]+)\/report\/generate$/);
  if (reportMatch && request.method === "POST") {
    const body = await readJson<GenerateReportInput>(request);
    if (!body) return json({ error: "请求体必须是 JSON" }, 400);
    const reportService = new ReportService(adapter);
    const result = await reportService.generate(reportMatch[1], body);
    await flow.transitionTo(reportMatch[1], "generated", session.open_id);
    return json(result);
  }

  // 评审报告查询
  const reportGetMatch = pathname.match(/^\/api\/hardware-review\/([^/]+)\/report$/);
  if (reportGetMatch && request.method === "GET") {
    const data = await adapter.getReportByReview(reportGetMatch[1]);
    if (!data) return json({ error: "评审报告不存在" }, 404);
    return json(data);
  }

  // 评估结果（assessing → approved / draft）
  const assessMatch = pathname.match(/^\/api\/hardware-review\/([^/]+)\/assess$/);
  if (assessMatch && request.method === "POST") {
    const body = (await readJson<{ result?: string }>(request)) ?? {};
    const event = body.result === "fail" ? "fail" : "pass";
    const review = await flow.transitionTo(assessMatch[1], event, session.open_id, { result: event });
    return json(review);
  }

  // 归档（approved → archived）
  const archiveMatch = pathname.match(/^\/api\/hardware-review\/([^/]+)\/archive$/);
  if (archiveMatch && request.method === "POST") {
    const review = await flow.transitionTo(archiveMatch[1], "archive", session.open_id);
    return json(review);
  }

  return null;
}

async function handleConfig(request: Request, env: Env): Promise<Response> {
  const body = (await readJson<{ action?: string; base?: string; tables?: Record<string, string> }>(request)) ?? {};
  if (body.action === "get" || !body.action) {
    const cfg = await getHardwareReviewConfig(env);
    return json({ configured: !!cfg, base: cfg?.base ?? null, tables: cfg?.tables ?? {} });
  }
  if (body.action !== "set") return json({ error: "action 必须是 get | set" }, 400);
  if (!body.base || !body.tables) return json({ error: "缺少 base 或 tables" }, 400);

  const cfg = await setHardwareReviewConfig(env, { base: body.base, tables: body.tables as HardwareReviewConfig["tables"] });
  return json({ ok: true, config: cfg });
}
