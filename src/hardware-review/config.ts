/**
 * 硬件评审流程 — 配置读取
 */

import { createModuleConfig, validateModuleConfig } from "../shared/module-config";
import type { HardwareReviewConfig } from "./types";

const moduleConfig = createModuleConfig<HardwareReviewConfig>({
  kvKey: "hardware-review:config",
  requireMessage: "硬件评审流程尚未配置：请先调用 config_hardware_review 设置 base 与 tables",
  // 配置变更后清掉相关缓存
  invalidateKeys: ["hardware-review:cache:dashboard"],
});

export const getHardwareReviewConfig = moduleConfig.get;
export const setHardwareReviewConfig = moduleConfig.set;
export const requireConfig = moduleConfig.require;

/** 校验 base_token / table_id 基本格式 */
export function validateConfig(cfg: HardwareReviewConfig): void {
  validateModuleConfig(cfg);
}
