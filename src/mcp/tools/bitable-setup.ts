import {
  DASH_TABLES,
  getDashboardConfig,
  type DashTable,
  type DashboardConfig,
} from "../../dashboard";
import { createBitableTable, getTenantAccessToken, listBitableFields } from "../../feishu/bitable";
import { KV_KEYS } from "../../shared/kv-keys";
import { BITABLE_BASE_RE } from "../../shared/module-config";
import type { McpToolDef } from "./shared";

/** 四张逻辑表的标准字段schema（type: 1=文本 2=数字 5=日期）；goals 表结构由 FE-04 自行管理，不在一键建表范围 */
const BITABLE_SCHEMA_TABLES = ["members", "tasks", "inventory", "finance"] as const;
type BitableSchemaTable = (typeof BITABLE_SCHEMA_TABLES)[number];

const BITABLE_SCHEMAS: Record<BitableSchemaTable, Array<{ name: string; type: number; property?: Record<string, unknown> }>> = {
  members: [
    { name: "姓名", type: 1 },
    { name: "飞书ID", type: 1 },
    { name: "组别", type: 1 },
    { name: "权限角色", type: 1 },
    { name: "赛季", type: 1 },
  ],
  tasks: [
    { name: "任务", type: 1 },
    { name: "负责人", type: 1 },
    { name: "状态", type: 1 },
    { name: "完成度", type: 2 },
    { name: "截止日期", type: 5, property: { date_formatter: "yyyy/MM/dd" } },
    { name: "创建日期", type: 5, property: { date_formatter: "yyyy/MM/dd" } },
  ],
  inventory: [
    { name: "物料", type: 1 },
    { name: "数量", type: 2 },
    { name: "位置", type: 1 },
    { name: "领用人", type: 1 },
  ],
  finance: [
    { name: "事项", type: 1 },
    { name: "金额", type: 2 },
    { name: "发票状态", type: 1 },
    { name: "状态", type: 1 },
    { name: "报销人", type: 1 },
    { name: "日期", type: 5, property: { date_formatter: "yyyy/MM/dd" } },
  ],
};

const TABLE_DISPLAY_NAMES: Record<BitableSchemaTable, string> = {
  members: "队员名单",
  tasks: "任务进度",
  inventory: "物资台账",
  finance: "财务报销",
};

/**
 * 在指定多维表格 base 里按标准 schema 建表，并把 table_id 写入看板配置。
 * 需在飞书里先建好空白多维表格（云文档 → 新建多维表格），把 URL 中 /base/ 后的 app_token 传给本工具。
 */
