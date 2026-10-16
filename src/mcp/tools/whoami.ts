/**
 * 身份自检 MCP 工具：whoami
 */

import { validateUserToken } from "../../auth/feishu-auth";
import { resolveUserRole } from "../../auth/role";
import type { McpToolDef } from "./shared";

/** whoami：验证调用者身份（C 组移植自 main；管理端 MCP_TOKEN 或 user_token 二选一） */
export async function toolWhoami(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (hasMcpToken && !args.user_token) {
    return { content: [{ type: "text", text: "✅ 管理端身份：MCP_TOKEN 持有者（全部权限，finance 表不受限）" }] };
  }
  const userToken = String(args.user_token ?? "").trim();
  if (!userToken) {
    throw new Error("无法识别身份：调用未携带 MCP_TOKEN，且未传 user_token");
  }
  const { openId, name } = await validateUserToken(userToken);
  const role = await resolveUserRole(env, { name, open_id: openId });
  return {
    content: [
      {
        type: "text",
        text:
          `✅ 身份验证通过：${name}（open_id: ${openId}）\n` +
          `角色：${role.role}${role.group ? ` · ${role.group}` : ""}` +
          (role.matched ? "" : "（未在队员名单表匹配到，按 external 处理）"),
      },
    ],
  };
}

export const whoamiTool: McpToolDef = {
  name: "whoami",
  readOnly: true,
  description:
    "验证当前调用者身份（接入 Prompt 自检用）。管理端（Bearer MCP_TOKEN）直接返回 admin；或传 user_token（飞书 user_access_token）返回 open_id/姓名/角色（角色按队员名单多维表实时判定并带 60s 缓存）。",
  inputSchema: {
    type: "object",
    properties: {
      user_token: { type: "string", description: "可选：飞书 user_access_token；不传且无 MCP_TOKEN 时报错" },
    },
  },
  impl: (args, env, ctx) => toolWhoami(args, env, ctx.hasMcpToken),
};
