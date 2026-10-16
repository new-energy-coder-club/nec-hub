/**
 * MCP 工具注册表：每个工具在 src/mcp/tools/ 对应域文件内同处定义
 * { name, description, inputSchema, impl, readOnly }，此处只做装配与派生。
 * tools/list 输出、tools/call 分发、降级模式只读集合均由本注册表单一来源生成。
 */

import { configFlowsTool, listTodosTool, sendNoticeTool, submitApprovalTool } from "./tools/approvals";
import { deployAppTool, registerAppTool, syncVercelTool } from "./tools/apps";
import {
  addRecordsTool,
  configDashboardTool,
  queryBitableTool,
  setupBitableTool,
  updateInventoryTool,
  updateProgressTool,
} from "./tools/bitable";
import { publishDocTool, removeDocsTool } from "./tools/docs";
import { applyDomainTool, releaseDomainTool } from "./tools/domains";
import { setHomeLayoutTool } from "./tools/home";
import { sendMailTool } from "./tools/mail";
import { scheduleMeetingTool } from "./tools/meeting";
import {
  configContractApprovalTool,
  configDrawingReviewTool,
  configHardwareReviewTool,
} from "./tools/module-config";
import { updatePrdTool } from "./tools/prd";
import type { McpToolDef } from "./tools/shared";
import { importSkillsTool, publishSkillTool, removeSkillsTool } from "./tools/skills";
import { configValidateRulesTool, validateBitableTool } from "./tools/validation";
import { whoamiTool } from "./tools/whoami";

export type { McpToolCtx, McpToolDef, McpToolResult } from "./tools/shared";

export const TOOL_REGISTRY: McpToolDef[] = [
  deployAppTool,
  registerAppTool,
  syncVercelTool,
  importSkillsTool,
  removeSkillsTool,
  publishSkillTool,
  queryBitableTool,
  updateInventoryTool,
  configDashboardTool,
  configDrawingReviewTool,
  configHardwareReviewTool,
  configContractApprovalTool,
  publishDocTool,
  updateProgressTool,
  validateBitableTool,
  configValidateRulesTool,
  scheduleMeetingTool,
  whoamiTool,
  setHomeLayoutTool,
  removeDocsTool,
  addRecordsTool,
  setupBitableTool,
  updatePrdTool,
  submitApprovalTool,
  listTodosTool,
  sendNoticeTool,
  sendMailTool,
  configFlowsTool,
  applyDomainTool,
  releaseDomainTool,
];

/** tools/list 输出（仅协议三字段，不含 impl/readOnly 内部标记） */
export const TOOLS = TOOL_REGISTRY.map(({ name, description, inputSchema }) => ({
  name,
  description,
  inputSchema,
}));

/** 降级模式（未配置 MCP_TOKEN）下放行的只读工具集合，由注册表 readOnly 标记派生 */
export const READONLY_TOOLS: ReadonlySet<string> = new Set(
  TOOL_REGISTRY.filter((t) => t.readOnly).map((t) => t.name),
);

const TOOL_BY_NAME = new Map(TOOL_REGISTRY.map((t) => [t.name, t]));

export function findTool(name: string): McpToolDef | undefined {
  return TOOL_BY_NAME.get(name);
}
