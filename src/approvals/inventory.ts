/**
 * 物资台账联动（PRD V1.2 G-01）：硬件审批 arrive/issue 挂钩物资台账标准表，
 * 与 MCP update_inventory 工具共用 applyInventoryDelta。
 *
 * 台账为标准四表之一（物料/数量/位置/领用人），table_id 走 dashboard:config.tables.inventory。
 * 匹配规则：「物料」字段精确匹配物料名称；规格型号非空时匹配键为 物料名称（规格型号）。
 * 负库存不阻断（审批已过、货已领走是事实），negative 标记交由调用方告警，
 * validation 的 inventory-qty-negative 规则二次兜底。
 */

import { getDashboardConfig } from "../dashboard";
import {
  createBitableRecord,
  fieldNum,
  fieldText,
  findFieldKey,
  getTenantAccessToken,
  listBitableRecords,
  updateBitableRecord,
} from "../feishu/bitable";

export type InventoryAction = "inbound" | "outbound" | "adjust";

export interface InventoryDeltaInput {
  action: InventoryAction;
  itemName: string;
  /** 规格型号：非空时参与拼接匹配键 物料名称（规格型号） */
  spec?: string;
  /** inbound/outbound 须 >0；adjust 为目标库存值（≥0，可为 0） */
  quantity: number;
  /** 操作人姓名：出库时写入「领用人」，并进通知 */
  operator: string;
  /** 入库/新建行时写入「位置」 */
  location?: string;
}

export interface InventoryDeltaResult {
  recordId: string;
  /** 实际匹配/新建的物料键（可能带规格型号后缀） */
  itemKey: string;
  before: number;
  after: number;
  created: boolean;
  negative: boolean;
}

const ITEM_KEY_PATTERNS = [/^物料$/, /物料/, /物品/, /品名/, /名称/, /^name$/i];
const QTY_KEY_PATTERNS = [/^数量$/, /数量/, /库存/];
const LOC_KEY_PATTERNS = [/位置/, /存放/];
const BORROWER_KEY_PATTERNS = [/^领用人$/, /领用人/, /领用/, /借用人/];

/**
 * 台账增减。返回 null = 未配置台账（降级，调用方留痕「未配置台账」）；执行失败抛错。
 * 无匹配行时自动建行（位置默认「未登记」），与 PRD §3.2 新建行默认值一致。
 */
export async function applyInventoryDelta(env: Env, input: InventoryDeltaInput): Promise<InventoryDeltaResult | null> {
  const cfg = await getDashboardConfig(env);
  const base = cfg?.base ?? "";
  const tableId = cfg?.tables?.inventory ?? "";
  if (!base || !tableId) return null;

  const itemName = input.itemName.trim();
  const spec = (input.spec ?? "").trim();
  if (!itemName) throw new Error("物料名称为空");
  if (input.action === "adjust") {
    if (!Number.isFinite(input.quantity) || input.quantity < 0) throw new Error("adjust 的目标库存须为 ≥0 的数字");
  } else if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("数量须为大于 0 的数字");
  }

  const token = await getTenantAccessToken(env);
  const records = await listBitableRecords(token, base, tableId);
  // 空表无从推断表头，回退标准 schema 字段名（setup_bitable 建表结构）
  const fallback = records.length === 0;
  const itemKey = findFieldKey(records, ITEM_KEY_PATTERNS) ?? (fallback ? "物料" : null);
  const qtyKey = findFieldKey(records, QTY_KEY_PATTERNS) ?? (fallback ? "数量" : null);
  if (!itemKey || !qtyKey) throw new Error("物资台账表头缺少「物料」或「数量」字段");
  const locKey = findFieldKey(records, LOC_KEY_PATTERNS) ?? (fallback ? "位置" : null);
  const borrowerKey = findFieldKey(records, BORROWER_KEY_PATTERNS) ?? (fallback ? "领用人" : null);

  const key = spec ? `${itemName}（${spec}）` : itemName;
  const found = records.find((r) => fieldText(r.fields[itemKey]) === key);
  const before = found ? fieldNum(found.fields[qtyKey]) ?? 0 : 0;
  const after =
    input.action === "inbound" ? before + input.quantity
    : input.action === "outbound" ? before - input.quantity
    : input.quantity;

  let recordId: string;
  let created = false;
  if (found) {
    const patch: Record<string, unknown> = { [qtyKey]: after };
    if (input.action === "outbound" && borrowerKey) patch[borrowerKey] = input.operator;
    if (input.action === "inbound" && input.location && locKey) patch[locKey] = input.location;
    await updateBitableRecord(token, base, tableId, found.record_id, patch);
    recordId = found.record_id;
  } else {
    const row: Record<string, unknown> = { [itemKey]: key, [qtyKey]: after };
    if (locKey) row[locKey] = input.location || "未登记";
    if (borrowerKey) row[borrowerKey] = input.action === "outbound" ? input.operator : "";
    recordId = (await createBitableRecord(token, base, tableId, row)).record_id;
    created = true;
  }
  return { recordId, itemKey: key, before, after, created, negative: after < 0 };
}
