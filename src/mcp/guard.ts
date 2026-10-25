/**
 * 管理端 MCP 工具统一鉴权闸门（fail-closed）。
 *
 * handleMcp 入口根据 MCP_TOKEN（Bearer，timingSafeEqual）判定 hasMcpToken；
 * 所有管理级写工具必须在执行任何业务逻辑前调用本闸门，未持令牌一律抛错。
 */
export function requireMcpToken(hasMcpToken: boolean, toolName: string): void {
  if (!hasMcpToken) {
    throw new Error(`${toolName} 仅管理端可用（需 MCP_TOKEN）`);
  }
}