import { applyInventoryDelta, type InventoryAction } from "../../approvals/inventory";
import { notifyFeishu } from "../../feishu/bot";
import type { McpToolDef } from "./shared";

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

export const tools: McpToolDef[] = [updateInventoryTool];
