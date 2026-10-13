/**
 * 合同审批流程 — 配置读取
 */

import { createModuleConfig, validateModuleConfig } from "../shared/module-config";
import type { ContractApprovalConfig } from "./types";

const moduleConfig = createModuleConfig<ContractApprovalConfig>({
  kvKey: "contract-approval:config",
  requireMessage: "合同审批流程尚未配置：请先调用 config_contract_approval 设置 base 与 tables",
  // 合同审批在写入前做 schema 校验（其余两模块在 MCP 工具层校验）
  validate: validateConfig,
});

export const getContractApprovalConfig = moduleConfig.get;
export const setContractApprovalConfig = moduleConfig.set;
export const requireConfig = moduleConfig.require;

/** 校验 base_token / table_id 基本格式 */
export function validateConfig(cfg: ContractApprovalConfig): void {
  validateModuleConfig(cfg);
}
