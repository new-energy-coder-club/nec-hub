/**
 * 硬件评审流程 — 核心类型定义
 *
 * 与新增机图纸评审（drawing-review）同构，业务对象从「图纸」换成「硬件」：
 * 提交硬件评审单 → 预约评审会 → 保存纪要与结论 → 生成评审报告 → 评估 → 归档。
 */

import type { Attachment, ModuleConfigFeatures, ReviewConclusion } from "../shared/types";

// 跨模块逐字重复的通用类型统一由 ../shared/types 提供，此处 re-export 保持既有 import 路径
export type { ActionItem, Attachment, ReviewConclusion, ReviewIssue, ReviewMinutes, UserRef } from "../shared/types";

export type ReviewStatus =
  | "draft" // 待提交
  | "pending_review" // 待评审
  | "in_review" // 评审中
  | "rectifying" // 待整改
  | "report_generating" // 报告生成中
  | "assessing" // 评估中
  | "approved" // 已通过
  | "archived"; // 已归档

export type HardwareType =
  | "controller" // 控制器
  | "sensor" // 传感器
  | "actuator" // 执行器
  | "motor" // 电机/驱动
  | "power" // 电源/电池
  | "communication" // 通信模块
  | "structure" // 结构件
  | "other"; // 其他

export interface HardwareReview {
  reviewId: string;
  projectId: string;
  hardwareName: string;
  hardwareType: HardwareType;
  hardwareVersion: string;
  designerId: string;
  hardwareFiles: Attachment[];
  designNotes: string;
  /** 规格参数（电压/电流/功率/接口/防护等级等自由文本） */
  specification: string;
  status: ReviewStatus;
  meetingId?: string;
  meetingLink?: string;
  meetingStartTime?: string;
  conclusion?: ReviewConclusion;
  conclusionNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportChecklistItem {
  /** 检查项描述 */
  item: string;
  /** 分类：电气安全 / 性能指标 / 兼容性 / 可靠性 / 成本 等 */
  category?: string;
  result: "pass" | "fail" | "na";
  note?: string;
}

export interface ReviewReport {
  reportId: string;
  reviewId: string;
  version: string;
  summary: string;
  checklist: ReportChecklistItem[];
  /** 由 checklist 汇总：全部 pass/na → pass，存在 fail → fail */
  result: "pass" | "fail";
  status: "draft" | "confirmed";
  createdAt: string;
}

export interface ProcessEvent {
  eventId: string;
  reviewId: string;
  actorId: string;
  action: string;
  fromStatus?: ReviewStatus;
  toStatus?: ReviewStatus;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface HardwareReviewConfig {
  base: string;
  tables: Partial<Record<HardwareReviewTable, string>>;
  updatedAt: string;
  features?: ModuleConfigFeatures;
}

export type HardwareReviewTable = "reviews" | "minutes" | "rectifications" | "reports" | "events";
