/**
 * 一键拉会 MCP 工具：schedule_meeting（实现保留在 ../../meeting）
 */

import { toolScheduleMeeting } from "../../meeting";
import type { McpToolDef } from "./shared";

export const scheduleMeetingTool: McpToolDef = {
  name: "schedule_meeting",
  description:
    "一键拉会：创建飞书日历日程并自动生成视频会议（vc），返回会议链接；参会人支持队员姓名（按队员名单多维表解析 open_id）或直接传 ou_ 开头的 open_id，邀请后飞书自动发日程通知。鉴权：本人拉会传 user_token；管理端（MCP_TOKEN）可传 organizer（姓名/open_id）代拉会（需该成员登录过中台）。provider 目前仅支持 feishu（默认）；腾讯会议需企业 API 凭证，暂未接入。时间无时区按 Asia/Shanghai；典型用法：「明晚 7 点拉个图纸评审会，叫上张三、李四」→ title+start+attendees。",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "会议主题，如 R1 底盘图纸评审会" },
      start: {
        type: "string",
        description: "开始时间：\"2026-10-15 19:00\"（默认 +08:00）或 ISO 8601；也接受 epoch 秒/毫秒数字",
      },
      end: { type: "string", description: "结束时间（可选；缺省按 duration_minutes 推算）" },
      duration_minutes: { type: "number", description: "时长分钟数，默认 60，最小 5" },
      description: { type: "string", description: "会议描述/议程，写入日程正文" },
      attendees: {
        type: "array",
        items: { type: "string" },
        description: "参会人：队员姓名或 ou_ 开头的 open_id；姓名须在队员名单表中有 open_id",
      },
      provider: { type: "string", enum: ["feishu"], description: "会议提供方，默认 feishu" },
      user_token: { type: "string", description: "飞书 user_access_token；本人拉会必填（与 organizer 二选一）" },
      organizer: { type: "string", description: "管理端（MCP_TOKEN）专用：组织者姓名或 open_id，用其已绑定的授权代拉会" },
    },
    required: ["title", "start"],
  },
  impl: (args, env, ctx) => toolScheduleMeeting(args, env, ctx.hasMcpToken),
};

export const tools: McpToolDef[] = [scheduleMeetingTool];
