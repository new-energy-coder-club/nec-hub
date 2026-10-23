import { validateUserToken } from "../../auth/feishu-auth";
import { canSeeFinanceDetail, resolveUserRole } from "../../auth/role";
import { DASH_TABLES, getDashboardConfig, type DashTable } from "../../dashboard";
import { getTenantAccessToken, listBitableRecords } from "../../feishu/bitable";
import type { McpToolDef } from "./shared";

export async function toolQueryBitable(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  const table = String(args.table ?? "") as DashTable;
  if (!DASH_TABLES.includes(table)) {
    throw new Error("table 必须是 members | tasks | inventory | finance | goals 之一");
  }
  // finance 表按角色受限：管理端（持 MCP_TOKEN）或持有效 user_token 且角色为队长/财务
  if (table === "finance" && !hasMcpToken) {
    const userToken = String(args.user_token ?? "").trim();
    if (!userToken) {
      throw new Error("finance 表受限：请提供 user_token（飞书 user_access_token，角色需为队长/财务），或由配置了 MCP_TOKEN 的管理端调用");
    }
    const { openId } = await validateUserToken(userToken);
    const role = await resolveUserRole(env, { name: "", open_id: openId });
    if (!canSeeFinanceDetail(role)) {
      throw new Error(`权限不足：finance 表仅队长/财务角色可查（当前角色：${role.role}）`);
    }
  }
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    return {
      content: [
        {
          type: "text",
          text: "⚠️ 飞书自建应用尚未配置（FEISHU_APP_ID / FEISHU_APP_SECRET）。请按 docs/飞书免登接入_MES.md 创建企业自建应用并 wrangler secret put 配置后重试。",
        },
      ],
    };
  }
  const cfg = await getDashboardConfig(env);
  const appToken = String(args.app_token ?? cfg?.base ?? "");
  const tableId = String(args.table_id ?? cfg?.tables?.[table] ?? "");
  if (!appToken || !tableId) {
    return {
      content: [
        {
          type: "text",
          text: `⚠️ 尚未配置 ${table} 表。两种方式任选：\n1. 调用 config_dashboard（action=set）写入 base 与 tables.${table}；\n2. 本次调用显式传 app_token + table_id。`,
        },
      ],
    };
  }
  const token = await getTenantAccessToken(env);
  const records = await listBitableRecords(token, appToken, tableId);
  const filter = String(args.filter ?? "").trim().toLowerCase();
  const matched = filter
    ? records.filter((r) => JSON.stringify(r.fields).toLowerCase().includes(filter))
    : records;
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
  return {
    content: [
      {
        type: "text",
        text:
          `表 ${table} 共 ${matched.length} 条匹配记录（展示前 ${Math.min(limit, matched.length)} 条）：\n` +
          JSON.stringify(matched.slice(0, limit).map((r) => r.fields), null, 2),
      },
    ],
  };
}

export const queryBitableTool: McpToolDef = {
  name: "query_bitable",
  readOnly: true,
  description:
    "只读查询飞书多维表格（队员名单/任务进度/物资台账/财务报销/赛季目标）。需先用 config_dashboard 配置 base 与 table_id，也可在调用时显式传 app_token/table_id 查询任意表格。finance 表受限：需管理端（MCP_TOKEN）或有效 user_token（角色为队长/财务）。",
  inputSchema: {
    type: "object",
    properties: {
      table: { type: "string", description: "表名：members | tasks | inventory | finance" },
      filter: { type: "string", description: "可选：对整条记录做不区分大小写的包含匹配" },
      limit: { type: "number", description: "返回条数上限，默认 20，最大 100" },
      app_token: { type: "string", description: "可选：覆盖配置，直接指定多维表格 app_token" },
      table_id: { type: "string", description: "可选：覆盖配置，直接指定 table_id（tbl 开头）" },
      user_token: { type: "string", description: "可选：飞书 user_access_token；查询 finance 表时必填（角色需为队长/财务）" },
    },
    required: ["table"],
  },
  impl: (args, env, ctx) => toolQueryBitable(args, env, ctx.hasMcpToken),
};

export const tools: McpToolDef[] = [queryBitableTool];
