/**
 * 数据看板 / 数据基建 MCP 工具：query_bitable / update_inventory / config_dashboard /
 * setup_bitable / add_records / update_progress（FE-04 赛季目标回写）
 */

import { validateUserToken } from "../../auth/feishu-auth";
import { canSeeFinanceDetail, resolveUserRole } from "../../auth/role";
import {
  DASH_TABLES,
  getDashboardConfig,
  type DashTable,
  type DashboardConfig,
} from "../../dashboard";
import {
  createBitableTable,
  fieldNum,
  fieldText,
  findFieldKey,
  getTenantAccessToken,
  listBitableFields,
  listBitableRecords,
  matchField,
  updateBitableRecord,
} from "../../feishu/bitable";
import { applyInventoryDelta, type InventoryAction } from "../../approvals/inventory";
import { notifyFeishu } from "../../feishu/bot";
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

/**
 * update_inventory：物资台账手工调账（仅管理端）。盘点修正/历史补录/联动失败补偿。
 * 与审批台账联动共用 applyInventoryDelta；负库存放行，返回与群通知中带 ⚠️ 提示。
 */
export async function toolUpdateInventory(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) {
    throw new Error("update_inventory 仅管理端可用（需 MCP_TOKEN）：台账调账会改变团队物资数据");
  }
  const action = String(args.action ?? "") as InventoryAction;
  if (!["inbound", "outbound", "adjust"].includes(action)) {
    throw new Error("action 必须是 inbound | outbound | adjust");
  }
  const itemName = String(args.item_name ?? "").trim();
  if (!itemName) throw new Error("item_name 不能为空");
  const operator = String(args.operator ?? "").trim();
  if (!operator) throw new Error("operator 不能为空（操作人姓名，出库写「领用人」并进通知）");
  const quantity = Number(args.quantity);

  const result = await applyInventoryDelta(env, {
    action,
    itemName,
    spec: String(args.spec ?? ""),
    quantity,
    operator,
    location: args.location ? String(args.location) : undefined,
  });
  if (!result) {
    return {
      content: [
        {
          type: "text",
          text: "⚠️ 未配置物资台账：先用 config_dashboard（action=set）写入 tables.inventory，或用 setup_bitable 一键建标准四表。",
        },
      ],
    };
  }
  const actionLabel = action === "inbound" ? "入库" : action === "outbound" ? "出库" : "调账";
  const approvalId = String(args.approval_id ?? "").trim();
  const note = String(args.note ?? "").trim();
  await notifyFeishu(
    env,
    "hardware",
    `📦 台账${actionLabel} ${result.itemKey}`,
    [
      `${result.before} → ${result.after}（${result.created ? "新建行" : "更新"}）`,
      `操作人：${operator}`,
      approvalId ? `关联单号：${approvalId}` : "",
      note ? `备注：${note}` : "",
      result.negative ? "⚠️ 库存为负，请尽快补货或核对台账" : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return {
    content: [
      {
        type: "text",
        text:
          `✅ 台账${actionLabel}完成：${result.itemKey} ${result.before} → ${result.after}（${result.created ? "新建行" : "更新"}，record_id=${result.recordId}）` +
          (result.negative ? "\n⚠️ 库存为负，已放行并发群告警，请尽快补货或核对台账" : ""),
      },
    ],
  };
}

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
  if (!/^[A-Za-z0-9]{10,}$/.test(base)) {
    throw new Error("base 不合法：应为飞书多维表格 URL 中 /base/ 后的 app_token（10 位以上字母数字串）");
  }
  const rawTables = (args.tables ?? {}) as Record<string, unknown>;
  const tables: DashboardConfig["tables"] = {};
  for (const key of DASH_TABLES) {
    const v = String(rawTables[key] ?? "").trim();
    if (v) {
      if (!/^tbl[A-Za-z0-9]+$/.test(v)) {
        throw new Error(`table_id 不合法（${key}）：应以 tbl 开头，如 tblsH8aOxxx`);
      }
      tables[key] = v;
    }
  }
  if (Object.keys(tables).length === 0) {
    throw new Error("tables 至少提供一张表：members / tasks / inventory / finance / goals → table_id");
  }
  const cfg: DashboardConfig = { base, tables, updatedAt: new Date().toISOString() };
  await env.REGISTRY.put("dashboard:config", JSON.stringify(cfg));
  // 配置变更后清掉旧缓存，让下一次读取拉最新数据
  await Promise.all(DASH_TABLES.map((k) => env.REGISTRY.delete(`dashboard:cache:${k}`)));
  return {
    content: [
      {
        type: "text",
        text: `✅ 数据看板配置已保存：base=${base}，共 ${Object.keys(tables).length} 张表（${Object.keys(tables).join(" / ")}）。\n打开门户「数据看板」Tab 或 GET /api/dashboard 验证渲染。`,
      },
    ],
  };
}

