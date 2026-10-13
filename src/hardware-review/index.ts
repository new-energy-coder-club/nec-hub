/**
 * 硬件评审流程 — 路由注册
 *
 * 与 drawing-review 同构：提交评审单 → 预约会议 → 保存纪要 → 提交结论 → 生成评审报告 → 评估归档。
 */

import { getTenantAccessToken } from "../feishu/bitable";
import { BaseAdapter } from "./adapter";
import { getHardwareReviewConfig, setHardwareReviewConfig } from "./config";
import { ConclusionInput, ReviewFlowService, SubmitReviewInput } from "./flow.service";
import { defaultMeetingInput, MeetingService } from "./meeting.service";
import { GenerateReportInput, ReportService } from "./report.service";
import type { HardwareReviewConfig } from "./types";

export async function handleHardwareReview(request: Request, env: Env, pathname: string): Promise<Response | null> {
  const cfg = await getHardwareReviewConfig(env);

  // 配置接口无需登录
  if (pathname === "/api/hardware-review/config") {
    if (request.method === "GET") return json({ configured: !!cfg, base: cfg?.base ?? null, tables: cfg?.tables ?? {} });
    if (request.method === "POST") return handleConfig(request, env);
    return json({ error: "method not allowed" }, 405);
  }

  // 未配置时返回友好提示
  if (!cfg) {
    return json(
      {
        error: "硬件评审流程尚未配置",
        hint: "请先调用 POST /api/hardware-review/config 设置 base 与 tables",
      },
      503,
    );
  }

  // 后续接口要求登录态
  const session = await resolveSessionForHardwareReview(request, env);
  if (!session) return json({ error: "请先登录" }, 401);

  const adapter = new BaseAdapter(env, cfg);
  const flow = new ReviewFlowService(env, adapter);

  try {
    // 评审单提交
    if (pathname === "/api/hardware-review/submit" && request.method === "POST") {
      const body = (await request.json()) as Partial<SubmitReviewInput>;
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
      return handleScheduleMeeting(request, env, adapter, flow, meetingMatch[1], session.open_id);
    }

    // 会议纪要
    const minutesMatch = pathname.match(/^\/api\/hardware-review\/([^/]+)\/minutes$/);
    if (minutesMatch && request.method === "POST") {
      const body = (await request.json()) as Parameters<ReviewFlowService["saveMinutes"]>[1];
      const minutes = await flow.saveMinutes(minutesMatch[1], body, session.open_id);
      return json(minutes);
    }

    // 评审结论
    const conclusionMatch = pathname.match(/^\/api\/hardware-review\/([^/]+)\/conclusion$/);
    if (conclusionMatch && request.method === "POST") {
      const body = (await request.json()) as ConclusionInput;
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
      const body = (await request.json()) as GenerateReportInput;
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
      const body = (await request.json()) as { result?: string };
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
  } catch (err) {
    console.error(`[hardware-review] ${pathname} error:`, err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

async function handleConfig(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { action?: string; base?: string; tables?: Record<string, string> };
  if (body.action === "get" || !body.action) {
    const cfg = await getHardwareReviewConfig(env);
    return json({ configured: !!cfg, base: cfg?.base ?? null, tables: cfg?.tables ?? {} });
  }
  if (body.action !== "set") return json({ error: "action 必须是 get | set" }, 400);
  if (!body.base || !body.tables) return json({ error: "缺少 base 或 tables" }, 400);

  const cfg = await setHardwareReviewConfig(env, { base: body.base, tables: body.tables as HardwareReviewConfig["tables"] });
  return json({ ok: true, config: cfg });
}

async function handleScheduleMeeting(
  request: Request,
  env: Env,
  adapter: BaseAdapter,
  flow: ReviewFlowService,
  reviewId: string,
  actorId: string,
): Promise<Response> {
  const review = await flow.getReview(reviewId);
  if (!review) return json({ error: "评审单不存在" }, 404);

  const body = (await request.json()) as { startTime?: string; durationMinutes?: number; attendeeOpenIds?: string[] };
  const attendeeOpenIds = body.attendeeOpenIds ?? [review.designerId];
  const meetingInput = defaultMeetingInput(review, attendeeOpenIds);
  if (body.startTime) meetingInput.startTime = body.startTime;
  if (body.durationMinutes) meetingInput.durationMinutes = body.durationMinutes;

  const meetingService = new MeetingService(env, () => getTenantAccessToken(env));
  const info = await meetingService.createMeeting(meetingInput);

  await adapter.updateReview(review.recordId, {
    meetingId: info.meetingId,
    meetingLink: info.meetingLink,
    meetingStartTime: info.startTime,
    updatedAt: new Date().toISOString(),
  });

  // 会议预约后，状态从 pending_review → in_review
  const updated = await flow.startMeeting(reviewId, actorId);

  return json({ meeting: info, review: updated });
}

// ---------- 复用 index.ts 的会话解析 ----------

interface HubUser {
  name: string;
  open_id: string;
  avatar_url?: string;
}

interface SessionData extends HubUser {
  createdAt: string;
  expiresAt: number;
}

function parseCookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function resolveSessionForHardwareReview(request: Request, env: Env): Promise<HubUser | null> {
  const sid = parseCookies(request)["nec_session"];
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
  return { name: data.name, open_id: data.open_id, avatar_url: data.avatar_url };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
