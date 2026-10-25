/**
 * 合同审批流程 — 配置读取
 *
 * 双配置同源说明（审批引擎 Phase 2）：本配置继续管理全部表（含 approvals 主表）；
 * 引擎 flows:config 的 contract.tableId 指向同一张 approvals 表（缺省时由路由层
 * ensureFlowTableLink 自动回填）。两侧指向同一表是刻意的：引擎负责写单/状态机/会签/通知，
 * 模块 adapter 负责评论/事件子表与审批单读取，子表外键 = 引擎申请单号。
 */

import { KV_KEYS } from "../shared/kv-keys";
import { createModuleConfig, validateModuleConfig } from "../shared/module-config";
import type { ContractApprovalConfig } from "./types";

const moduleConfig = createModuleConfig<ContractApprovalConfig>({
  kvKey: KV_KEYS.contractApprovalConfig,
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
