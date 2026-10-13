/**
 * 合同审批流程 — 配置读取
 */

import type { ContractApprovalConfig } from "./types";

const CONFIG_KEY = "contract-approval:config";

export async function getContractApprovalConfig(env: Env): Promise<ContractApprovalConfig | null> {
  const raw = await env.REGISTRY.get(CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ContractApprovalConfig;
  } catch {
    return null;
  }
}

export async function setContractApprovalConfig(
  env: Env,
  cfg: Omit<ContractApprovalConfig, "updatedAt">,
): Promise<ContractApprovalConfig> {
  const full: ContractApprovalConfig = { ...cfg, updatedAt: new Date().toISOString() };
  validateConfig(full);
  await env.REGISTRY.put(CONFIG_KEY, JSON.stringify(full));
  return full;
}

export function requireConfig(env: Env): Promise<ContractApprovalConfig> {
  return getContractApprovalConfig(env).then((cfg) => {
    if (!cfg) throw new Error("合同审批流程尚未配置：请先调用 config_contract_approval 设置 base 与 tables");
    return cfg;
  });
}

/** 校验 base_token / table_id 基本格式 */
export function validateConfig(cfg: ContractApprovalConfig): void {
  if (!/^[A-Za-z0-9]{10,}$/.test(cfg.base)) {
    throw new Error("base 不合法：应为飞书多维表格 URL 中 /base/ 后的 app_token");
  }
  for (const [name, id] of Object.entries(cfg.tables)) {
    if (id && !/^tbl[A-Za-z0-9]+$/.test(id)) {
      throw new Error(`table_id 不合法（${name}）：应以 tbl 开头`);
    }
  }
}
