/**
 * 首页布局 MCP 工具：set_home_layout（FE-06/FE-07；实现保留在 ../../home/handlers）
 */

import { toolSetHomeLayout } from "../../home/handlers";
import type { McpToolDef } from "./shared";

export const setHomeLayoutTool: McpToolDef = {
  name: "set_home_layout",
  description:
    "配置门户「我的首页」布局（FE-06 千人千面 / FE-07 组别默认首页）。白名单制：只允许组合预置组件（my-apps 我的应用快捷区 / my-tasks 我的任务 / my-reimburse 我的报销状态 / docs 常用资料 / goals 赛季目标 / inventory 物资查询），按 widgets 数组顺序渲染，禁止自由 HTML。action=set（默认）写入布局；action=get 查看当前生效布局（个人 > 组 > 全员默认三层回退）；action=reset 恢复默认（删个人配置）。scope=user（默认，绑定调用者本人，存 KV home:<open_id>）；scope=group 配置组别默认首页（存 home:group:<组名>，需组长/队长角色，组长只能配置本组）。鉴权：提供 user_token（飞书 user_access_token）绑定本人；管理端 MCP_TOKEN 可用 open_id 直接指定用户。典型用法：用户说「把物资查询放到最上面，加我的未完成任务」→ 解析为 widgets 数组后调用本工具。",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["set", "get", "reset"], description: "set（默认）| get | reset" },
      scope: { type: "string", enum: ["user", "group"], description: "user=本人（默认）| group=组别默认首页（需组长/队长）" },
      group: { type: "string", description: "scope=group 时的组名；缺省取调用者在队员名单中的组别" },
      widgets: {
        type: "array",
        description: "set 时必填：组件数组，元素为组件 id 字符串或 {id, title?}；白名单：my-apps / my-tasks / my-reimburse / docs / goals / inventory",
        items: {
          anyOf: [
            { type: "string", enum: ["my-apps", "my-tasks", "my-reimburse", "docs", "goals", "inventory"] },
            {
              type: "object",
              properties: {
                id: { type: "string", enum: ["my-apps", "my-tasks", "my-reimburse", "docs", "goals", "inventory"] },
                title: { type: "string", description: "可选：覆盖组件默认标题" },
              },
              required: ["id"],
            },
          ],
        },
      },
      user_token: { type: "string", description: "飞书 user_access_token；无 MCP_TOKEN 时必填" },
      open_id: { type: "string", description: "管理端（MCP_TOKEN）专用：直接指定目标用户 open_id" },
    },
  },
  impl: (args, env, ctx) => toolSetHomeLayout(args, env, ctx.hasMcpToken),
};
