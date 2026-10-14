/**
 * 新增机图纸评审流程 — 流程看板聚合（PRD §3.12）
 *
 * 输出：状态计数、阻塞预警清单（声明式规则）、甘特图关键节点时间。
 * 飞书读取失败时降级：对应区块返回空数据并在 warnings 中说明，不抛 500。
 */

import { fieldText, fieldTs } from "../feishu/bitable";
import type { DrawingReviewAdapter } from "./adapter";
import type { ProcessEvent, ReviewStatus } from "./types";

/** 时间解析：优先 Date.parse（ISO），失败回退 fieldTs 的中文/斜杠格式归一化 */
function parseTime(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = fieldText(v).trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return t;
  return fieldTs(v);
}

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
  constructor(private adapter: DrawingReviewAdapter) {}

  async build(now: number = Date.now()): Promise<BoardData> {
    const warnings: string[] = [];

    // 4 张表互不依赖，并行拉取；单表失败降级为空数据并记 warning（顺序保持固定）
    const [reviewsR, eventsR, inquiriesR, inventoryR] = await Promise.all([
      this.adapter.listReviews().then(ok, fail),
      this.adapter.listEvents().then(ok, fail),
      this.adapter.listInquiries().then(ok, fail),
      this.adapter.listRecords("inventory").then(ok, fail),
    ]);
    const reviews = reviewsR.value ?? [];
    if (reviewsR.error) warnings.push(`评审单读取失败：${reviewsR.error}`);
    const events = eventsR.value ?? [];
    if (eventsR.error) warnings.push(`流程事件读取失败：${eventsR.error}`);
    const inquiries = inquiriesR.value ?? [];
    if (inquiriesR.error) warnings.push(`询价单读取失败：${inquiriesR.error}`);
    const inventory = inventoryR.value ?? [];
    if (inventoryR.error) warnings.push(`库存表读取失败：${inventoryR.error}`);

    const statusCounts: Partial<Record<ReviewStatus, number>> = {};
    for (const r of reviews) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;

    const reviewMap = new Map(reviews.map((r) => [r.reviewId, r]));
    // 事件按评审单分组：后续阻塞规则与甘特图只扫本单事件，避免 评审单×全量事件 的重复扫描
    const eventsByReview = new Map<string, ProcessEvent[]>();
    for (const e of events) {
      const list = eventsByReview.get(e.reviewId);
      if (list) list.push(e);
      else eventsByReview.set(e.reviewId, [e]);
    }
    const blockers: BoardBlocker[] = [];

    // 规则一/二：状态滞留超时（since 取进入当前状态的事件时间，无事件回退 updatedAt）
    for (const rule of BLOCKER_RULES) {
      for (const r of reviews) {
        if (r.status !== rule.status) continue;
        const entered = latestEventTime(eventsByReview.get(r.reviewId) ?? [], (e) => e.toStatus === rule.status) ?? r.updatedAt;
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

    // 规则四：库存不足/无库存
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

    // 甘特图：进行中（未归档）评审单的关键节点时间
    const gantt: BoardGanttRow[] = reviews
      .filter((r) => r.status !== "archived")
      .map((r) => {
        const reviewEvents = eventsByReview.get(r.reviewId) ?? [];
        const milestones: BoardGanttRow["milestones"] = {};
        for (const [key, match] of Object.entries(MILESTONE_ACTIONS) as Array<[keyof BoardGanttRow["milestones"], (e: ProcessEvent) => boolean]>) {
          const t = earliestEventTime(reviewEvents, match);
          if (t) milestones[key] = t;
        }
        if (!milestones.submit && r.createdAt) milestones.submit = r.createdAt;
        return { reviewId: r.reviewId, machineName: r.machineName, status: r.status, milestones };
      });

    blockers.sort((a, b) => b.hoursBlocked - a.hoursBlocked);
    return { statusCounts, blockers, gantt, warnings, generatedAt: new Date(now).toISOString() };
  }
}

function ok<T>(value: T[]): { value: T[]; error: null } {
  return { value, error: null };
}

function fail(err: unknown): { value: null; error: string } {
  return { value: null, error: err instanceof Error ? err.message : String(err) };
}

function hoursSince(iso: string, now: number): number | null {
  const ts = parseTime(iso);
  if (ts == null) return null;
  return (now - ts) / HOUR_MS;
}

function latestEventTime(events: ProcessEvent[], match: (e: ProcessEvent) => boolean): string | null {
  let latest: number | null = null;
  for (const e of events) {
    if (!match(e)) continue;
    const ts = parseTime(e.createdAt);
    if (ts != null && (latest == null || ts > latest)) latest = ts;
  }
  return latest != null ? new Date(latest).toISOString() : null;
}

function earliestEventTime(events: ProcessEvent[], match: (e: ProcessEvent) => boolean): string | undefined {
  let earliest: number | null = null;
  for (const e of events) {
    if (!match(e)) continue;
    const ts = parseTime(e.createdAt);
    if (ts != null && (earliest == null || ts < earliest)) earliest = ts;
  }
  return earliest != null ? new Date(earliest).toISOString() : undefined;
}
