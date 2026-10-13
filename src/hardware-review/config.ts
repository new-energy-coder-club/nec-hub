/**
 * 硬件评审流程 — 配置读取
 */

import type { HardwareReviewConfig } from "./types";

const CONFIG_KEY = "hardware-review:config";

export async function getHardwareReviewConfig(env: Env): Promise<HardwareReviewConfig | null> {
  const raw = await env.REGISTRY.get(CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HardwareReviewConfig;
  } catch {
    return null;
  }
}

export async function setHardwareReviewConfig(env: Env, cfg: Omit<HardwareReviewConfig, "updatedAt">): Promise<HardwareReviewConfig> {
  const full: HardwareReviewConfig = { ...cfg, updatedAt: new Date().toISOString() };
  await env.REGISTRY.put(CONFIG_KEY, JSON.stringify(full));
  await env.REGISTRY.delete("hardware-review:cache:dashboard");
  return full;
}

export function requireConfig(env: Env): Promise<HardwareReviewConfig> {
  return getHardwareReviewConfig(env).then((cfg) => {
    if (!cfg) throw new Error("硬件评审流程尚未配置：请先调用 config_hardware_review 设置 base 与 tables");
    return cfg;
  });
}

/** 校验 base_token / table_id 基本格式 */
export function validateConfig(cfg: HardwareReviewConfig): void {
  if (!/^[A-Za-z0-9]{10,}$/.test(cfg.base)) {
    throw new Error("base 不合法：应为飞书多维表格 URL 中 /base/ 后的 app_token");
  }
  for (const [name, id] of Object.entries(cfg.tables)) {
    if (id && !/^tbl[A-Za-z0-9]+$/.test(id)) {
      throw new Error(`table_id 不合法（${name}）：应以 tbl 开头`);
    }
  }
}
