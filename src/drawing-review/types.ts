/**
 * 新增机图纸评审流程 — 核心类型定义
 */

import type { Attachment, ModuleConfigFeatures, ReviewConclusion } from "../shared/types";

// 跨模块逐字重复的通用类型统一由 ../shared/types 提供，此处 re-export 保持既有 import 路径
export type { ActionItem, Attachment, ReviewConclusion, ReviewIssue, ReviewMinutes, UserRef } from "../shared/types";

export type ReviewStatus =
  | "draft" // 待提交
  | "pending_review" // 待评审
  | "in_review" // 评审中
  | "rectifying" // 待整改
  | "bom_generating" // BOM生成中
  | "assessing" // 评估中
  | "scheduling" // 排期中
  | "procuring" // 采购中
  | "archived"; // 已归档

export type AssessmentType = "electrical" | "wiring";
export type AssessmentResult = "pass" | "fail";

export type BOMSource = "self-made" | "purchased" | "standard";
export type BOMProcess = "machining" | "sheet-metal" | "welding" | "injection" | "standard" | "purchased";

export interface DrawingReview {
  reviewId: string;
  projectId: string;
  machineName: string;
  drawingVersion: string;
  designerId: string;
  drawingFiles: Attachment[];
  designNotes: string;
  status: ReviewStatus;
  meetingId?: string;
  meetingLink?: string;
  meetingStartTime?: string;
  conclusion?: ReviewConclusion;
  conclusionNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BOM {
  bomId: string;
  reviewId: string;
  version: string;
  totalCostEstimate?: number;
  status: "draft" | "confirmed";
}

export interface BOMItem {
  itemId: string;
  bomId: string;
  parentItemId?: string;
  level: number;
  materialCode?: string;
  materialName: string;
  specification: string;
  quantity: number;
  unit: string;
  material?: string;
  process?: BOMProcess;
  source: BOMSource;
  drawingNo?: string;
  remark?: string;
}

export interface Assessment {
  assessmentId: string;
  reviewId: string;
  type: AssessmentType;
  assessorId: string;
  content: AssessmentContent;
  result: AssessmentResult;
  attachments: Attachment[];
  createdAt: string;
}

export interface AssessmentContent {
  summary: string;
  checklist: Array<{ item: string; result: "pass" | "fail" | "na"; note?: string }>;
}

export interface InventoryResult {
  bomItemId: string;
  materialCode?: string;
  materialName: string;
  requiredQty: number;
  availableQty: number;
  inTransitQty: number;
  wipQty: number;
  warehouseLocation?: string;
  mesLocation?: string;
  status: "sufficient" | "insufficient" | "out_of_stock" | "in_wip";
}

export interface DeliveryList {
  deliveryId: string;
  reviewId: string;
  batchNo: string;
  status: "draft" | "confirmed";
}

export interface DeliveryItem {
  itemId: string;
  deliveryId: string;
  bomItemId: string;
  quantity: number;
  warehouseLocation?: string;
  mesLocation?: string;
  packageType: string;
  shippingMethod: string;
  estimatedDate: string;
  remark?: string;
}

export interface ScheduleTask {
  taskId: string;
  reviewId: string;
  name: string;
  ownerId: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  dependencies: string[];
  status: "pending" | "in_progress" | "completed";
}

export interface Inquiry {
  inquiryId: string;
  reviewId: string;
  bomItemId: string;
  materialCode?: string;
  materialName?: string;
  specification?: string;
  supplierName: string;
  quantity: number;
  requiredDate?: string;
  price?: number;
  deliveryDate?: string;
  status: "sent" | "quoted" | "selected" | "rejected";
  createdAt?: string;
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

export interface DrawingReviewConfig {
  base: string;
  tables: Partial<Record<DrawingReviewTable, string>>;
  updatedAt: string;
  features?: ModuleConfigFeatures;
}

export type DrawingReviewTable =
  | "reviews"
  | "minutes"
  | "rectifications"
  | "bom"
  | "assessments"
  | "inventory"
  | "delivery"
  | "schedule"
  | "inquiries"
  | "events";
