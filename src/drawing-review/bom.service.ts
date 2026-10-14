/**
 * 新增机图纸评审流程 — BOM 生成与拆分服务
 *
 * 首期：支持从模板 JSON / 手动录入生成 BOM。
 * 二期：接入 CAD 图纸解析或标准件库自动识别。
 */

import type { DrawingReviewAdapter } from "./adapter";
import type { BOM, BOMItem, BOMProcess, BOMSource } from "./types";

export interface GenerateBOMInput {
  items: Array<Partial<BOMItem> & Pick<BOMItem, "materialName" | "quantity" | "unit">>;
}

export class BOMService {
  constructor(private adapter: DrawingReviewAdapter) {}

  async generate(reviewId: string, input: GenerateBOMInput): Promise<{ bom: BOM & { recordId: string }; items: Array<BOMItem & { recordId: string }> }> {
    // 1. 创建 BOM 头
    const bom: BOM = {
      bomId: `BOM-${reviewId}-${Date.now()}`,
      reviewId,
      version: "1.0",
      status: "draft",
    };
    const bomRec = await this.adapter.createRecord("bom", {
      关联评审单: reviewId,
      BOM编号: bom.bomId,
      版本: bom.version,
      状态: bom.status,
    });

    // 2. 标准化 BOM 项
    const normalizedItems: BOMItem[] = input.items.map((it, idx) => this.normalizeItem(it, idx, bom.bomId));

    // 3. 写入 Base
    await this.adapter.createBOMItems(bom.bomId, normalizedItems);

    return {
      bom: { ...bom, recordId: bomRec.record_id },
      items: normalizedItems.map((it, idx) => ({ ...it, recordId: `${bomRec.record_id}-item-${idx}` })),
    };
  }

  /** 从 BOM 中筛选机械加工件 */
  async extractMachiningItems(reviewId: string): Promise<Array<BOMItem & { recordId: string }>> {
    const data = await this.adapter.getBOMByReview(reviewId);
    if (!data) return [];
    return data.items.filter((it) => it.source === "self-made" && ["machining", "sheet-metal", "welding"].includes(it.process || ""));
  }

  private normalizeItem(raw: Partial<BOMItem> & Pick<BOMItem, "materialName" | "quantity" | "unit">, idx: number, bomId: string): BOMItem {
    return {
      itemId: `${bomId}-item-${idx}`,
      bomId,
      level: raw.level ?? 3,
      parentItemId: raw.parentItemId,
      materialCode: raw.materialCode,
      materialName: raw.materialName,
      specification: raw.specification || "",
      quantity: raw.quantity,
      unit: raw.unit,
      material: raw.material,
      process: raw.process ?? "standard",
      source: raw.source ?? "standard",
      drawingNo: raw.drawingNo,
      remark: raw.remark,
    };
  }
}
