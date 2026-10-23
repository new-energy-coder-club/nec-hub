/**
 * 数据校验 MCP 工具：validate_bitable / config_validate_rules（FE-05）
 * 实现保留在 ../../validation/handlers，此处仅注册 schema 与分发。
 */

import { toolConfigValidateRules, toolValidateBitable } from "../../validation/handlers";
import type { McpToolDef } from "./shared";

export const validateBitableTool: McpToolDef = {
  name: "validate_bitable",
  description:
    "校验数据看板 4 张底表（队员名单/任务进度/物资台账/财务报销）的脏数据，输出按类型分组的异常清单（含多维表格记录直链与建议修复动作）。scope=mine 校验与本人相关的记录（需 user_token）；scope=all 全量校验仅队长/组长（需 user_token）或管理端 MCP_TOKEN，全量结果会覆盖门户「数据健康」展示的最新报告。规则为声明式 JSON（KV validate:rules），用 config_validate_rules 查看/更新。",
  inputSchema: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["mine", "all"], description: "mine=与本人相关（默认）｜all=全量（仅队长/组长或管理端）" },
      tables: {
        type: "array",
        items: { type: "string", enum: ["members", "tasks", "inventory", "finance"] },
        description: "可选：只校验指定表，默认 4 张全校",
      },
      user_token: { type: "string", description: "可选：飞书 user_access_token；无 MCP_TOKEN 时必填" },
    },
  },
  impl: (args, env, ctx) => toolValidateBitable(args, env, ctx.hasMcpToken),
};

export const configValidateRulesTool: McpToolDef = {
  name: "config_validate_rules",
  description:
    "配置/查看数据校验规则集（FE-05，声明式 JSON 存 KV，新增规则无需改代码）。action=get 查看当前生效规则；action=set 整体替换（rules 为规则数组，字段：id/table/type/description/fieldPatterns/check/pattern/values/field2Patterns/pattern2/threshold/suggestion/enabled）；action=reset 恢复内置默认规则。",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", description: "get（默认）| set | reset" },
      rules: { type: "array", description: "set 时必填：规则数组（整体替换）", items: { type: "object" } },
    },
  },
  impl: (args, env) => toolConfigValidateRules(args, env),
};

export const tools: McpToolDef[] = [validateBitableTool, configValidateRulesTool];
