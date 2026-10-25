/**
 * 评审模块 → 审批引擎薄壳桥（drawing-review / hardware-review 共用）
 *
 * 职责边界：评审单的状态机裁决、底表状态写入、群/邮件通知全部由 src/approvals 引擎承担
 * （submitApprovalCore / runApprovalAction）；本桥只做两件事：
 *   ① 单据级动作薄壳：评审单存在性校验（保留旧文案）→ 引擎动作 → 事件日志；
 *   ② 事件日志写模块 events 子表（沿用旧 review-flow logEvent 语义，失败只记日志不阻断）。
 * flows:config 底表链接回填用 approvals/flows.ts 的 ensureFlowTableLink（模块配置与引擎
 * 配置指向同一张 reviews 表是刻意的，见模块 config.ts 注释）。
 */

import { runApprovalAction } from "../approvals/engine";
import type { ApprovalType } from "../approvals/flows";
import type { UserRole } from "../auth/role";
import type { HubUser } from "./session";

/** 薄壳需要的最小 adapter 能力：评审单查询 + 事件子表写入 */
export interface ReviewShellAdapter {
  findReviewById(reviewId: string): Promise<{ recordId: string; status: string } | null>;
  createRecord(table: string, fields: Record<string, unknown>): Promise<unknown>;
}

export interface ReviewShellSpec {
  /** 引擎流程类型（drawing_review / hardware_review） */
  type: ApprovalType;
  /** 日志前缀（事件日志失败时 console.error 用） */
  logTag: string;
  /** 事件子表逻辑名（adapter.createRecord 的 table 参数） */
  eventsTable: string;
  /** 事件子表中回指评审单的字段名（关联评审单） */
  eventReviewField: string;
}

/** 事件日志：写模块 events 子表，失败只记日志（与旧 review-flow logEvent 同语义） */
export async function logReviewEvent(
  adapter: ReviewShellAdapter,
  spec: ReviewShellSpec,
  reviewId: string,
  actorId: string,
  action: string,
  fromStatus?: string,
  toStatus?: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await adapter.createRecord(spec.eventsTable, {
      [spec.eventReviewField]: reviewId,
      操作人: actorId,
      动作: action,
      原状态: fromStatus,
      新状态: toStatus,
      附加信息: payload ? JSON.stringify(payload) : "",
      操作时间: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[${spec.logTag}] log event failed:`, err);
  }
}

/**
 * 单据级动作薄壳：评审单存在性校验（旧文案「评审单 X 不存在」）→ 引擎 runApprovalAction
 * （状态机/写表/通知）→ 事件日志。返回流转前后状态，调用方按需回读评审单。
 * logAction 缺省 = event（rectify 路由传 "complete_rectification" 保持事件表口径）。
 */
export async function runReviewEngineAction(
  env: Env,
  spec: ReviewShellSpec,
  adapter: ReviewShellAdapter,
  reviewId: string,
  event: string,
  user: HubUser,
  role: UserRole,
  payload?: Record<string, unknown>,
  logAction?: string,
): Promise<{ from: string; status: string }> {
  const review = await adapter.findReviewById(reviewId);
  if (!review) throw new Error(`评审单 ${reviewId} 不存在`);
  const res = await runApprovalAction(env, {
    type: spec.type,
    appId: reviewId,
    action: event,
    user,
    role,
  });
  await logReviewEvent(adapter, spec, reviewId, user.open_id, logAction ?? event, review.status, res.status, payload);
  return { from: review.status, status: res.status };
}
