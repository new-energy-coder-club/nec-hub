/**
 * 会议集成服务 — drawing-review / hardware-review 共用
 *
 * 调用飞书视频会议 API 创建会议；未开通 vc:meeting:write 权限（或网络失败）时
 * 降级返回 mock 会议信息。两模块差异仅在会议主题文案，由调用方参数化传入。
 */

import { getTenantAccessToken } from "../feishu/bitable";
import { json, readJson } from "./http";

const FEISHU_MEETING_API = "https://open.feishu.cn/open-apis/vc/v1";

export interface MeetingInfo {
  meetingId: string;
  meetingLink: string;
  startTime: string;
  durationMinutes: number;
  /** true 表示会议 API 未打通（权限/网络），返回的是占位信息，需人工补录真实会议 */
  mock: boolean;
  /** mock 时的失败原因（API 报错信息或网络异常），用于事件日志留痕 */
  mockReason?: string;
}

export interface CreateMeetingInput {
  topic: string;
  startTime: string;
  durationMinutes?: number;
  attendeeOpenIds: string[];
}

export class MeetingService {
  constructor(
    private env: Env,
    private tenantTokenProvider: () => Promise<string>,
  ) {}

  /**
   * 调用飞书视频会议 API 创建会议。
   * 若未开通 vc:meeting:write 权限，则降级返回 mock 会议信息。
   */
  async createMeeting(input: CreateMeetingInput): Promise<MeetingInfo> {
    const token = await this.tenantTokenProvider();

    const startTimeSec = Math.floor(new Date(input.startTime).getTime() / 1000);
    const duration = input.durationMinutes ?? 60;

    const body = {
      topic: input.topic,
      start_time: String(startTimeSec),
      end_time: String(startTimeSec + duration * 60),
      meeting_type: 0,
      settings: {
        // 允许参会人入会
        allow_attendees_start: true,
      },
    };

    try {
      const resp = await fetch(`${FEISHU_MEETING_API}/meetings`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as {
        code?: number;
        msg?: string;
        data?: { meeting?: { meeting_id: string; url?: string; join_url?: string } };
      };
      if (data.code !== 0 || !data.data?.meeting?.meeting_id) {
        // 权限/功能未开通时降级
        console.warn("[meeting] create meeting failed, fallback to mock:", data.msg);
        return this.mockMeeting(input, data.msg);
      }
      const meeting = data.data.meeting;
      return {
        meetingId: meeting.meeting_id,
        meetingLink: meeting.join_url ?? meeting.url ?? "",
        startTime: input.startTime,
        durationMinutes: duration,
        mock: false,
      };
    } catch (err) {
      console.warn("[meeting] network error, fallback to mock:", err);
      return this.mockMeeting(input, err instanceof Error ? err.message : String(err));
    }
  }

  private mockMeeting(input: CreateMeetingInput, reason?: string): MeetingInfo {
    // 生成 MOCK- 前缀占位会议号；不伪造可点击的假会议链接，人工补录后覆盖
    const mockId = `MOCK-${Math.floor(100000000 + Math.random() * 900000000)}`;
    return {
      meetingId: mockId,
      meetingLink: "",
      startTime: input.startTime,
      durationMinutes: input.durationMinutes ?? 60,
      mock: true,
      mockReason: reason,
    };
  }
}

/** 根据评审单构造默认会议主题与时段；主题文案由调用方给（各流程不同） */
export function defaultMeetingInput(
  review: { meetingStartTime?: string },
  topic: string,
  attendeeOpenIds: string[],
): CreateMeetingInput {
  const start = review.meetingStartTime ?? defaultNextWorkdaySlot();
  return {
    topic,
    startTime: start,
    durationMinutes: 60,
    attendeeOpenIds,
  };
}

function defaultNextWorkdaySlot(): string {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  // 默认明天 14:00
  tomorrow.setHours(14, 0, 0, 0);
  return tomorrow.toISOString();
}

// ---------- 会议预约路由（drawing-review / hardware-review 共用） ----------

/** 会议预约共用的最小依赖：流程服务的评审单读写 + 适配器的评审单回写 */
export interface ScheduleMeetingDeps<R extends { recordId: string; designerId: string; meetingStartTime?: string }> {
  flow: {
    getReview(reviewId: string): Promise<R | null>;
    startMeeting(reviewId: string, actorId: string, payload?: Record<string, unknown>): Promise<unknown>;
  };
  adapter: {
    updateReview(
      recordId: string,
      patch: { meetingId: string; meetingLink: string; meetingStartTime: string; updatedAt: string },
    ): Promise<unknown>;
  };
  /** 会议主题文案（各流程不同，如 新增机图纸评审 - 机型 - 版本） */
  topic: (review: R) => string;
}

/** 会议预约：建会 → 回写评审单会议信息 → 状态从 pending_review → in_review */
export async function handleScheduleMeeting<R extends { recordId: string; designerId: string; meetingStartTime?: string }>(
  request: Request,
  env: Env,
  deps: ScheduleMeetingDeps<R>,
  reviewId: string,
  actorId: string,
): Promise<Response> {
  const review = await deps.flow.getReview(reviewId);
  if (!review) return json({ error: "评审单不存在" }, 404);

  const body = (await readJson<{ startTime?: string; durationMinutes?: number; attendeeOpenIds?: string[] }>(request)) ?? {};
  const attendeeOpenIds = body.attendeeOpenIds ?? [review.designerId];
  const meetingInput = defaultMeetingInput(review, deps.topic(review), attendeeOpenIds);
  if (body.startTime) meetingInput.startTime = body.startTime;
  if (body.durationMinutes) meetingInput.durationMinutes = body.durationMinutes;

  const meetingService = new MeetingService(env, () => getTenantAccessToken(env));
  const info = await meetingService.createMeeting(meetingInput);

  await deps.adapter.updateReview(review.recordId, {
    meetingId: info.meetingId,
    meetingLink: info.meetingLink,
    meetingStartTime: info.startTime,
    updatedAt: new Date().toISOString(),
  });

  // 会议预约后，状态从 pending_review → in_review；mock 降级时把失败原因写进事件日志（PRD §13.2-4）
  const updated = await deps.flow.startMeeting(
    reviewId,
    actorId,
    info.mock ? { mock: true, reason: info.mockReason ?? "unknown" } : undefined,
  );

  return json({ meeting: info, review: updated });
}
