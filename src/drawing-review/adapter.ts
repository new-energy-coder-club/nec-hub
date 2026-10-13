/**
 * 新增机图纸评审流程 — 飞书 Base 数据适配器
 *
 * 负责把业务对象 ↔ Base 记录字段做双向映射。
 * 字段名不强制固定，通过配置项指定；未配置时使用常见同义词自动匹配。
 */

import {
  BitableRecord,
  createBitableRecord,
  fieldText,
  getTenantAccessToken,
  listBitableRecords,
  updateBitableRecord,
} from "../feishu/bitable";
import type {
  BOM,
  BOMItem,
  DrawingReview,
  DrawingReviewConfig,
  DrawingReviewTable,
  ReviewConclusion,
  ReviewMinutes,
  ReviewStatus,
} from "./types";

export interface TableAdapter<T> {
  list(): Promise<T[]>;
  get(recordId: string): Promise<T | null>;
  create(item: Omit<T, "recordId" | "id">): Promise<T>;
  update(recordId: string, item: Partial<T>): Promise<T>;
}

export class BaseAdapter {
  constructor(
    private env: Env,
    private cfg: DrawingReviewConfig,
  ) {}

  private async token(): Promise<string> {
    return getTenantAccessToken(this.env);
  }

  private tableId(name: DrawingReviewTable): string {
    const id = this.cfg.tables[name];
    if (!id) throw new Error(`新增机图纸评审流程未配置 ${name} 表`);
    return id;
  }

  async listRecords(table: DrawingReviewTable): Promise<BitableRecord[]> {
    const token = await this.token();
    return listBitableRecords(token, this.cfg.base, this.tableId(table));
  }

  async createRecord(table: DrawingReviewTable, fields: Record<string, unknown>): Promise<BitableRecord> {
    const token = await this.token();
    return createBitableRecord(token, this.cfg.base, this.tableId(table), fields);
  }

  async updateRecord(table: DrawingReviewTable, recordId: string, fields: Record<string, unknown>): Promise<BitableRecord> {
    const token = await this.token();
    return updateBitableRecord(token, this.cfg.base, this.tableId(table), recordId, fields);
  }

  // ---------- 图纸评审单 ----------

  async listReviews(): Promise<Array<DrawingReview & { recordId: string }>> {
    const records = await this.listRecords("reviews");
    return records.map((r) => this.recordToReview(r));
  }

  async getReview(recordId: string): Promise<(DrawingReview & { recordId: string }) | null> {
    const records = await this.listRecords("reviews");
    const rec = records.find((r) => r.record_id === recordId);
    return rec ? this.recordToReview(rec) : null;
  }

  async findReviewById(reviewId: string): Promise<(DrawingReview & { recordId: string }) | null> {
    const records = await this.listRecords("reviews");
    const rec = records.find((r) => fieldText(r.fields["评审单号"]) === reviewId || fieldText(r.fields["reviewId"]) === reviewId);
    return rec ? this.recordToReview(rec) : null;
  }

  async createReview(review: DrawingReview): Promise<DrawingReview & { recordId: string }> {
    const fields = this.reviewToFields(review);
    const rec = await this.createRecord("reviews", fields);
    return this.recordToReview(rec);
  }

  async updateReview(recordId: string, review: Partial<DrawingReview>): Promise<DrawingReview & { recordId: string }> {
    const fields = this.reviewToFields(review as DrawingReview, true);
    const rec = await this.updateRecord("reviews", recordId, fields);
    return this.recordToReview(rec);
  }

  private recordToReview(r: BitableRecord): DrawingReview & { recordId: string } {
    const f = r.fields;
    return {
      recordId: r.record_id,
      reviewId: fieldText(f["评审单号"] ?? f["reviewId"]),
      projectId: fieldText(f["项目编号"] ?? f["projectId"]),
      machineName: fieldText(f["机型名称"] ?? f["machineName"]),
      drawingVersion: fieldText(f["图纸版本"] ?? f["drawingVersion"]),
      designerId: fieldText(f["设计负责人"] ?? f["designerId"]),
      drawingFiles: [], // 附件字段需单独解析
      designNotes: fieldText(f["设计说明"] ?? f["designNotes"]),
      status: (fieldText(f["状态"] ?? f["status"]) as ReviewStatus) || "draft",
      meetingId: fieldText(f["会议ID"] ?? f["meetingId"]) || undefined,
      meetingLink: fieldText(f["会议链接"] ?? f["meetingLink"]) || undefined,
      meetingStartTime: fieldText(f["会议开始时间"] ?? f["meetingStartTime"]) || undefined,
      conclusion: (fieldText(f["评审结论"] ?? f["conclusion"]) as ReviewConclusion) || undefined,
      conclusionNotes: fieldText(f["评审结论说明"] ?? f["conclusionNotes"]) || undefined,
      createdAt: fieldText(f["创建时间"] ?? f["createdAt"]) || new Date().toISOString(),
      updatedAt: fieldText(f["更新时间"] ?? f["updatedAt"]) || new Date().toISOString(),
    };
  }

