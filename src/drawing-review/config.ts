/**
 * 新增机图纸评审流程 — 配置读取
 */

import { createModuleConfig, validateModuleConfig } from "../shared/module-config";
import type { DrawingReviewConfig } from "./types";

const moduleConfig = createModuleConfig<DrawingReviewConfig>({
  kvKey: "drawing-review:config",
  requireMessage: "新增机图纸评审流程尚未配置：请先调用 config_drawing_review 设置 base 与 tables",
  // 配置变更后清掉相关缓存
  invalidateKeys: ["drawing-review:cache:dashboard"],
});

export const getDrawingReviewConfig = moduleConfig.get;
export const setDrawingReviewConfig = moduleConfig.set;
export const requireConfig = moduleConfig.require;

/**
 * Get drawing review configuration with automatic default filling enabled
 */
export async function getDrawingReviewConfigWithDefaults(env: Env): Promise<DrawingReviewConfig | null> {
  const cfg = await getDrawingReviewConfig(env);
  if (!cfg) return null;

  // Add default filling configuration
  return {
    ...cfg,
    features: {
      ...cfg.features,
      autoDefaultFilling: true,
      versionIncrement: "minor", // minor or major
      designNotesTemplate: "template_v1",
    },
  };
}

/** 校验 base_token / table_id 基本格式 */
export function validateConfig(cfg: DrawingReviewConfig): void {
  validateModuleConfig(cfg);
}
