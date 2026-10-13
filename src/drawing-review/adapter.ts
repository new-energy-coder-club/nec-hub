/**
 * 新增机图纸评审流程 — 飞书 Base 数据适配器
 *
 * 负责把业务对象 ↔ Base 记录字段做双向映射。
 * 字段名不强制固定，通过配置项指定；未配置时使用常见同义词自动匹配。
 * 通用 CRUD 骨架继承自 shared/FeishuTableAdapter。
 */

import {
  BitableRecord,
  createBitableRecord,
  fieldNum,
  fieldText,
  fieldTs,
} from "../feishu/bitable";
import { FeishuTableAdapter } from "../shared/feishu-table-adapter";
import type {
  BOM,
  BOMItem,
  DrawingReview,
  DrawingReviewConfig,
  DrawingReviewTable,
  Inquiry,
  ProcessEvent,
  ReviewConclusion,
  ReviewMinutes,
  ReviewStatus,
} from "./types";

// TableAdapter 接口已收敛至 shared/feishu-table-adapter，此处 re-export 保持既有 import 路径
export type { TableAdapter } from "../shared/feishu-table-adapter";

export class DrawingReviewAdapter extends FeishuTableAdapter<DrawingReviewConfig, DrawingReviewTable> {
  constructor(env: Env, cfg: DrawingReviewConfig) {
    super(env, cfg, "新增机图纸评审流程");
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

  /**
   * 联想查询：根据项目编号、机型名称等条件查找相关评审单
   */
  async findReviewsByPattern(pattern: {
    projectId?: string;
    machineName?: string;
    designerId?: string;
    status?: string;
    limit?: number;
  }): Promise<Array<DrawingReview & { recordId: string }>> {
    const records = await this.listRecords("reviews");
    const limit = pattern.limit || 10;

    return records
      .filter(r => {
        if (pattern.projectId && !fieldText(r.fields["项目编号"]).toLowerCase().includes(pattern.projectId.toLowerCase())) {
          return false;
        }
        if (pattern.machineName && !fieldText(r.fields["机型名称"]).toLowerCase().includes(pattern.machineName.toLowerCase())) {
          return false;
        }
        if (pattern.designerId && fieldText(r.fields["设计负责人"]) !== pattern.designerId) {
          return false;
        }
        if (pattern.status && fieldText(r.fields["状态"]) !== pattern.status) {
          return false;
        }
        return true;
      })
      .map(r => this.recordToReview(r))
      .slice(0, limit);
  }

  /**
   * 获取项目编号联想列表（去重）
   */
  async getProjectSuggestions(query: string, limit: number = 5): Promise<string[]> {
    const records = await this.listRecords("reviews");
    const projects = new Set<string>();

    records.forEach(r => {
      const projectId = fieldText(r.fields["项目编号"]);
      if (projectId && projectId.toLowerCase().includes(query.toLowerCase())) {
        projects.add(projectId);
      }
    });

    return Array.from(projects).slice(0, limit);
  }

  /**
   * 获取机型名称联想列表（去重）
   */
  async getMachineSuggestions(query: string, limit: number = 5): Promise<string[]> {
    const records = await this.listRecords("reviews");
    const machines = new Set<string>();

    records.forEach(r => {
      const machineName = fieldText(r.fields["机型名称"]);
      if (machineName && machineName.toLowerCase().includes(query.toLowerCase())) {
        machines.add(machineName);
      }
    });

    return Array.from(machines).slice(0, limit);
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
      设计负责人ID: "designerId",
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
    const items = await this.listBOMItems(bom.bomId);
    return { bom, items };
  }

  /** 读取某 BOM 下的全部物料行（BOM 头与物料同表，以「关联BOM」区分） */
  async listBOMItems(bomId: string): Promise<Array<BOMItem & { recordId: string }>> {
    const records = await this.listRecords("bom");
    return records
      .filter((r) => fieldText(r.fields["关联BOM"] ?? r.fields["bomId"]) === bomId)
      .map((r) => this.recordToBOMItem(r, bomId));
  }

  private recordToBOMItem(r: BitableRecord, bomId: string): BOMItem & { recordId: string } {
    const f = r.fields;
    const rawSource = fieldText(f["来源"] ?? f["source"]);
    const sourceMap: Record<string, BOMItem["source"]> = { 外购: "purchased", 标准件: "standard", 自制: "self-made" };
    return {
      recordId: r.record_id,
      itemId: fieldText(f["物料项ID"] ?? f["itemId"]) || r.record_id,
      bomId,
      level: fieldNum(f["层级"] ?? f["level"]) ?? 3,
      materialCode: fieldText(f["物料编码"] ?? f["materialCode"]) || undefined,
      materialName: fieldText(f["物料名称"] ?? f["materialName"]),
      specification: fieldText(f["规格型号"] ?? f["specification"]),
      quantity: fieldNum(f["数量"] ?? f["quantity"]) ?? 0,
      unit: fieldText(f["单位"] ?? f["unit"]),
      material: fieldText(f["材质"] ?? f["material"]) || undefined,
      process: (fieldText(f["加工工艺"] ?? f["process"]) as BOMItem["process"]) || undefined,
      source: sourceMap[rawSource] ?? ((rawSource as BOMItem["source"]) || "standard"),
      drawingNo: fieldText(f["参考图号"] ?? f["drawingNo"]) || undefined,
      remark: fieldText(f["备注"] ?? f["remark"]) || undefined,
    };
  }

  // ---------- 询价单 ----------

  async listInquiries(reviewId?: string): Promise<Array<Inquiry & { recordId: string }>> {
    const records = await this.listRecords("inquiries");
    return records
      .map((r) => this.recordToInquiry(r))
      .filter((i) => !reviewId || i.reviewId === reviewId);
  }

  async findInquiryById(inquiryId: string): Promise<(Inquiry & { recordId: string }) | null> {
    const records = await this.listRecords("inquiries");
    const rec = records.find((r) => fieldText(r.fields["询价单号"] ?? r.fields["inquiryId"]) === inquiryId);
    return rec ? this.recordToInquiry(rec) : null;
  }

  async createInquiry(inquiry: Inquiry): Promise<Inquiry & { recordId: string }> {
    const rec = await this.createRecord("inquiries", {
      询价单号: inquiry.inquiryId,
      关联评审单: [inquiry.reviewId],
      关联物料: inquiry.bomItemId,
      物料编码: inquiry.materialCode,
      物料名称: inquiry.materialName,
      规格型号: inquiry.specification,
      供应商: inquiry.supplierName,
      需求数量: inquiry.quantity,
      需求日期: inquiry.requiredDate,
      报价: inquiry.price,
      交期: inquiry.deliveryDate,
      状态: inquiry.status,
      创建时间: inquiry.createdAt ?? new Date().toISOString(),
    });
    return this.recordToInquiry(rec);
  }

  async updateInquiry(recordId: string, patch: Partial<Inquiry>): Promise<Inquiry & { recordId: string }> {
    const fields: Record<string, unknown> = {};
    if (patch.supplierName !== undefined) fields["供应商"] = patch.supplierName;
    if (patch.price !== undefined) fields["报价"] = patch.price;
    if (patch.deliveryDate !== undefined) fields["交期"] = patch.deliveryDate;
    if (patch.status !== undefined) fields["状态"] = patch.status;
    if (patch.requiredDate !== undefined) fields["需求日期"] = patch.requiredDate;
    const rec = await this.updateRecord("inquiries", recordId, fields);
    return this.recordToInquiry(rec);
  }

  private recordToInquiry(r: BitableRecord): Inquiry & { recordId: string } {
    const f = r.fields;
    return {
      recordId: r.record_id,
      inquiryId: fieldText(f["询价单号"] ?? f["inquiryId"]) || r.record_id,
      reviewId: fieldText(f["关联评审单"] ?? f["reviewId"]),
      bomItemId: fieldText(f["关联物料"] ?? f["bomItemId"]),
      materialCode: fieldText(f["物料编码"] ?? f["materialCode"]) || undefined,
      materialName: fieldText(f["物料名称"] ?? f["materialName"]) || undefined,
      specification: fieldText(f["规格型号"] ?? f["specification"]) || undefined,
      supplierName: fieldText(f["供应商"] ?? f["supplierName"]),
      quantity: fieldNum(f["需求数量"] ?? f["quantity"]) ?? 0,
      requiredDate: fieldText(f["需求日期"] ?? f["requiredDate"]) || undefined,
      price: fieldNum(f["报价"] ?? f["price"]) ?? undefined,
      deliveryDate: fieldText(f["交期"] ?? f["deliveryDate"]) || undefined,
      status: (fieldText(f["状态"] ?? f["status"]) as Inquiry["status"]) || "sent",
      createdAt: fieldText(f["创建时间"] ?? f["createdAt"]) || undefined,
    };
  }

  // ---------- 流程事件 ----------

  async listEvents(reviewId?: string): Promise<ProcessEvent[]> {
    const records = await this.listRecords("events");
    return records
      .map((r) => {
        const f = r.fields;
        const ts = parseTimeValue(f["操作时间"] ?? f["createdAt"]);
        let payload: Record<string, unknown> | undefined;
        const rawPayload = fieldText(f["附加信息"] ?? f["payload"]);
        if (rawPayload) {
          try {
            payload = JSON.parse(rawPayload) as Record<string, unknown>;
          } catch {
            payload = undefined;
          }
        }
        return {
          eventId: fieldText(f["事件ID"] ?? f["eventId"]) || r.record_id,
          reviewId: fieldText(f["关联评审单"] ?? f["reviewId"]),
          actorId: fieldText(f["操作人"] ?? f["actorId"]),
          action: fieldText(f["动作"] ?? f["action"]),
          fromStatus: (fieldText(f["原状态"] ?? f["fromStatus"]) as ReviewStatus) || undefined,
          toStatus: (fieldText(f["新状态"] ?? f["toStatus"]) as ReviewStatus) || undefined,
          payload,
          createdAt: ts ? new Date(ts).toISOString() : "",
        } satisfies ProcessEvent;
      })
      .filter((e) => !reviewId || e.reviewId === reviewId);
  }
}

/** 时间字段解析：优先 Date.parse（ISO），失败回退 fieldTs 的中文/斜杠格式归一化 */
function parseTimeValue(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = fieldText(v).trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return t;
  return fieldTs(v);
}
