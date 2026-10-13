/**
 * 新增机图纸评审流程 — 配置读取
 */

import type { DrawingReviewConfig } from "./types";

const CONFIG_KEY = "drawing-review:config";

export async function getDrawingReviewConfig(env: Env): Promise<DrawingReviewConfig | null> {
  const raw = await env.REGISTRY.get(CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DrawingReviewConfig;
  } catch {
    return null;
  }
}

export async function setDrawingReviewConfig(env: Env, cfg: Omit<DrawingReviewConfig, "updatedAt">): Promise<DrawingReviewConfig> {
  const full: DrawingReviewConfig = { ...cfg, updatedAt: new Date().toISOString() };
  await env.REGISTRY.put(CONFIG_KEY, JSON.stringify(full));
  // 配置变更后清掉相关缓存
  await env.REGISTRY.delete("drawing-review:cache:dashboard");
  return full;
}

export function requireConfig(env: Env): Promise<DrawingReviewConfig> {
  return getDrawingReviewConfig(env).then((cfg) => {
    if (!cfg) throw new Error("新增机图纸评审流程尚未配置：请先调用 config_drawing_review 设置 base 与 tables");
    return cfg;
  });
}

/** 校验 base_token / table_id 基本格式 */
export function validateConfig(cfg: DrawingReviewConfig): void {
  if (!/^[A-Za-z0-9]{10,}$/.test(cfg.base)) {
    throw new Error("base 不合法：应为飞书多维表格 URL 中 /base/ 后的 app_token");
  }
  for (const [name, id] of Object.entries(cfg.tables)) {
    if (id && !/^tbl[A-Za-z0-9]+$/.test(id)) {
      throw new Error(`table_id 不合法（${name}）：应以 tbl 开头`);
    }
  }
}