// ---------- 数据基建（setup_bitable / add_records） ----------

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
  if (!/^[A-Za-z0-9]{10,}$/.test(base)) {
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
  await env.REGISTRY.put("dashboard:config", JSON.stringify(newCfg));
  await Promise.all(DASH_TABLES.map((k) => env.REGISTRY.delete(`dashboard:cache:${k}`)));
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

// ---------- FE-04 赛季目标：update_progress 回写 ----------

export async function toolUpdateProgress(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) {
    const userToken = String(args.user_token ?? "").trim();
    if (!userToken) {
      throw new Error("update_progress 需要鉴权：请提供 user_token（飞书 user_access_token），或由配置了 MCP_TOKEN 的管理端调用");
    }
    await validateUserToken(userToken);
  }
  let recordId = String(args.record_id ?? "").trim();
  const goalKw = String(args.goal ?? "").trim();
  if (!recordId && !goalKw) {
    throw new Error("record_id 与 goal 至少填一个（goal 支持目标名称/记录关键词模糊匹配）");
  }
  const hasProgress = args.progress !== undefined && args.progress !== null && args.progress !== "";
  const status = String(args.status ?? "").trim();
  const note = String(args.note ?? "").trim();
  if (!hasProgress && !status && !note) throw new Error("progress / status / note 至少填一个");
  let progress: number | null = null;
  if (hasProgress) {
    progress = Number(args.progress);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error("progress 必须是 0-100 的数字");
  }
  const cfg = await getDashboardConfig(env);
  const tableId = cfg?.tables.goals;
  if (!cfg || !tableId) {
    throw new Error("赛季目标表未配置：请先调用 config_dashboard（action=set）写入 tables.goals");
  }
  const token = await getTenantAccessToken(env);
  // 字段元数据与记录定位互不依赖，提前启动并行拉取；错误仍在下方 await 处抛出
  const metasPromise = listBitableFields(token, cfg.base, tableId);
  metasPromise.catch(() => {});

  // goal 关键词定位记录：整条记录 JSON 不区分大小写包含匹配，或 record_id 精确命中；
  // 唯一匹配才写，多匹配返回候选列表让调用方用 record_id 精确指定
  if (!recordId) {
    const records = await listBitableRecords(token, cfg.base, tableId);
    const kw = goalKw.toLowerCase();
    const matched = records.filter(
      (r) => r.record_id === goalKw || JSON.stringify(r.fields).toLowerCase().includes(kw),
    );
    if (matched.length === 0) {
      throw new Error(`赛季目标表未找到匹配「${goalKw}」的记录（可用 query_bitable table=goals 核对目标名称）`);
    }
    if (matched.length > 1) {
      const titleKey = findFieldKey(matched, [/^目标/, /目标/, /title/i]);
      const progressKey = findFieldKey(matched, [/完成度/, /进度/, /progress/i]);
      const lines = matched.map((r) => {
        const title = (titleKey ? fieldText(r.fields[titleKey]) : "") || JSON.stringify(r.fields).slice(0, 60);
        const p = progressKey ? fieldNum(r.fields[progressKey]) : null;
        return `- record_id=${r.record_id} · ${title}${p !== null ? `（当前完成度 ${p}%）` : ""}`;
      });
      return {
        content: [
          {
            type: "text",
            text: `⚠️ 关键词「${goalKw}」匹配到 ${matched.length} 条赛季目标，未写入。请用 record_id 精确指定后重试：\n${lines.join("\n")}`,
          },
        ],
      };
    }
    recordId = matched[0].record_id;
  }

  const metas = await metasPromise;
  const record: Record<string, unknown> = {};
  if (progress !== null) {
    const f =
      matchField(metas, [/完成度/, /进度/, /progress/i], /Number|Progress|Percent/i) ??
      matchField(metas, [/完成度/, /进度/, /progress/i]);
    if (!f) throw new Error("赛季目标表未匹配到「完成度」字段");
    // 飞书「进度」字段取值 0-1，普通数字字段按 0-100 写入
    record[f.field_name] = /Progress/i.test(f.ui_type) && progress > 1 ? progress / 100 : progress;
  }
  if (status) {
    const f = matchField(metas, [/^状态/, /状态/, /status/i]);
    if (!f) throw new Error("赛季目标表未匹配到「状态」字段");
    record[f.field_name] = status;
  }
  let noteSkipped = false;
  if (note) {
    const f = matchField(metas, [/备注/, /进展/, /说明/, /note/i, /remark/i], /Text/i);
    if (f) record[f.field_name] = note;
    else noteSkipped = true;
  }
  const updated = await updateBitableRecord(token, cfg.base, tableId, recordId, record);
  // 回写后清看板缓存，门户面板下一次请求即拉最新数据（≤1 分钟）
  await env.REGISTRY.delete("dashboard:cache:goals");
  const parts = [
    progress !== null ? `完成度=${progress}%` : "",
    status ? `状态=${status}` : "",
    note ? (noteSkipped ? "备注未写入（表内无备注/进展类文本字段）" : "备注已写入") : "",
  ].filter(Boolean);
  return {
    content: [
      {
        type: "text",
        text:
          `✅ 赛季目标已回写（record_id=${recordId}）：${parts.join("，")}。\n` +
          `updated=${JSON.stringify({ record_id: updated.record_id, fields: updated.fields })}\n` +
          `看板缓存已清，门户「数据看板 → 赛季目标」1 分钟内刷新。`,
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

export const updateInventoryTool: McpToolDef = {
  name: "update_inventory",
  description:
    "物资台账手工调账（仅管理端 MCP_TOKEN）：inbound 入库 / outbound 出库 / adjust 盘点调账（直接设为目标值，可为 0）。按「物料」字段精确匹配 item_name，spec 非空时匹配键为 物料名称（规格型号）；无匹配行自动建行（位置默认「未登记」）。出库写「领用人」= operator；负库存放行但返回 ⚠️ 提示并发群告警。用于盘点修正、历史补录、审批台账联动失败补偿。需先用 config_dashboard 配置 tables.inventory。",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["inbound", "outbound", "adjust"], description: "inbound 入库 / outbound 出库 / adjust 盘点调账（设为目标值）" },
      item_name: { type: "string", description: "物料名称（匹配规则同审批台账联动）" },
      spec: { type: "string", description: "可选：规格型号，参与拼接匹配键 物料名称（规格型号）" },
      quantity: { type: "number", description: "数量（inbound/outbound 须 >0；adjust 为目标库存值，≥0）" },
      operator: { type: "string", description: "操作人姓名（出库写「领用人」，进通知）" },
      location: { type: "string", description: "可选：位置（入库/新建行时写入）" },
      note: { type: "string", description: "可选：备注，追加到群通知" },
      approval_id: { type: "string", description: "可选：关联申请单号（如 HW-2026-0003），写入通知便于追溯" },
    },
    required: ["action", "item_name", "quantity", "operator"],
  },
  impl: (args, env, ctx) => toolUpdateInventory(args, env, ctx.hasMcpToken),
};

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

export const updateProgressTool: McpToolDef = {
  name: "update_progress",
  description:
    "回写赛季目标表某条记录的完成度%/状态（FE-04）。需先用 config_dashboard 配置 tables.goals。定位方式二选一：record_id 精确指定，或 goal 传目标名称/关键词模糊匹配（唯一匹配才写入，多匹配返回候选列表）。鉴权：管理端 MCP_TOKEN，或提供有效 user_token 的登录用户。回写后自动清看板缓存，门户面板 ≤1 分钟刷新。",
  inputSchema: {
    type: "object",
    properties: {
      record_id: { type: "string", description: "赛季目标表的 record_id（与 goal 二选一；可用 query_bitable table=goals 查到）" },
      goal: { type: "string", description: "目标名称或记录关键词（模糊匹配；唯一匹配才写入，多匹配返回候选 record_id 列表）" },
      progress: { type: "number", description: "完成度 0-100（与 status / note 至少填一个）" },
      status: { type: "string", description: "状态文本，如 进行中 / 已完成 / 已逾期" },
      note: { type: "string", description: "可选：进展备注，写入表内 备注/进展/说明 类文本字段（无该字段则跳过并在结果中说明）" },
      user_token: { type: "string", description: "可选：飞书 user_access_token；无 MCP_TOKEN 时必填" },
    },
  },
  impl: (args, env, ctx) => toolUpdateProgress(args, env, ctx.hasMcpToken),
};

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
