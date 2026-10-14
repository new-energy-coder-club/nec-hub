/**
 * 新增机图纸评审流程 — 库存手动导入兜底服务（PRD §13.7 验收标准第 2 条）
 *
 * ERP/MES 接口未就绪时，通过「手动导入模板」写入库存表，来源固定「手动导入」，
 * 与 board.service 的读取口径（关联评审单/物料编码/物料名称）对齐。
 * 幂等：同评审单 + 同物料编码重复导入时更新数量而非重复建行。
 */

import type { DrawingReviewAdapter } from "./adapter";
import type { InventoryRecord } from "./types";

export const MANUAL_IMPORT_SOURCE = "手动导入";

export interface InventoryImportRow {
  materialCode: string;
  materialName: string;
  spec?: string;
  quantity: number;
  unit?: string;
  warehouse?: string;
  location?: string;
}

export interface InventoryImportError {
  index: number;
  materialCode?: string;
  message: string;
}

export interface InventoryImportResult {
  ok: boolean;
  imported: number;
  skipped: number;
  errors: InventoryImportError[];
}

export class InventoryService {
  constructor(private adapter: DrawingReviewAdapter) {}

  async importRows(reviewId: string, rows: unknown[], actorId: string): Promise<InventoryImportResult> {
    // 先拉一次现有行，构建 物料编码 → 记录 索引供幂等判断
    const existing = await this.adapter.listInventoryByReview(reviewId);
    const byCode = new Map(existing.map((r) => [r.materialCode, r]));

    let imported = 0;
    let skipped = 0;
    const errors: InventoryImportError[] = [];
    const now = new Date().toISOString();

    for (let i = 0; i < rows.length; i++) {
      const raw = (rows[i] ?? {}) as Partial<InventoryImportRow>;
      const materialCode = typeof raw.materialCode === "string" ? raw.materialCode.trim() : "";
      const materialName = typeof raw.materialName === "string" ? raw.materialName.trim() : "";
      const quantity = typeof raw.quantity === "number" ? raw.quantity : Number(raw.quantity);

      let invalid = "";
      if (!materialCode) invalid = "物料编码必填";
      else if (!materialName) invalid = "物料名称必填";
      else if (!Number.isFinite(quantity) || quantity <= 0) invalid = "quantity 必须为大于 0 的数字";
      if (invalid) {
        skipped++;
        errors.push({ index: i, materialCode: materialCode || undefined, message: invalid });
        continue;
      }

      const row: InventoryRecord = {
        materialCode,
        materialName,
        specification: raw.spec,
        quantity,
        unit: raw.unit,
        warehouse: raw.warehouse,
        location: raw.location,
        source: MANUAL_IMPORT_SOURCE,
        reviewId,
        importedBy: actorId,
        importedAt: now,
      };

      // 单行失败不阻断整批
      try {
        const dup = byCode.get(materialCode);
        if (dup) {
          await this.adapter.updateInventoryRow(dup.recordId, row);
        } else {
          await this.adapter.createInventoryRow(row);
        }
        imported++;
      } catch (err) {
        skipped++;
        errors.push({
          index: i,
          materialCode,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await this.logImportEvent(reviewId, actorId, { imported, skipped, errors: errors.length });

    return { ok: true, imported, skipped, errors };
  }

  /** 事件日志失败不阻断主流程（与 flow.service logEvent 同口径） */
  private async logImportEvent(reviewId: string, actorId: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.adapter.createRecord("events", {
        关联评审单: reviewId,
        操作人: actorId,
        动作: "inventory_import",
        附加信息: JSON.stringify({ source: MANUAL_IMPORT_SOURCE, ...payload }),
        操作时间: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[drawing-review] log inventory import event failed:", err);
    }
  }
}
