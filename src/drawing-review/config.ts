/**
 * 新增机图纸评审流程 — 配置读取
 *
 * 双配置同源说明（审批引擎 Phase 1）：本配置继续管理全部表（含 reviews 主表）；
 * 引擎 flows:config 的 drawing_review.tableId 指向同一张 reviews 表（缺省时由路由层
 * ensureFlowTableLink 自动回填）。两侧指向同一表是刻意的：引擎负责写单/状态机/通知，
 * 模块 adapter 负责子表（BOM/纪要/整改/询价…）查询，子表外键 = 引擎申请单号。
 */

import { KV_KEYS } from "../shared/kv-keys";
import { createModuleConfig } from "../shared/module-config";
import type { DrawingReviewConfig } from "./types";

const moduleConfig = createModuleConfig<DrawingReviewConfig>({
  kvKey: KV_KEYS.drawingReviewConfig,
  requireMessage: "新增机图纸评审流程尚未配置：请先调用 config_drawing_review 设置 base 与 tables",
  // 配置变更后清掉相关缓存
  invalidateKeys: [KV_KEYS.drawingReviewDashboardCache],
});

export const getDrawingReviewConfig = moduleConfig.get;
export const setDrawingReviewConfig = moduleConfig.set;
