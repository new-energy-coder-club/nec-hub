/**
 * 审批与通知 MCP 工具：submit_approval / list_todos / send_notice / config_flows
 * 实现保留在 ../../approvals/handlers（与 HTTP 审批接口共用），此处仅注册 schema 与分发。
 */

import { toolConfigFlows, toolListTodos, toolSendNotice, toolSubmitApproval } from "../../approvals/handlers";
import type { McpToolDef } from "./shared";

export const submitApprovalTool: McpToolDef = {
  name: "submit_approval",
  description:
    "代发起审批申请（Agent 帮队员代提交，需管理端 MCP_TOKEN）。type 限 4 枚举；fields 按 flows:config 的声明式规则校验；applicant_open_id 可指定申请人（缺省 mcp-admin）。",
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", description: "reimburse | drawing | hardware | compliance" },
      fields: { type: "object", description: "业务字段（与底表字段名一致），如 {\"事项\":\"打样\",\"报销金额\":120}" },
      applicant_name: { type: "string", description: "可选：申请人姓名（缺省取 fields.applicant_open_id 或 mcp-admin）" },
    },
    required: ["type", "fields"],
  },
  impl: (args, env, ctx) => toolSubmitApproval(args, env, ctx.hasMcpToken),
};

export const listTodosTool: McpToolDef = {
  name: "list_todos",
  readOnly: true,
  description:
    "拉取指定用户的待办聚合（各流程底表中 审批中 且待其审批的单 + 逾期任务，按流程分组）。需管理端 MCP_TOKEN；角色由 open_id 查队员名单表解析。",
  inputSchema: {
    type: "object",
    properties: {
      open_id: { type: "string", description: "飞书 open_id（ou 开头）" },
    },
    required: ["open_id"],
  },
  impl: (args, env, ctx) => toolListTodos(args, env, ctx.hasMcpToken),
};

export const sendNoticeTool: McpToolDef = {
  name: "send_notice",
  description:
    "向指定流程发送通知（需管理端 MCP_TOKEN）。channel=bot 走飞书群机器人（webhook 未配置返回降级说明，失败重试 2 次并记录 notify:failed）；channel=mail 走飞书邮箱（G-05，需配置 MAIL_SENDER_OPEN_ID 且发信人已授权，收件人用 to 或 env MAIL_TO）；channel=both 双通道。",
  inputSchema: {
    type: "object",
    properties: {
      flow: { type: "string", description: "reimburse | drawing | hardware | compliance（bot 通道决定用哪个群 webhook，未配置 fallback 主群）" },
      title: { type: "string", description: "标题" },
      content: { type: "string", description: "正文" },
      link: { type: "string", description: "可选：去处理链接" },
      channel: { type: "string", enum: ["bot", "mail", "both"], description: "通知通道，默认 bot" },
      to: { type: "string", description: "channel 含 mail 时的收件人，逗号分隔多个；缺省用 env MAIL_TO" },
    },
    required: ["flow", "title", "content"],
  },
  impl: (args, env, ctx) => toolSendNotice(args, env, ctx.hasMcpToken),
};

export const configFlowsTool: McpToolDef = {
  name: "config_flows",
  description:
    "查看/修改审批流程配置 flows:config（底表 tableId/base、单号前缀、审批角色、必填与条件必填校验规则、金额会签阈值）。action=set 深合并写入；tableId 须 tbl 开头或留空。仅管理端（MCP_TOKEN）。",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", description: "get（默认）| set" },
      flows: { type: "object", description: "set 时必填：{ reimburse: { tableId, base, ... } }，只传要改的字段" },
    },
  },
  impl: (args, env, ctx) => toolConfigFlows(args, env, ctx.hasMcpToken),
};

export const tools: McpToolDef[] = [submitApprovalTool, listTodosTool, sendNoticeTool, configFlowsTool];
