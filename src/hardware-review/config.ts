/**
 * 硬件评审流程 — 配置读取
 *
 * 双配置同源说明（审批引擎 Phase 1）：本配置继续管理全部表（含 reviews 主表）；
 * 引擎 flows:config 的 hardware_review.tableId 指向同一张 reviews 表（缺省时由路由层
 * ensureFlowTableLink 自动回填）。两侧指向同一表是刻意的：引擎负责写单/状态机/通知，
 * 模块 adapter 负责子表（纪要/整改/报告…）查询，子表外键 = 引擎申请单号。
 */

import { KV_KEYS } from "../shared/kv-keys";
import { createModuleConfig, validateModuleConfig } from "../shared/module-config";
import type { HardwareReviewConfig } from "./types";

const moduleConfig = createModuleConfig<HardwareReviewConfig>({
  kvKey: KV_KEYS.hardwareReviewConfig,
  requireMessage: "硬件评审流程尚未配置：请先调用 config_hardware_review 设置 base 与 tables",
  // 配置变更后清掉相关缓存
  invalidateKeys: [KV_KEYS.hardwareReviewDashboardCache],
});

export const getHardwareReviewConfig = moduleConfig.get;
export const setHardwareReviewConfig = moduleConfig.set;
export const requireConfig = moduleConfig.require;

/** 校验 base_token / table_id 基本格式 */
export function validateConfig(cfg: HardwareReviewConfig): void {
  validateModuleConfig(cfg);
}
