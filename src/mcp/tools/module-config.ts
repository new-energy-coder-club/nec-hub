/**
 * 模块配置 MCP 工具（config_drawing_review / config_hardware_review / config_contract_approval）
 *
 * 三个工具流程完全一致：get 读配置 → set 校验 base/tables 并写入；差异仅在文案与逻辑表名清单，
 * 用工厂参数化。所有文案（含硬件评审 get 文案结尾的原有空格）逐字保持与原实现一致。
 * config_dashboard 形状不同（写后清看板缓存、无动态 import），不在此合并。
 */

import type { McpToolDef } from "./shared";

interface ModuleConfigLike {
  base: string;
  tables: Record<string, string | undefined>;
}

interface ModuleConfigToolSpec<Cfg extends ModuleConfigLike> {
  /** 流程显示名（get/success 文案用），如「新增机图纸评审流程」 */
  label: string;
  /** 业务模块的 HTTP 配置接口路径（成功提示文案用） */
  apiPath: string;
  /** 逻辑表名白名单（set 时按此过滤与校验，顺序即原实现声明顺序） */
  tableKeys: readonly string[];
  /** set 时 tables 为空的错误提示（各模块原文不同，逐字保留） */
  emptyTablesError: string;
  /** get 且已配置时的文案（硬件评审原文在 JSON 后多一个空格，逐字保留） */
  configuredText: (cfgJson: string) => string;
  /** 延迟加载模块配置读写（保持各业务模块的动态 import 懒加载） */
  load: () => Promise<{
    get: (env: Env) => Promise<Cfg | null>;
    set: (env: Env, cfg: { base: string; tables: Record<string, string> }) => Promise<Cfg>;
  }>;
}

export function createModuleConfigTool<Cfg extends ModuleConfigLike>(spec: ModuleConfigToolSpec<Cfg>) {
  return async function toolConfigModule(args: Record<string, unknown>, env: Env) {
    const action = String(args.action ?? "get");
    if (action === "get") {
      const cfg = await (await spec.load()).get(env);
      return {
        content: [
          {
            type: "text",
            text: cfg
              ? spec.configuredText(JSON.stringify(cfg, null, 2))
              : "尚未配置。用 action=set 写入：base = 多维表格 app_token（URL 中 /base/ 后的一段），tables = 逻辑表名到 table_id 的映射。",
          },
        ],
      };
    }
    if (action !== "set") throw new Error("action 必须是 get | set");

    const base = String(args.base ?? "").trim();
    if (!/^[A-Za-z0-9]{10,}$/.test(base)) {
      throw new Error("base 不合法：应为飞书多维表格 URL 中 /base/ 后的 app_token（10 位以上字母数字串）");
    }
    const rawTables = (args.tables ?? {}) as Record<string, unknown>;
    const tables: Record<string, string> = {};
    for (const key of spec.tableKeys) {
      const v = String(rawTables[key] ?? "").trim();
      if (v) {
        if (!/^tbl[A-Za-z0-9]+$/.test(v)) {
          throw new Error(`table_id 不合法（${key}）：应以 tbl 开头，如 tblsH8aOxxx`);
        }
        tables[key] = v;
      }
    }
    if (Object.keys(tables).length === 0) {
      throw new Error(spec.emptyTablesError);
    }
    await (await spec.load()).set(env, { base, tables });
    return {
      content: [
        {
          type: "text",
          text: `✅ ${spec.label}配置已保存：base=${base}，共 ${Object.keys(tables).length} 张表（${Object.keys(tables).join(" / ")}）。\n可调用 GET ${spec.apiPath} 或继续调用 API 验证。`,
        },
      ],
    };
  };
}

// ---------- 新增机图纸评审流程配置 ----------

export const toolConfigDrawingReview = createModuleConfigTool({
  label: "新增机图纸评审流程",
  apiPath: "/api/drawing-review/config",
  tableKeys: ["reviews", "minutes", "rectifications", "bom", "assessments", "inventory", "delivery", "schedule", "inquiries", "events"],
  emptyTablesError: "tables 至少提供一张表：reviews / minutes / rectifications / bom / ... → table_id",
  configuredText: (cfgJson) => `当前新增机图纸评审流程配置：\n${cfgJson}`,
  load: async () => {
    const m = await import("../../drawing-review/config");
    return { get: m.getDrawingReviewConfig, set: m.setDrawingReviewConfig };
  },
});

// ---------- 硬件评审流程配置 ----------

