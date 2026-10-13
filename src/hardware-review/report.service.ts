/**
 * 硬件评审流程 — 评审报告生成服务
 *
 * 评审通过后汇总检查清单生成《硬件评审报告》；
 * 结果由清单自动汇总：存在 fail → fail，否则 pass。
 */

import type { HardwareReviewAdapter } from "./adapter";
import type { ReportChecklistItem, ReviewReport } from "./types";

export interface GenerateReportInput {
  summary?: string;
  checklist?: Array<Partial<ReportChecklistItem> & Pick<ReportChecklistItem, "item" | "result">>;
}

export class ReportService {
  constructor(private adapter: HardwareReviewAdapter) {}

  async generate(reviewId: string, input: GenerateReportInput): Promise<ReviewReport & { recordId: string }> {
    const checklist: ReportChecklistItem[] = (input.checklist ?? []).map((it) => ({
      item: it.item,
      category: it.category,
      result: it.result,
      note: it.note,
    }));
    const result: ReviewReport["result"] = checklist.some((it) => it.result === "fail") ? "fail" : "pass";

    const report: ReviewReport = {
      reportId: `RPT-${reviewId}-${Date.now()}`,
      reviewId,
      version: "1.0",
      summary: input.summary || "",
      checklist,
      result,
      status: "draft",
      createdAt: new Date().toISOString(),
    };

    return this.adapter.createReport(report);
  }
}
