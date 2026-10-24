/**
 * MCP 工具注册表：每个工具在 src/mcp/tools/ 对应域文件内同处定义
 * { name, description, inputSchema, impl, readOnly }，此处只做装配与派生。
 * tools/list 输出、tools/call 分发、降级模式只读集合均由本注册表单一来源生成。
 */

import { tools as approvalsTools } from "./tools/approvals";
import { tools as appsTools } from "./tools/apps";
import { tools as bitableConfigTools } from "./tools/bitable-config";
import { tools as bitableInventoryTools } from "./tools/bitable-inventory";
import { tools as bitableProgressTools } from "./tools/bitable-progress";
import { tools as bitableQueryTools } from "./tools/bitable-query";
import { tools as bitableSetupTools } from "./tools/bitable-setup";
import { tools as docsTools } from "./tools/docs";
import { tools as domainsTools } from "./tools/domains";
import { tools as homeTools } from "./tools/home";
import { tools as mailTools } from "./tools/mail";
import { tools as meetingTools } from "./tools/meeting";
import { tools as moduleConfigTools } from "./tools/module-config";
import { tools as prdTools } from "./tools/prd";
import type { McpToolDef } from "./tools/shared";
import { tools as skillsTools } from "./tools/skills";
import { tools as validationTools } from "./tools/validation";
import { tools as whoamiTools } from "./tools/whoami";

export type { McpToolCtx, McpToolDef, McpToolResult } from "./tools/shared";

// docs 与 approvals 的历史顺序被其他域隔开，按工具名显式装配（不依赖数组位置），tools/list 顺序保持不变。
function byName(tools: McpToolDef[], name: string): McpToolDef {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`MCP 工具未定义：${name}`);
  return tool;
}

export const TOOL_REGISTRY: McpToolDef[] = [
  ...appsTools,
  ...skillsTools,
  ...bitableQueryTools,
  ...bitableInventoryTools,
  ...bitableConfigTools,
  ...moduleConfigTools,
  byName(docsTools, "publish_doc"),
  ...bitableProgressTools,
  ...validationTools,
  ...meetingTools,
  ...whoamiTools,
  ...homeTools,
  byName(docsTools, "remove_docs"),
  ...bitableSetupTools,
  ...prdTools,
  byName(approvalsTools, "submit_approval"),
  byName(approvalsTools, "list_todos"),
  byName(approvalsTools, "send_notice"),
  ...mailTools,
  byName(approvalsTools, "config_flows"),
  ...domainsTools,
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
