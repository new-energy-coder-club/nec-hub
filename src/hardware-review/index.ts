/**
 * 硬件评审流程 — 路由注册
 *
 * 与 drawing-review 同构：提交评审单 → 预约会议 → 保存纪要 → 提交结论 → 生成评审报告 → 评估归档。
 * 迁移说明（审批引擎 Phase 1，选项 A 兼容迁移）：评审单本体/状态机/群通知由
 * src/approvals 引擎承担（submitApprovalCore / runApprovalAction，单号 HR-2026-0001，
 * 「评审单号」= 申请单号供子表外键沿用）；本文件只做薄壳转调 + 富业务副作用
 * （提交默认值/偏好回写、会议纪要、整改项创建、报告生成、事件日志）。
 * URL 与请求/响应形状保持不变，前端零改动。
 * 入口骨架（配置接口 / 503 / 会话 / 401 / 500 兜底）统一由 shared/module-gateway 提供。
 */

import { ensureFlowTableLink } from "../approvals/flows";
import { submitApprovalCore } from "../approvals/engine";
import { resolveUserRole } from "../auth/role";
import { json, readJson } from "../shared/http";
import { handleScheduleMeeting } from "../shared/meeting.service";
import { withModuleGate, CONFIG_ADMIN_ROLES, type ModuleRouteContext } from "../shared/module-gateway";
import { logReviewEvent, runReviewEngineAction, type ReviewShellSpec } from "../shared/review-engine-bridge";
import { CONCLUSION_EVENTS } from "../shared/review-flow";
import { HardwareReviewAdapter } from "./adapter";
import { getHardwareReviewConfig, setHardwareReviewConfig } from "./config";
import { ConclusionInput, ReviewFlowService, nextStatus, SubmitReviewInput } from "./flow.service";
import { GenerateReportInput, ReportService } from "./report.service";
import type { HardwareReviewConfig } from "./types";

