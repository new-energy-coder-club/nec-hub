/**
 * PRD 看板 MCP 工具：update_prd（实现保留在 ../../prd，与 HTTP 接口共用）
 */

import { toolUpdatePrd } from "../../prd";
import type { McpToolDef } from "./shared";

export const updatePrdTool: McpToolDef = {
  name: "update_prd",
  description:
    "更新 PRD 看板需求状态（done | partial | pending | todo），门户「PRD 看板」Tab 实时同步；状态变化会推飞书群（webhook 已配置时）。仅管理端（MCP_TOKEN）可用。",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "需求编号：FE-01 ~ FE-18（FE-17/FE-18 为子项，分别挂在 FE-09/FE-04 下）" },
      status: { type: "string", description: "done | partial | pending | todo" },
      note: { type: "string", description: "可选：备注（覆盖旧备注）" },
    },
    required: ["id", "status"],
  },
  impl: (args, env, ctx) => toolUpdatePrd(args, env, ctx.hasMcpToken),
};

export const tools: McpToolDef[] = [updatePrdTool];
