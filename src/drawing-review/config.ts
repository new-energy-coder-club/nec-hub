/**
 * 新增机图纸评审流程 — 配置读取
 */

import { createModuleConfig } from "../shared/module-config";
import type { DrawingReviewConfig } from "./types";

const moduleConfig = createModuleConfig<DrawingReviewConfig>({
  kvKey: "drawing-review:config",
  requireMessage: "新增机图纸评审流程尚未配置：请先调用 config_drawing_review 设置 base 与 tables",
  // 配置变更后清掉相关缓存
  invalidateKeys: ["drawing-review:cache:dashboard"],
});

export const getDrawingReviewConfig = moduleConfig.get;
export const setDrawingReviewConfig = moduleConfig.set;
