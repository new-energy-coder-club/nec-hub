/**
 * MCP 工具共享小件：命名规则与类型。
 */

/** 应用名 / Skill 名 / 资料 id 通用规则：小写字母/数字/连字符，须以字母或数字开头，2-41 字符 */
export const NAME_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

/** tools/call 调用上下文（handler 注入）；各工具按需取 request 或 hasMcpToken */
export interface McpToolCtx {
  request: Request;
  hasMcpToken: boolean;
}

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  [key: string]: unknown;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** 只读标记：未配置 MCP_TOKEN 的降级模式下仅放行 readOnly 工具 */
  readOnly?: boolean;
  impl: (args: Record<string, unknown>, env: Env, ctx: McpToolCtx) => Promise<McpToolResult>;
}