  private reviewToFields(review: Partial<DrawingReview>, partial = false): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    const map: Record<string, keyof DrawingReview> = {
      评审单号: "reviewId",
      项目编号: "projectId",
      机型名称: "machineName",
      图纸版本: "drawingVersion",
      设计负责人: "designerId",
      设计说明: "designNotes",
      状态: "status",
      会议ID: "meetingId",
      会议链接: "meetingLink",
      会议开始时间: "meetingStartTime",
      评审结论: "conclusion",
      评审结论说明: "conclusionNotes",
    };
    for (const [fieldName, key] of Object.entries(map)) {
      const v = review[key as keyof DrawingReview];
      if (v !== undefined) fields[fieldName] = v;
    }
    if (!partial) {
      fields["创建时间"] = review.createdAt ?? new Date().toISOString();
      fields["更新时间"] = review.updatedAt ?? new Date().toISOString();
    } else {
      fields["更新时间"] = new Date().toISOString();
    }
    return fields;
  }

  // ---------- 会议纪要 ----------

  async createMinutes(minutes: ReviewMinutes): Promise<ReviewMinutes & { recordId: string }> {
    const fields: Record<string, unknown> = {
      关联评审单: [minutes.reviewId],
      会议时间: minutes.meetingTime,
      参会人员: minutes.attendees.map((a) => ({ id: a.open_id })),
      讨论记录: minutes.discussion,
      评审结论: minutes.conclusion,
    };
    const rec = await this.createRecord("minutes", fields);
    return { ...minutes, recordId: rec.record_id };
  }

  async getMinutesByReview(reviewId: string): Promise<Array<ReviewMinutes & { recordId: string }>> {
    const records = await this.listRecords("minutes");
    return records
      .filter((r) => fieldText(r.fields["关联评审单"]) === reviewId)
      .map((r) => ({
        minutesId: fieldText(r.fields["会议纪要ID"] ?? r.fields["minutesId"]) || r.record_id,
        reviewId: fieldText(r.fields["关联评审单"]),
        meetingTime: fieldText(r.fields["会议时间"] ?? r.fields["meetingTime"]),
        attendees: [], // 人员字段需单独解析
        topics: [],
        discussion: fieldText(r.fields["讨论记录"] ?? r.fields["discussion"]),
        issues: [],
        conclusion: (fieldText(r.fields["评审结论"] ?? r.fields["conclusion"]) as ReviewConclusion) || "rejected",
        nextActions: [],
        attachments: [],
        recordId: r.record_id,
      }));
  }

  // ---------- BOM ----------

  async createBOMItems(bomId: string, items: BOMItem[]): Promise<void> {
    const token = await this.token();
    const tableId = this.tableId("bom");
    for (const item of items) {
      await createBitableRecord(token, this.cfg.base, tableId, {
        关联BOM: [bomId],
        层级: item.level,
        父级物料: item.parentItemId ? [item.parentItemId] : undefined,
        物料编码: item.materialCode,
        物料名称: item.materialName,
        规格型号: item.specification,
        数量: item.quantity,
        单位: item.unit,
        材质: item.material,
        加工工艺: item.process,
        来源: item.source,
        参考图号: item.drawingNo,
        备注: item.remark,
      });
    }
  }

  async getBOMByReview(reviewId: string): Promise<{ bom: BOM & { recordId: string }; items: Array<BOMItem & { recordId: string }> } | null> {
    const records = await this.listRecords("bom");
    const rec = records.find((r) => fieldText(r.fields["关联评审单"]) === reviewId);
    if (!rec) return null;
    const bom: BOM & { recordId: string } = {
      bomId: fieldText(rec.fields["BOM编号"] ?? rec.fields["bomId"]) || rec.record_id,
      reviewId,
      version: fieldText(rec.fields["版本"] ?? rec.fields["version"]) || "1.0",
      totalCostEstimate: undefined,
      status: (fieldText(rec.fields["状态"] ?? rec.fields["status"]) as "draft" | "confirmed") || "draft",
      recordId: rec.record_id,
    };
    // TODO: 读取 BOMItem 子表
    return { bom, items: [] };
  }
}
