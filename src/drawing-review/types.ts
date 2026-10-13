/**
 * 新增机图纸评审流程 — 核心类型定义
 */

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

export type ReviewConclusion = "passed" | "conditional" | "rejected";

export type AssessmentType = "electrical" | "wiring";
export type AssessmentResult = "pass" | "fail";

export type BOMSource = "self-made" | "purchased" | "standard";
export type BOMProcess = "machining" | "sheet-metal" | "welding" | "injection" | "standard" | "purchased";

export interface Attachment {
  name: string;
  token: string;
  url?: string;
  size?: number;
}

export interface UserRef {
  open_id: string;
  name?: string;
}

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

export interface ReviewIssue {
  issueId: string;
  description: string;
  raisedBy: UserRef;
  owner?: UserRef;
  dueDate?: string;
  severity?: "low" | "medium" | "high";
  status: "open" | "closed";
}

export interface ActionItem {
  action: string;
  owner: UserRef;
  dueDate?: string;
}

export interface ReviewMinutes {
  minutesId: string;
  reviewId: string;
  meetingTime: string;
  attendees: UserRef[];
  topics: string[];
  discussion: string;
  issues: ReviewIssue[];
  conclusion: ReviewConclusion;
  nextActions: ActionItem[];
  attachments: Attachment[];
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
  supplierName: string;
  quantity: number;
  price?: number;
  deliveryDate?: string;
  status: "sent" | "quoted" | "selected" | "rejected";
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
