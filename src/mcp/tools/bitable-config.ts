import { DASH_TABLES, getDashboardConfig, type DashboardConfig } from "../../dashboard";
import { KV_KEYS } from "../../shared/kv-keys";
import { BITABLE_BASE_RE, BITABLE_TABLE_ID_RE } from "../../shared/module-config";
import type { McpToolDef } from "./shared";

export async function toolConfigDashboard(args: Record<string, unknown>, env: Env) {
  const action = String(args.action ?? "get");
  if (action === "get") {
    const cfg = await getDashboardConfig(env);
    return {
      content: [
        {
          type: "text",
          text: cfg
            ? `当前看板配置：\n${JSON.stringify(cfg, null, 2)}`
            : "尚未配置。用 action=set 写入：base = 多维表格 app_token（URL 中 /base/ 后的一段），tables = 逻辑表名到 table_id 的映射。",
        },
      ],
    };
  }
  if (action !== "set") throw new Error("action 必须是 get | set");

  const base = String(args.base ?? "").trim();
  if (!BITABLE_BASE_RE.test(base)) {
    throw new Error("base 不合法：应为飞书多维表格 URL 中 /base/ 后的 app_token（10 位以上字母数字串）");
  }
  const rawTables = (args.tables ?? {}) as Record<string, unknown>;
  const tables: DashboardConfig["tables"] = {};
  for (const key of DASH_TABLES) {
    const v = String(rawTables[key] ?? "").trim();
    if (v) {
      if (!BITABLE_TABLE_ID_RE.test(v)) {
        throw new Error(`table_id 不合法（${key}）：应以 tbl 开头，如 tblsH8aOxxx`);
      }
      tables[key] = v;
    }
  }
  if (Object.keys(tables).length === 0) {
    throw new Error("tables 至少提供一张表：members / tasks / inventory / finance / goals → table_id");
  }
  const cfg: DashboardConfig = { base, tables, updatedAt: new Date().toISOString() };
  await env.REGISTRY.put(KV_KEYS.dashboardConfig, JSON.stringify(cfg));
  // 配置变更后清掉旧缓存，让下一次读取拉最新数据
  await Promise.all(DASH_TABLES.map((k) => env.REGISTRY.delete(KV_KEYS.dashboardCache(k))));
  return {
    content: [
      {
        type: "text",
        text: `✅ 数据看板配置已保存：base=${base}，共 ${Object.keys(tables).length} 张表（${Object.keys(tables).join(" / ")}）。\n打开门户「数据看板」Tab 或 GET /api/dashboard 验证渲染。`,
      },
    ],
  };
}

export const configDashboardTool: McpToolDef = {
  name: "config_dashboard",
  description:
    "配置/查看数据看板对接的飞书多维表格。action=set 写入 base（app_token）与 tables（逻辑表名→table_id），action=get 查看当前配置。写入后自动清空看板缓存。",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", description: "get（默认）| set" },
      base: { type: "string", description: "set 时必填：多维表格 app_token（URL 中 /base/ 后的一段）" },
      tables: {
        type: "object",
        description: "set 时必填：如 {\"tasks\":\"tblxxxx\",\"inventory\":\"tblxxxx\"}",
        properties: {
          members: { type: "string", description: "队员名单表 table_id" },
          tasks: { type: "string", description: "任务进度表 table_id" },
          inventory: { type: "string", description: "物资台账表 table_id" },
          finance: { type: "string", description: "财务报销表 table_id" },
          goals: { type: "string", description: "赛季目标表 table_id（FE-04 目标面板；字段：目标/关键结果/负责组/截止日期/完成度%/状态）" },
        },
      },
    },
  },
  impl: (args, env) => toolConfigDashboard(args, env),
};

export const tools: McpToolDef[] = [configDashboardTool];
