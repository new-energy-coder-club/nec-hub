/**
 * 一键拉会（schedule_meeting）：创建飞书日历日程并自动生成视频会议
 *
 * 链路：解析组织者身份（user_token 直传，或管理端指定 organizer 走 KV 已绑定 token）
 * → 取主日历 → 创建日程（vchat.vc_type=vc 自动生成视频会议，返回 meeting_url）
 * → 按姓名/open_id 拉参会人（姓名经队员名单多维表解析）。
 * 时间解析：无时区时按 Asia/Shanghai（+08:00）。
 */

import { validateUserToken } from "../auth/feishu-auth";
import { FEISHU_API } from "../feishu/client";
import { resolveOpenIds } from "../feishu/member-directory";
import { getUserAccessToken } from "../feishu/user-token";

const DEFAULT_DURATION_MIN = 60;

/** 解析开始/结束时间为 epoch 毫秒；无时区按 +08:00 */
function parseMeetingTime(input: unknown, label: string): number {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input > 1e12 ? Math.floor(input) : Math.floor(input * 1000); // 兼容秒/毫秒
  }
  const s = String(input ?? "").trim();
  if (!s) throw new Error(`${label} 不能为空`);
  let norm = s.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(norm)) norm += ":00";
  if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(norm)) norm += "+08:00";
  const t = Date.parse(norm);
  if (Number.isNaN(t)) {
    throw new Error(`无法解析${label}：${s}（支持 "2026-10-14 19:00" 或 ISO 8601）`);
  }
  return t;
}

interface FeishuApiResp {
  code?: number;
  msg?: string;
  data?: Record<string, unknown>;
}

async function feishuCall(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${FEISHU_API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = (await resp.json()) as FeishuApiResp;
  if (data.code !== 0) {
    throw new Error(`飞书接口失败（${path}）：${data.msg ?? `code ${data.code}`}`);
  }
  return data.data ?? {};
}

export async function toolScheduleMeeting(
  args: Record<string, unknown>,
  env: Env,
  hasMcpToken: boolean,
) {
  const title = String(args.title ?? "").trim();
  if (!title) throw new Error("title（会议主题）不能为空");
  const startMs = parseMeetingTime(args.start, "开始时间 start");
  const endMs = args.end
    ? parseMeetingTime(args.end, "结束时间 end")
    : startMs + Math.max(5, Number(args.duration_minutes ?? DEFAULT_DURATION_MIN)) * 60e3;
  if (endMs <= startMs) throw new Error("结束时间必须晚于开始时间");

  // 1. 组织者身份：user_token 直传；或管理端 MCP_TOKEN 指定 organizer（姓名/open_id），用其登录时绑定的 token
  let organizerName = "";
  let organizerToken: string;
  const userToken = String(args.user_token ?? "").trim();
  if (userToken) {
    const u = await validateUserToken(userToken);
    organizerName = u.name;
    organizerToken = userToken;
  } else if (hasMcpToken && args.organizer) {
    const o = String(args.organizer).trim();
    const { resolved, missing } = await resolveOpenIds(env, [o]);
    const openId = resolved[0]?.openId;
    if (!openId) {
      throw new Error(
        ` organizer 未解析：${missing.join("、")}（传 ou_ 开头的 open_id，或队员名单里的姓名）`.trim(),
      );
    }
    const stored = await getUserAccessToken(env, openId);
    if (!stored) {
      throw new Error(`组织者 ${resolved[0].name} 未登录过中台或授权已过期：请其先在中台门户登录一次`);
    }
    organizerName = resolved[0].name;
    organizerToken = stored;
  } else {
    throw new Error("缺少组织者身份：传 user_token（本人拉会）；管理端可传 organizer（姓名或 open_id）");
  }

  // 2. 主日历
  const primary = await feishuCall("GET", "/calendar/v4/calendars/primary", organizerToken);
  const calendars = (primary.calendars ?? []) as Array<{ calendar?: { calendar_id?: string } }>;
  const calendarId = calendars[0]?.calendar?.calendar_id;
  if (!calendarId) throw new Error("未拿到组织者主日历（calendar_id 为空）");

  // 3. 创建日程 + 视频会议
  const event = (
    await feishuCall("POST", `/calendar/v4/calendars/${calendarId}/events`, organizerToken, {
      summary: title,
      description: String(args.description ?? ""),
      start_time: { timestamp: String(Math.floor(startMs / 1000)), timezone: "Asia/Shanghai" },
      end_time: { timestamp: String(Math.floor(endMs / 1000)), timezone: "Asia/Shanghai" },
      vchat: { vc_type: "vc" },
    })
  ).event as Record<string, unknown> | undefined;
  const eventId = String(event?.event_id ?? "");
  const vchat = (event?.vchat ?? {}) as { meeting_url?: string };
  const meetingUrl = vchat.meeting_url ?? "";

  // 4. 拉参会人（失败不阻塞，会议已建好）
  const attendeeInputs = Array.isArray(args.attendees) ? (args.attendees as unknown[]).map(String) : [];
  const attendees = await resolveOpenIds(env, attendeeInputs);
  let invited = 0;
  let inviteError = "";
  if (attendees.resolved.length > 0 && eventId) {
    try {
      await feishuCall(
        "POST",
        `/calendar/v4/calendars/${calendarId}/events/${eventId}/attendees?user_id_type=open_id`,
        organizerToken,
        {
          attendees: attendees.resolved.map((a) => ({ type: "user", user_id: a.openId })),
          need_notification: true,
        },
      );
      invited = attendees.resolved.length;
    } catch (err) {
      inviteError = err instanceof Error ? err.message : String(err);
    }
  }

  const fmt = (ms: number) =>
    new Date(ms).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  const lines = [
    `✅ 会议已创建：${title}`,
    `时间：${fmt(startMs)} ~ ${fmt(endMs)}（Asia/Shanghai）`,
    meetingUrl ? `会议链接：${meetingUrl}` : "会议链接：飞书日程已带视频会议，打开日程即可入会",
    `组织者：${organizerName || "本人"}`,
  ];
  if (invited > 0) lines.push(`已邀请 ${invited} 人：${attendees.resolved.map((a) => a.name).join("、")}`);
  if (attendees.missing.length > 0) {
    lines.push(`⚠️ 未匹配到 open_id，未邀请：${attendees.missing.join("、")}（可在队员名单补 open_id 或直接传 ou_ ID）`);
  }
  if (inviteError) lines.push(`⚠️ 邀请参会人失败（日程已创建）：${inviteError}`);
  return { content: [{ type: "text", text: lines.join("\n") }] };
}
