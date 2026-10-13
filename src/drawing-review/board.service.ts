/**
 * 新增机图纸评审流程 — 流程看板聚合（PRD §3.12）
 *
 * 输出：状态计数、阻塞预警清单（声明式规则）、甘特图关键节点时间。
 * 飞书读取失败时降级：对应区块返回空数据并在 warnings 中说明，不抛 500。
 */

import { fieldText, fieldTs } from "../feishu/bitable";
import type { BaseAdapter } from "./adapter";
import type { DrawingReview, ProcessEvent, ReviewStatus } from "./types";

/** 状态滞留超时规则（小时） */
export const BLOCKER_RULES = [
  { id: "pending_review_timeout", status: "pending_review" as ReviewStatus, hours: 48, label: "待评审超 48h 未安排会议" },
  { id: "rectifying_timeout", status: "rectifying" as ReviewStatus, hours: 72, label: "待整改超 72h 未完成" },
] as const;

/** 询价发出后未报价的超时阈值（小时） */
export const INQUIRY_QUOTE_TIMEOUT_HOURS = 72;

/** 库存预警命中的状态值（中英文兼容） */
export const SHORTAGE_STATUS = ["无库存", "不足", "out_of_stock", "insufficient"];

export interface BoardBlocker {
  reviewId: string;
  machineName: string;
  ruleId: string;
  message: string;
  since: string;
  hoursBlocked: number;
}

export interface BoardGanttRow {
  reviewId: string;
  machineName: string;
  status: ReviewStatus;
  milestones: {
    submit?: string;
    meeting?: string;
    conclusion?: string;
    bom?: string;
    archived?: string;
  };
}

export interface BoardData {
  statusCounts: Partial<Record<ReviewStatus, number>>;
  blockers: BoardBlocker[];
  gantt: BoardGanttRow[];
  warnings: string[];
  generatedAt: string;
}

const HOUR_MS = 3600_000;

/** 甘特图里程碑对应的事件动作（取最早一条） */
const MILESTONE_ACTIONS: Record<keyof BoardGanttRow["milestones"], (e: ProcessEvent) => boolean> = {
  submit: (e) => e.action === "submit",
  meeting: (e) => e.action === "start_meeting",
  conclusion: (e) => e.action === "conclude",
  bom: (e) => e.action === "generated" || e.action === "bom_generate",
  archived: (e) => e.toStatus === "archived",
};

export class BoardService {
  constructor(private adapter: BaseAdapter) {}

