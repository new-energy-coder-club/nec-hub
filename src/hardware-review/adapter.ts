/**
 * 硬件评审流程 — 飞书 Base 数据适配器
 *
 * 负责把业务对象 ↔ Base 记录字段做双向映射。
 * 字段名不强制固定，通过中文字段名 + 英文别名兜底匹配（同 drawing-review 适配器模式）。
 * 通用 CRUD 骨架继承自 shared/FeishuTableAdapter。
 */

import {
  BitableRecord,
  fieldText,
} from "../feishu/bitable";
import { FeishuTableAdapter } from "../shared/feishu-table-adapter";
import type {
  Attachment,
  HardwareReview,
  HardwareReviewConfig,
  HardwareReviewTable,
  HardwareType,
  ReportChecklistItem,
  ReviewConclusion,
  ReviewMinutes,
  ReviewReport,
  ReviewStatus,
} from "./types";

export class HardwareReviewAdapter extends FeishuTableAdapter<HardwareReviewConfig, HardwareReviewTable> {
  constructor(env: Env, cfg: HardwareReviewConfig) {
    super(env, cfg, "硬件评审流程");
  }

  // ---------- 硬件评审单 ----------

  async listReviews(): Promise<Array<HardwareReview & { recordId: string }>> {
    const records = await this.listRecords("reviews");
    return records.map((r) => this.recordToReview(r));
  }

  async getReview(recordId: string): Promise<(HardwareReview & { recordId: string }) | null> {
    // 按 record_id 直连 GET /records/:record_id，不再全表扫描
    const rec = await this.getRecord("reviews", recordId);
    return rec ? this.recordToReview(rec) : null;
  }

  async findReviewById(reviewId: string): Promise<(HardwareReview & { recordId: string }) | null> {
    // filter 下推按「评审单号」精确查；search 失败（表用英文别名等）回退全表扫描（match 与原逻辑一致）
    const records = await this.queryRecords(
      "reviews",
      [{ field_name: "评审单号", operator: "is", value: [reviewId] }],
      (r) => fieldText(r.fields["评审单号"]) === reviewId || fieldText(r.fields["reviewId"]) === reviewId,
    );
    const rec = records[0];
    return rec ? this.recordToReview(rec) : null;
  }

  async createReview(review: HardwareReview): Promise<HardwareReview & { recordId: string }> {
    const fields = this.reviewToFields(review);
    const rec = await this.createRecord("reviews", fields);
    return this.recordToReview(rec);
  }

  async updateReview(recordId: string, review: Partial<HardwareReview>): Promise<HardwareReview & { recordId: string }> {
    const fields = this.reviewToFields(review as HardwareReview, true);
    const rec = await this.updateRecord("reviews", recordId, fields);
    return this.recordToReview(rec);
  }

  private recordToReview(r: BitableRecord): HardwareReview & { recordId: string } {
    const f = r.fields;
    return {
      recordId: r.record_id,
      reviewId: fieldText(f["评审单号"] ?? f["reviewId"]),
      projectId: fieldText(f["项目编号"] ?? f["projectId"]),
      hardwareName: fieldText(f["硬件名称"] ?? f["hardwareName"]),
      hardwareType: (fieldText(f["硬件类型"] ?? f["hardwareType"]) as HardwareType) || "other",
      hardwareVersion: fieldText(f["硬件版本"] ?? f["hardwareVersion"]),
      designerId: fieldText(f["设计负责人"] ?? f["designerId"]),
      hardwareFiles: parseAttachments(f["硬件资料"] ?? f["hardwareFiles"]),
      designNotes: fieldText(f["设计说明"] ?? f["designNotes"]),
      specification: fieldText(f["规格参数"] ?? f["specification"]),
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

  private reviewToFields(review: Partial<HardwareReview>, partial = false): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    const map: Record<string, keyof HardwareReview> = {
      评审单号: "reviewId",
      项目编号: "projectId",
      硬件名称: "hardwareName",
      硬件类型: "hardwareType",
      硬件版本: "hardwareVersion",
      设计负责人: "designerId",
      设计说明: "designNotes",
      规格参数: "specification",
      状态: "status",
      会议ID: "meetingId",
      会议链接: "meetingLink",
      会议开始时间: "meetingStartTime",
      评审结论: "conclusion",
      评审结论说明: "conclusionNotes",
    };
    for (const [fieldName, key] of Object.entries(map)) {
      const v = review[key];
      if (v !== undefined) fields[fieldName] = v;
    }
    // 降级：Base 评审单表暂无原生附件列，且前端附件 token 实为 R2 key（非飞书 file_token），
    // 附件数组序列化为 JSON 存入文本字段「硬件资料」；读取侧兼容原生附件数组，便于日后升级为附件列
    if (review.hardwareFiles !== undefined) fields["硬件资料"] = JSON.stringify(review.hardwareFiles);
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

  // ---------- 评审报告 ----------

  async createReport(report: ReviewReport): Promise<ReviewReport & { recordId: string }> {
    const rec = await this.createRecord("reports", {
      关联评审单: report.reviewId,
      报告编号: report.reportId,
      版本: report.version,
      总结: report.summary,
      检查清单: JSON.stringify(report.checklist),
      结果: report.result,
      状态: report.status,
      创建时间: report.createdAt,
    });
    return { ...report, recordId: rec.record_id };
  }

  async getReportByReview(reviewId: string): Promise<(ReviewReport & { recordId: string }) | null> {
    // filter 下推按「关联评审单」只拉本单报告；search 失败回退全表扫描（match 与原逻辑一致）
    const records = await this.queryRecords(
      "reports",
      [{ field_name: "关联评审单", operator: "is", value: [reviewId] }],
      (r) => fieldText(r.fields["关联评审单"]) === reviewId,
    );
    const rec = records[0];
    if (!rec) return null;
    let checklist: ReportChecklistItem[] = [];
    try {
      const raw = fieldText(rec.fields["检查清单"]);
      if (raw) checklist = JSON.parse(raw) as ReportChecklistItem[];
    } catch {
      checklist = [];
    }
    return {
      recordId: rec.record_id,
      reportId: fieldText(rec.fields["报告编号"] ?? rec.fields["reportId"]) || rec.record_id,
      reviewId,
      version: fieldText(rec.fields["版本"] ?? rec.fields["version"]) || "1.0",
      summary: fieldText(rec.fields["总结"] ?? rec.fields["summary"]),
      checklist,
      result: (fieldText(rec.fields["结果"] ?? rec.fields["result"]) as "pass" | "fail") || "fail",
      status: (fieldText(rec.fields["状态"] ?? rec.fields["status"]) as "draft" | "confirmed") || "draft",
      createdAt: fieldText(rec.fields["创建时间"] ?? rec.fields["createdAt"]) || new Date().toISOString(),
    };
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
