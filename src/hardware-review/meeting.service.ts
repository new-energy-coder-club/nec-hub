/**
 * 硬件评审流程 — 会议集成服务
 *
 * 与 drawing-review 相同：调用飞书视频会议 API 创建会议，
 * 未开通 vc:meeting:write 权限时降级返回 mock 会议信息。
 */

import type { HardwareReview } from "./types";

const FEISHU_MEETING_API = "https://open.feishu.cn/open-apis/vc/v1";

export interface MeetingInfo {
  meetingId: string;
  meetingLink: string;
  startTime: string;
  durationMinutes: number;
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
        console.warn("[meeting] create meeting failed, fallback to mock:", data.msg);
        return this.mockMeeting(input, data.msg);
      }
      const meeting = data.data.meeting;
      return {
        meetingId: meeting.meeting_id,
        meetingLink: meeting.join_url ?? meeting.url ?? "",
        startTime: input.startTime,
        durationMinutes: duration,
      };
    } catch (err) {
      console.warn("[meeting] network error, fallback to mock:", err);
      return this.mockMeeting(input, err instanceof Error ? err.message : String(err));
    }
  }

  private mockMeeting(input: CreateMeetingInput, reason?: string): MeetingInfo {
    const mockId = `mock-${Math.floor(100000000 + Math.random() * 900000000)}`;
    return {
      meetingId: mockId,
      meetingLink: `https://meeting.tencent.com/dm/${mockId}`,
      startTime: input.startTime,
      durationMinutes: input.durationMinutes ?? 60,
    };
  }
}

/** 根据评审单构造默认会议主题与时段 */
export function defaultMeetingInput(review: HardwareReview, attendeeOpenIds: string[]): CreateMeetingInput {
  const start = review.meetingStartTime ?? defaultNextWorkdaySlot();
  return {
    topic: `硬件评审 - ${review.hardwareName} - ${review.hardwareVersion}`,
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