  async build(now: number = Date.now()): Promise<BoardData> {
    const warnings: string[] = [];

    let reviews: Array<DrawingReview & { recordId: string }> = [];
    try {
      reviews = await this.adapter.listReviews();
    } catch (err) {
      warnings.push(`评审单读取失败：${err instanceof Error ? err.message : String(err)}`);
    }

    let events: ProcessEvent[] = [];
    try {
      events = await this.adapter.listEvents();
    } catch (err) {
      warnings.push(`流程事件读取失败：${err instanceof Error ? err.message : String(err)}`);
    }

    const statusCounts: Partial<Record<ReviewStatus, number>> = {};
    for (const r of reviews) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;

    const reviewMap = new Map(reviews.map((r) => [r.reviewId, r]));
    const blockers: BoardBlocker[] = [];

    // 规则一/二：状态滞留超时（since 取进入当前状态的事件时间，无事件回退 updatedAt）
    for (const rule of BLOCKER_RULES) {
      for (const r of reviews) {
        if (r.status !== rule.status) continue;
        const entered = latestEventTime(events, r.reviewId, (e) => e.toStatus === rule.status) ?? r.updatedAt;
        const hours = hoursSince(entered, now);
        if (hours != null && hours > rule.hours) {
          blockers.push({
            reviewId: r.reviewId,
            machineName: r.machineName,
            ruleId: rule.id,
            message: rule.label,
            since: entered,
            hoursBlocked: Math.round(hours),
          });
        }
      }
    }

    // 规则三：询价发出超 72h 未报价
    try {
      const inquiries = await this.adapter.listInquiries();
      for (const inq of inquiries) {
        if (inq.status !== "sent" || !inq.createdAt) continue;
        const hours = hoursSince(inq.createdAt, now);
        if (hours != null && hours > INQUIRY_QUOTE_TIMEOUT_HOURS) {
          const review = reviewMap.get(inq.reviewId);
          blockers.push({
            reviewId: inq.reviewId,
            machineName: review?.machineName ?? "",
            ruleId: "inquiry_no_quote",
            message: `询价单 ${inq.inquiryId}（${inq.materialName ?? inq.bomItemId}）发出超 ${INQUIRY_QUOTE_TIMEOUT_HOURS}h 未报价`,
            since: inq.createdAt,
            hoursBlocked: Math.round(hours),
          });
        }
      }
    } catch (err) {
      warnings.push(`询价单读取失败：${err instanceof Error ? err.message : String(err)}`);
    }

    // 规则四：库存不足/无库存
    try {
      const inventory = await this.adapter.listRecords("inventory");
      for (const rec of inventory) {
        const statusText = fieldText(rec.fields["库存状态"] ?? rec.fields["状态"] ?? rec.fields["status"]);
        if (!SHORTAGE_STATUS.includes(statusText)) continue;
        const reviewId = fieldText(rec.fields["关联评审单"] ?? rec.fields["reviewId"]);
        if (!reviewId) continue;
        const review = reviewMap.get(reviewId);
        blockers.push({
          reviewId,
          machineName: review?.machineName ?? "",
          ruleId: "material_shortage",
          message: `物料 ${fieldText(rec.fields["物料名称"] ?? rec.fields["materialName"]) || "未知"} 库存状态=${statusText}`,
          since: review?.updatedAt ?? "",
          hoursBlocked: 0,
        });
      }
    } catch (err) {
      warnings.push(`库存表读取失败：${err instanceof Error ? err.message : String(err)}`);
    }

    // 甘特图：进行中（未归档）评审单的关键节点时间
    const gantt: BoardGanttRow[] = reviews
      .filter((r) => r.status !== "archived")
      .map((r) => {
        const milestones: BoardGanttRow["milestones"] = {};
        for (const [key, match] of Object.entries(MILESTONE_ACTIONS) as Array<[keyof BoardGanttRow["milestones"], (e: ProcessEvent) => boolean]>) {
          const t = earliestEventTime(events, r.reviewId, match);
          if (t) milestones[key] = t;
        }
        if (!milestones.submit && r.createdAt) milestones.submit = r.createdAt;
        return { reviewId: r.reviewId, machineName: r.machineName, status: r.status, milestones };
      });

    blockers.sort((a, b) => b.hoursBlocked - a.hoursBlocked);
    return { statusCounts, blockers, gantt, warnings, generatedAt: new Date(now).toISOString() };
  }
}

function hoursSince(iso: string, now: number): number | null {
  const ts = fieldTs(iso);
  if (ts == null) return null;
  return (now - ts) / HOUR_MS;
}

function latestEventTime(events: ProcessEvent[], reviewId: string, match: (e: ProcessEvent) => boolean): string | null {
  let latest: number | null = null;
  for (const e of events) {
    if (e.reviewId !== reviewId || !match(e)) continue;
    const ts = fieldTs(e.createdAt);
    if (ts != null && (latest == null || ts > latest)) latest = ts;
  }
  return latest != null ? new Date(latest).toISOString() : null;
}

function earliestEventTime(events: ProcessEvent[], reviewId: string, match: (e: ProcessEvent) => boolean): string | undefined {
  let earliest: number | null = null;
  for (const e of events) {
    if (e.reviewId !== reviewId || !match(e)) continue;
    const ts = fieldTs(e.createdAt);
    if (ts != null && (earliest == null || ts < earliest)) earliest = ts;
  }
  return earliest != null ? new Date(earliest).toISOString() : undefined;
}