export async function toolSetupBitable(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) {
    throw new Error("setup_bitable 仅管理端可用（需 MCP_TOKEN）：建表会改变团队数据结构");
  }
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    throw new Error("飞书自建应用未配置（FEISHU_APP_ID / FEISHU_APP_SECRET）");
  }
  const base = String(args.base ?? "").trim();
  if (!BITABLE_BASE_RE.test(base)) {
    throw new Error("base 不合法：飞书多维表格 URL 中 /base/ 后的 app_token");
  }
  const force = args.force === true;
  const want = Array.isArray(args.tables) && args.tables.length > 0
    ? args.tables.map(String).filter((t): t is BitableSchemaTable => (BITABLE_SCHEMA_TABLES as readonly string[]).includes(t))
    : [...BITABLE_SCHEMA_TABLES];
  if (want.length === 0) throw new Error(`tables 必须是：${BITABLE_SCHEMA_TABLES.join(" | ")}`);

  const cfg = await getDashboardConfig(env);
  const token = await getTenantAccessToken(env);
  const created: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  const tables: DashboardConfig["tables"] = { ...(cfg?.base === base ? cfg.tables : {}) };

  for (const t of want) {
    if (tables[t] && !force) { skipped.push(t); continue; }
    try {
      const fields = BITABLE_SCHEMAS[t].map((f) => ({
        field_name: f.name,
        type: f.type,
        // 数字字段需 formatter；日期字段需 date_formatter
        property: f.type === 2 ? { formatter: "0" } : f.type === 5 ? { date_formatter: "yyyy/MM/dd" } : f.property,
      }));
      const tableId = await createBitableTable(token, base, TABLE_DISPLAY_NAMES[t], fields);
      tables[t] = tableId;
      created.push(`${t}=${tableId}`);
    } catch (err) {
      failed.push(`${t}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const newCfg: DashboardConfig = { base, tables, updatedAt: new Date().toISOString() };
  await env.REGISTRY.put(KV_KEYS.dashboardConfig, JSON.stringify(newCfg));
  await Promise.all(DASH_TABLES.map((k) => env.REGISTRY.delete(KV_KEYS.dashboardCache(k))));
  return {
    content: [
      {
        type: "text",
        text:
          `✅ 建表完成：新建 ${created.length} 张（${created.join("，") || "无"}），已存在跳过 ${skipped.length} 张（${skipped.join("，") || "无"}）` +
          (failed.length ? `，失败 ${failed.length} 张：\n- ${failed.join("\n- ")}` : "") +
          `\n看板配置已更新：base=${base}。打开门户「数据看板」Tab 验证。`,
      },
    ],
  };
}

/**
 * 往指定表里追加记录（飞书字段名 → 值；数字/日期字段传数字，日期为毫秒时间戳）。
 * 仅管理端（MCP_TOKEN）可用——写操作会改变团队底表。
 */
export async function toolAddRecords(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) {
    throw new Error("add_records 仅管理端可用（需 MCP_TOKEN）：写操作会改变团队底表");
  }
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    throw new Error("飞书自建应用未配置（FEISHU_APP_ID / FEISHU_APP_SECRET）");
  }
  const table = String(args.table ?? "") as DashTable;
  if (!DASH_TABLES.includes(table)) {
    throw new Error(`table 必须是：${DASH_TABLES.join(" | ")}`);
  }
  const records = (args.records ?? []) as Array<Record<string, unknown>>;
  if (!Array.isArray(records) || records.length === 0) throw new Error("records 不能为空");
  if (records.length > 100) throw new Error("单次最多写入 100 条");
  for (const [i, r] of records.entries()) {
    if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).length === 0) {
      throw new Error(`第 ${i + 1} 条记录为空或非法`);
    }
  }

  const cfg = await getDashboardConfig(env);
  const tableId = cfg?.tables?.[table];
  if (!cfg || !tableId) {
    throw new Error(`尚未配置 ${table} 表：先调用 setup_bitable 或 config_dashboard`);
  }
  const token = await getTenantAccessToken(env);

  // 先取字段清单校验字段名，避免飞书报含义不清的 FieldNameNotFound
  const metas = await listBitableFields(token, cfg.base, tableId);
  const validNames = new Set(metas.map((f) => f.field_name));
  const badKeys = new Set<string>();
  for (const r of records) {
    for (const k of Object.keys(r)) if (!validNames.has(k)) badKeys.add(k);
  }
  if (badKeys.size > 0) {
    throw new Error(
      `字段不存在：${[...badKeys].join("、")}。${table} 现有字段：${[...validNames].join("、")}`,
    );
  }

  const resp = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.base}/tables/${tableId}/records/batch_create`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ records: records.map((fields) => ({ fields })) }),
  });
  const data = (await resp.json()) as {
    code?: number;
    msg?: string;
    data?: { records?: Array<{ record_id?: string }> };
  };
  if (data.code !== 0) {
    throw new Error(`飞书写入失败：${data.msg ?? `code ${data.code}`}`);
  }
  const ids = (data.data?.records ?? []).map((r) => r.record_id).filter(Boolean);
  return {
    content: [
      {
        type: "text",
        text: `✅ 已写入 ${ids.length} 条记录到 ${table}：\n${ids.join("\n")}`,
      },
    ],
  };
}

export const addRecordsTool: McpToolDef = {
  name: "add_records",
  description:
    "往飞书多维表格追加记录（飞书字段名 → 值；数字/日期字段传数字，日期为毫秒时间戳）。仅管理端（MCP_TOKEN）可用。典型用法：报销回写财务表、任务批量导入。",
  inputSchema: {
    type: "object",
    properties: {
      table: { type: "string", description: "表名：members | tasks | inventory | finance | goals" },
      records: { type: "array", items: { type: "object" }, description: "记录数组，每条为 {字段名: 值}，如 [{\"姓名\":\"张三\",\"组别\":\"机械\"}]" },
    },
    required: ["table", "records"],
  },
  impl: (args, env, ctx) => toolAddRecords(args, env, ctx.hasMcpToken),
};

export const setupBitableTool: McpToolDef = {
  name: "setup_bitable",
  description:
    "数据基建一键建表：在指定飞书多维表格 base 里按标准字段 schema 创建 队员名单/任务进度/物资台账/财务报销 四张表，并把 table_id 写入看板配置。需先在飞书云文档新建空白多维表格，把 URL 中 /base/ 后的 app_token 传给 base 参数。仅管理端（MCP_TOKEN）可用。",
  inputSchema: {
    type: "object",
    properties: {
      base: { type: "string", description: "多维表格 app_token（URL 中 /base/ 后的一段）" },
      tables: { type: "array", items: { type: "string" }, description: "可选：只建部分表，如 [\"members\",\"tasks\"]，默认全部四张" },
      force: { type: "boolean", description: "true 时即使配置里已有该表也强制新建（会留下旧表，谨慎）" },
    },
    required: ["base"],
  },
  impl: (args, env, ctx) => toolSetupBitable(args, env, ctx.hasMcpToken),
};

export const tools: McpToolDef[] = [addRecordsTool, setupBitableTool];
