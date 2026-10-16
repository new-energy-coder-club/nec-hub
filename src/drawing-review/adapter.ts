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
  type BitableCondition,
} from "../feishu/bitable";
import { FeishuTableAdapter } from "../shared/feishu-table-adapter";
import type {
  Attachment,
  BOM,
  BOMItem,
  DrawingReview,
  DrawingReviewConfig,
  DrawingReviewTable,
  Inquiry,
  InventoryRecord,
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
    // 按 record_id 直连 GET /records/:record_id，不再全表扫描
    const rec = await this.getRecord("reviews", recordId);
    return rec ? this.recordToReview(rec) : null;
  }

  async findReviewById(reviewId: string): Promise<(DrawingReview & { recordId: string }) | null> {
    // filter 下推按「评审单号」精确查；search 失败（表用英文别名等）回退全表扫描（match 与原逻辑一致）
    const records = await this.queryRecords(
      "reviews",
      [{ field_name: "评审单号", operator: "is", value: [reviewId] }],
      (r) => fieldText(r.fields["评审单号"]) === reviewId || fieldText(r.fields["reviewId"]) === reviewId,
    );
    const rec = records[0];
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
    const limit = pattern.limit || 10;
    // filter 下推：等值条件用 is，子串条件用 contains（飞书 contains 大小写行为未明确，
    // 故 match 保留原内存谓词二次确认，且 fallbackOnEmpty 在查空时回退全表扫描兜底）；
    // 无任何条件时保持全表扫描
    const conditions: BitableCondition[] = [];
    if (pattern.projectId) conditions.push({ field_name: "项目编号", operator: "contains", value: [pattern.projectId] });
    if (pattern.machineName) conditions.push({ field_name: "机型名称", operator: "contains", value: [pattern.machineName] });
    if (pattern.designerId) conditions.push({ field_name: "设计负责人", operator: "is", value: [pattern.designerId] });
    if (pattern.status) conditions.push({ field_name: "状态", operator: "is", value: [pattern.status] });
    const match = (r: BitableRecord): boolean => {
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
    };
    const records = conditions.length
      ? await this.queryRecords("reviews", conditions, match, { fallbackOnEmpty: true })
      : await this.listRecords("reviews");

    return records
      .filter(match)
      .map(r => this.recordToReview(r))
      .slice(0, limit);
  }

  /**
   * 获取项目编号联想列表（去重）
   */
  async getProjectSuggestions(query: string, limit: number = 5): Promise<string[]> {
    // filter 下推 contains 子串；空查询 / 查空 / search 失败时回退全表扫描（大小写兜底）
    const match = (r: BitableRecord): boolean =>
      fieldText(r.fields["项目编号"]).toLowerCase().includes(query.toLowerCase());
    const records = query
      ? await this.queryRecords(
          "reviews",
          [{ field_name: "项目编号", operator: "contains", value: [query] }],
          match,
          { fallbackOnEmpty: true },
        )
      : await this.listRecords("reviews");
    const projects = new Set<string>();

    records.forEach(r => {
      const projectId = fieldText(r.fields["项目编号"]);
      if (projectId && match(r)) {
        projects.add(projectId);
      }
    });

    return Array.from(projects).slice(0, limit);
  }

  /**
   * 获取机型名称联想列表（去重）
   */
  async getMachineSuggestions(query: string, limit: number = 5): Promise<string[]> {
    // filter 下推 contains 子串；空查询 / 查空 / search 失败时回退全表扫描（大小写兜底）
    const match = (r: BitableRecord): boolean =>
      fieldText(r.fields["机型名称"]).toLowerCase().includes(query.toLowerCase());
    const records = query
      ? await this.queryRecords(
          "reviews",
          [{ field_name: "机型名称", operator: "contains", value: [query] }],
          match,
          { fallbackOnEmpty: true },
        )
      : await this.listRecords("reviews");
    const machines = new Set<string>();

    records.forEach(r => {
      const machineName = fieldText(r.fields["机型名称"]);
      if (machineName && match(r)) {
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
      drawingFiles: parseAttachments(f["图纸文件"] ?? f["drawingFiles"]),
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
    // 降级：Base 评审单表暂无原生附件列，且前端附件 token 实为 R2 key（非飞书 file_token），
    // 附件数组序列化为 JSON 存入文本字段「图纸文件」；读取侧兼容原生附件数组，便于日后升级为附件列
    if (review.drawingFiles !== undefined) fields["图纸文件"] = JSON.stringify(review.drawingFiles);
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
      关联评审单: minutes.reviewId,
      会议时间: minutes.meetingTime,
      参会人员: minutes.attendees.map((a) => a.name || a.open_id).join("、"),
      讨论记录: minutes.discussion,
      评审结论: minutes.conclusion,
    };
    const rec = await this.createRecord("minutes", fields);
    return { ...minutes, recordId: rec.record_id };
  }

  async getMinutesByReview(reviewId: string): Promise<Array<ReviewMinutes & { recordId: string }>> {
    // filter 下推按「关联评审单」只拉本单纪要；search 失败回退全表扫描（match 与原逻辑一致）
    const records = await this.queryRecords(
      "minutes",
      [{ field_name: "关联评审单", operator: "is", value: [reviewId] }],
      (r) => fieldText(r.fields["关联评审单"]) === reviewId,
    );
    return records
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
    await Promise.all(
      items.map((item) =>
        createBitableRecord(token, this.cfg.base, tableId, {
          关联BOM: bomId,
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
        }),
      ),
    );
  }

  async getBOMByReview(reviewId: string): Promise<{ bom: BOM & { recordId: string }; items: Array<BOMItem & { recordId: string }> } | null> {
    // filter 下推：先按「关联评审单」找 BOM 头，再按「关联BOM」找物料行（均为 search 失败回退全表扫描）
    const heads = await this.queryRecords(
      "bom",
      [{ field_name: "关联评审单", operator: "is", value: [reviewId] }],
      (r) => fieldText(r.fields["关联评审单"]) === reviewId,
    );
    const rec = heads[0];
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
    // filter 下推按「关联BOM」只拉本 BOM 的物料行；search 失败回退全表扫描（match 与原逻辑一致）
    const records = await this.queryRecords(
      "bom",
      [{ field_name: "关联BOM", operator: "is", value: [bomId] }],
      (r) => fieldText(r.fields["关联BOM"] ?? r.fields["bomId"]) === bomId,
    );
    return records.map((r) => this.recordToBOMItem(r, bomId));
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
    // 带 reviewId 时 filter 下推按「关联评审单」只拉本单询价；不带条件（看板聚合）保持全表扫描
    const records = reviewId
      ? await this.queryRecords(
          "inquiries",
          [{ field_name: "关联评审单", operator: "is", value: [reviewId] }],
          (r) => fieldText(r.fields["关联评审单"] ?? r.fields["reviewId"]) === reviewId,
        )
      : await this.listRecords("inquiries");
    return records
      .map((r) => this.recordToInquiry(r))
      .filter((i) => !reviewId || i.reviewId === reviewId);
  }

  async findInquiryById(inquiryId: string): Promise<(Inquiry & { recordId: string }) | null> {
    // filter 下推按「询价单号」精确查；search 失败回退全表扫描（match 与原逻辑一致）
    const records = await this.queryRecords(
      "inquiries",
      [{ field_name: "询价单号", operator: "is", value: [inquiryId] }],
      (r) => fieldText(r.fields["询价单号"] ?? r.fields["inquiryId"]) === inquiryId,
    );
    const rec = records[0];
    return rec ? this.recordToInquiry(rec) : null;
  }

  async createInquiry(inquiry: Inquiry): Promise<Inquiry & { recordId: string }> {
    const rec = await this.createRecord("inquiries", {
      询价单号: inquiry.inquiryId,
      关联评审单: inquiry.reviewId,
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

  // ---------- 库存（手动导入兜底，PRD §13.7） ----------

  /** 按评审单查询库存行（字段口径与 board.service 读取一致：关联评审单/物料编码/物料名称） */
  async listInventoryByReview(reviewId: string): Promise<Array<InventoryRecord & { recordId: string }>> {
    // filter 下推按「关联评审单」只拉本单库存行；search 失败回退全表扫描（match 与原逻辑一致）
    const records = await this.queryRecords(
      "inventory",
      [{ field_name: "关联评审单", operator: "is", value: [reviewId] }],
      (r) => fieldText(r.fields["关联评审单"] ?? r.fields["reviewId"]) === reviewId,
    );
    return records
      .map((r) => this.recordToInventory(r))
      .filter((i) => i.reviewId === reviewId);
  }

  async createInventoryRow(row: InventoryRecord): Promise<InventoryRecord & { recordId: string }> {
    const rec = await this.createRecord("inventory", this.inventoryToFields(row));
    return this.recordToInventory(rec);
  }

  async updateInventoryRow(recordId: string, row: InventoryRecord): Promise<InventoryRecord & { recordId: string }> {
    const rec = await this.updateRecord("inventory", recordId, this.inventoryToFields(row));
    return this.recordToInventory(rec);
  }

  private inventoryToFields(row: InventoryRecord): Record<string, unknown> {
    return {
      物料编码: row.materialCode,
      物料名称: row.materialName,
      规格型号: row.specification,
      数量: row.quantity,
      单位: row.unit,
      仓库: row.warehouse,
      库位: row.location,
      来源: row.source ?? "手动导入",
      关联评审单: row.reviewId,
      导入人: row.importedBy,
      导入时间: row.importedAt ?? new Date().toISOString(),
    };
  }

  private recordToInventory(r: BitableRecord): InventoryRecord & { recordId: string } {
    const f = r.fields;
    return {
      recordId: r.record_id,
      materialCode: fieldText(f["物料编码"] ?? f["materialCode"]),
      materialName: fieldText(f["物料名称"] ?? f["materialName"]),
      specification: fieldText(f["规格型号"] ?? f["specification"]) || undefined,
      quantity: fieldNum(f["数量"] ?? f["quantity"]) ?? 0,
      unit: fieldText(f["单位"] ?? f["unit"]) || undefined,
      warehouse: fieldText(f["仓库"] ?? f["warehouse"]) || undefined,
      location: fieldText(f["库位"] ?? f["location"]) || undefined,
      source: fieldText(f["来源"] ?? f["source"]) || undefined,
      reviewId: fieldText(f["关联评审单"] ?? f["reviewId"]) || undefined,
      importedBy: fieldText(f["导入人"] ?? f["importedBy"]) || undefined,
      importedAt: fieldText(f["导入时间"] ?? f["importedAt"]) || undefined,
    };
  }

  // ---------- 流程事件 ----------

  async listEvents(reviewId?: string): Promise<ProcessEvent[]> {
    // 带 reviewId 时 filter 下推按「关联评审单」只拉本单事件；不带条件（看板聚合）保持全表扫描
    const records = reviewId
      ? await this.queryRecords(
          "events",
          [{ field_name: "关联评审单", operator: "is", value: [reviewId] }],
          (r) => fieldText(r.fields["关联评审单"] ?? r.fields["reviewId"]) === reviewId,
        )
      : await this.listRecords("events");
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

/**
 * 附件字段解析：兼容两种存储形式
 * 1. 文本字段中的 JSON 数组字符串（当前降级方案）；
 * 2. 飞书原生附件列的 [{file_token, name, size, url, ...}] 结构。
 */
function parseAttachments(v: unknown): Attachment[] {
  let arr: unknown = v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    try {
      arr = JSON.parse(s);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: Attachment[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const token = typeof o.token === "string" ? o.token : typeof o.file_token === "string" ? o.file_token : "";
    const name = typeof o.name === "string" ? o.name : "";
    if (!token && !name) continue;
    const att: Attachment = { name, token };
    if (typeof o.url === "string" && o.url) att.url = o.url;
    if (typeof o.size === "number" && Number.isFinite(o.size)) att.size = o.size;
    out.push(att);
  }
  return out;
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
