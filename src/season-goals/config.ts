/**
 * 赛季目标管理 — 配置读取
 */

import { KV_KEYS } from "../shared/kv-keys";
import { createModuleConfig, validateModuleConfig } from "../shared/module-config";
import type { SeasonGoalsConfig } from "./types";

const moduleConfig = createModuleConfig<SeasonGoalsConfig>({
  kvKey: KV_KEYS.seasonGoalsConfig,
  requireMessage: "赛季目标管理尚未配置：请先调用 POST /api/season-goals/config 设置 base 与 tables",
  validate: (cfg) => {
    validateModuleConfig(cfg);
    if (!cfg.tables.goals || !cfg.tables.collect) {
      throw new Error("tables 必须包含 goals（目标表）与 collect（收集单表）");
    }
  },
});

export const getSeasonGoalsConfig = moduleConfig.get;
export const setSeasonGoalsConfig = moduleConfig.set;
export const requireConfig = moduleConfig.require;