export const toolConfigHardwareReview = createModuleConfigTool({
  label: "硬件评审流程",
  apiPath: "/api/hardware-review/config",
  tableKeys: ["reviews", "minutes", "rectifications", "reports", "events"],
  emptyTablesError: "tables 至少提供一张表：reviews / minutes / rectifications / reports / events → table_id",
  configuredText: (cfgJson) => `当前硬件评审流程配置：\n${cfgJson} `,
  load: async () => {
    const m = await import("../../hardware-review/config");
    return { get: m.getHardwareReviewConfig, set: m.setHardwareReviewConfig };
  },
});

// ---------- 合同审批流程配置 ----------

export const toolConfigContractApproval = createModuleConfigTool({
  label: "合同审批流程",
  apiPath: "/api/contract-approval/config",
  tableKeys: ["approvals", "comments", "events"],
  emptyTablesError: "tables 至少提供一张表：approvals / comments / events → table_id",
  configuredText: (cfgJson) => `当前合同审批流程配置：\n${cfgJson}`,
  load: async () => {
    const m = await import("../../contract-approval/config");
    return { get: m.getContractApprovalConfig, set: m.setContractApprovalConfig };
  },
});

export const configDrawingReviewTool: McpToolDef = {
  name: "config_drawing_review",
  description:
    "配置/查看新增机图纸评审流程对接的飞书多维表格。action=set 写入 base（app_token）与 tables（逻辑表名→table_id），action=get 查看当前配置。",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", description: "get（默认）| set" },
      base: { type: "string", description: "set 时必填：多维表格 app_token（URL 中 /base/ 后的一段）" },
      tables: {
        type: "object",
        description: "set 时必填：如 {\"reviews\":\"tblxxxx\",\"minutes\":\"tblxxxx\"}",
        properties: {
          reviews: { type: "string", description: "图纸评审单表 table_id" },
          minutes: { type: "string", description: "会议纪要表 table_id" },
          rectifications: { type: "string", description: "整改项表 table_id" },
          bom: { type: "string", description: "BOM 清单表 table_id" },
          assessments: { type: "string", description: "评估报告表 table_id" },
          inventory: { type: "string", description: "库存查询结果表 table_id" },
          delivery: { type: "string", description: "发货清单表 table_id" },
          schedule: { type: "string", description: "排期任务表 table_id" },
          inquiries: { type: "string", description: "询价单表 table_id" },
          events: { type: "string", description: "流程事件日志表 table_id" },
        },
      },
    },
  },
  impl: (args, env) => toolConfigDrawingReview(args, env),
};

export const configHardwareReviewTool: McpToolDef = {
  name: "config_hardware_review",
  description:
    "配置/查看硬件评审流程对接的飞书多维表格。action=set 写入 base（app_token）与 tables（逻辑表名→table_id），action=get 查看当前配置。",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", description: "get（默认）| set" },
      base: { type: "string", description: "set 时必填：多维表格 app_token（URL 中 /base/ 后的一段）" },
      tables: {
        type: "object",
        description: "set 时必填：如 {\"reviews\":\"tblxxxx\",\"minutes\":\"tblxxxx\"}",
        properties: {
          reviews: { type: "string", description: "硬件评审单表 table_id" },
          minutes: { type: "string", description: "会议纪要表 table_id" },
          rectifications: { type: "string", description: "整改项表 table_id" },
          reports: { type: "string", description: "评审报告表 table_id" },
          events: { type: "string", description: "流程事件日志表 table_id" },
        },
      },
    },
  },
  impl: (args, env) => toolConfigHardwareReview(args, env),
};

export const configContractApprovalTool: McpToolDef = {
  name: "config_contract_approval",
  description:
    "配置/查看合同审批流程对接的飞书多维表格。action=set 写入 base（app_token）与 tables（逻辑表名→table_id），action=get 查看当前配置。",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", description: "get（默认）| set" },
      base: { type: "string", description: "set 时必填：多维表格 app_token（URL 中 /base/ 后的一段）" },
      tables: {
        type: "object",
        description: "set 时必填：如 {\"approvals\":\"tblxxxx\",\"comments\":\"tblxxxx\"}",
        properties: {
          approvals: { type: "string", description: "合同审批单表 table_id" },
          comments: { type: "string", description: "审批评论表 table_id" },
          events: { type: "string", description: "流程事件日志表 table_id" },
        },
      },
    },
    required: ["action"],
  },
  impl: (args, env) => toolConfigContractApproval(args, env),
};