/** 引擎流程类型与薄壳事件日志配置（评审单动作全部走引擎 hardware_review 流程） */
const FLOW_TYPE = "hardware_review" as const;
const SHELL: ReviewShellSpec = {
  type: FLOW_TYPE,
  logTag: "hardware-review",
  eventsTable: "events",
  eventReviewField: "关联评审单",
};

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

  // 评审单提交（薄壳：默认值/偏好 → 引擎写单与通知；事件日志留本层）
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
    const defaults = await flow.getDefaultSubmissionValues(input, session.open_id);
    flow.assertSubmitReady(input, defaults);
    await ensureFlowTableLink(env, FLOW_TYPE, cfg.tables.reviews, cfg.base);
    const { application_id, status } = await submitApprovalCore(env, {
      type: FLOW_TYPE,
      fields: {
        评审单号: "@appId",
        项目编号: defaults.projectId,
        硬件名称: defaults.hardwareName,
        硬件类型: defaults.hardwareType,
        硬件版本: defaults.hardwareVersion,
        设计负责人: defaults.designerId,
        硬件资料: JSON.stringify(input.hardwareFiles),
        设计说明: defaults.designNotes,
        规格参数: defaults.specification,
      },
      user: session,
      role: await resolveUserRole(env, session),
      source: "portal",
    });
    await logReviewEvent(adapter, SHELL, application_id, session.open_id, "submit", "draft", status);
    await flow.saveSubmissionPreferences(input, session.open_id);
    return json(await adapter.findReviewById(application_id));
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

  // 会议预约（薄壳：建会与会议信息回写不变；start_meeting 状态流转走引擎）
  const meetingMatch = pathname.match(/^\/api\/hardware-review\/([^/]+)\/meeting$/);
  if (meetingMatch && request.method === "POST") {
    return handleScheduleMeeting(
      request,
      env,
      {
        flow: {
          getReview: (reviewId) => adapter.findReviewById(reviewId),
          startMeeting: async (reviewId, _actorId, payload) => {
            const current = await adapter.findReviewById(reviewId);
            if (!current) throw new Error(`评审单 ${reviewId} 不存在`);
            if (!nextStatus(current.status, "start_meeting")) {
              throw new Error(`当前状态 ${current.status} 不允许开始会议`);
            }
            await ensureFlowTableLink(env, FLOW_TYPE, cfg.tables.reviews, cfg.base);
            await runReviewEngineAction(env, SHELL, adapter, reviewId, "start_meeting", session, await resolveUserRole(env, session), payload);
            return adapter.findReviewById(reviewId);
          },
        },
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

  // 评审结论（薄壳：状态流转走引擎；结论字段回写 + 整改项创建 + 事件日志留本层）
  const conclusionMatch = pathname.match(/^\/api\/hardware-review\/([^/]+)\/conclusion$/);
  if (conclusionMatch && request.method === "POST") {
    const body = await readJson<ConclusionInput>(request);
    if (!body) return json({ error: "请求体必须是 JSON" }, 400);
    const reviewId = conclusionMatch[1];
    const current = await adapter.findReviewById(reviewId);
    if (!current) throw new Error(`评审单 ${reviewId} 不存在`);
    if (current.status !== "in_review") throw new Error("只能在评审中状态下提交评审结论");
    const event = CONCLUSION_EVENTS[body.conclusion];
    if (!event) throw new Error(`结论 ${body.conclusion} 无法驱动状态流转`);
    await ensureFlowTableLink(env, FLOW_TYPE, cfg.tables.reviews, cfg.base);
    await runReviewEngineAction(
      env, SHELL, adapter, reviewId, event, session, await resolveUserRole(env, session),
      { conclusion: body.conclusion }, "conclude",
    );
    const updated = await adapter.updateReview(current.recordId, {
      conclusion: body.conclusion,
      conclusionNotes: body.notes,
      updatedAt: new Date().toISOString(),
    });
    if (body.conclusion === "conditional" && body.issues && body.issues.length > 0) {
      await Promise.all(
        body.issues.map((issue) =>
          adapter.createRecord("rectifications", {
            关联评审单: reviewId,
            问题描述: issue.description,
            提出人: issue.raisedBy.open_id,
            责任人: issue.owner?.open_id,
            截止日期: issue.dueDate,
            完成状态: "未完成",
          }),
        ),
      );
    }
    return json(updated);
  }

  // 整改完成（薄壳：complete 流转走引擎；事件日志动作名沿用 complete_rectification）
  const rectifyMatch = pathname.match(/^\/api\/hardware-review\/([^/]+)\/rectify$/);
  if (rectifyMatch && request.method === "POST") {
    const reviewId = rectifyMatch[1];
    const current = await adapter.findReviewById(reviewId);
    if (!current) throw new Error(`评审单 ${reviewId} 不存在`);
    if (!nextStatus(current.status, "complete")) throw new Error(`当前状态 ${current.status} 不允许完成整改`);
    await ensureFlowTableLink(env, FLOW_TYPE, cfg.tables.reviews, cfg.base);
    await runReviewEngineAction(
      env, SHELL, adapter, reviewId, "complete", session, await resolveUserRole(env, session),
      undefined, "complete_rectification",
    );
    return json(await adapter.findReviewById(reviewId));
  }

  // 评审报告生成（薄壳：报告数据写入不变；generated 流转走引擎）
  const reportMatch = pathname.match(/^\/api\/hardware-review\/([^/]+)\/report\/generate$/);
  if (reportMatch && request.method === "POST") {
    const body = await readJson<GenerateReportInput>(request);
    if (!body) return json({ error: "请求体必须是 JSON" }, 400);
    const reportService = new ReportService(adapter);
    const result = await reportService.generate(reportMatch[1], body);
    await ensureFlowTableLink(env, FLOW_TYPE, cfg.tables.reviews, cfg.base);
    await runReviewEngineAction(env, SHELL, adapter, reportMatch[1], "generated", session, await resolveUserRole(env, session));
    return json(result);
  }

  // 评审报告查询
  const reportGetMatch = pathname.match(/^\/api\/hardware-review\/([^/]+)\/report$/);
  if (reportGetMatch && request.method === "GET") {
    const data = await adapter.getReportByReview(reportGetMatch[1]);
    if (!data) return json({ error: "评审报告不存在" }, 404);
    return json(data);
  }

  // 评估结果（薄壳：assessing → approved / draft 走引擎）
  const assessMatch = pathname.match(/^\/api\/hardware-review\/([^/]+)\/assess$/);
  if (assessMatch && request.method === "POST") {
    const body = (await readJson<{ result?: string }>(request)) ?? {};
    const event = body.result === "fail" ? "fail" : "pass";
    await ensureFlowTableLink(env, FLOW_TYPE, cfg.tables.reviews, cfg.base);
    await runReviewEngineAction(env, SHELL, adapter, assessMatch[1], event, session, await resolveUserRole(env, session), { result: event });
    return json(await adapter.findReviewById(assessMatch[1]));
  }

  // 归档（薄壳：approved → archived 走引擎）
  const archiveMatch = pathname.match(/^\/api\/hardware-review\/([^/]+)\/archive$/);
  if (archiveMatch && request.method === "POST") {
    await ensureFlowTableLink(env, FLOW_TYPE, cfg.tables.reviews, cfg.base);
    await runReviewEngineAction(env, SHELL, adapter, archiveMatch[1], "archive", session, await resolveUserRole(env, session));
    return json(await adapter.findReviewById(archiveMatch[1]));
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
