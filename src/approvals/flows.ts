/**
 * 审批流程配置（PRD V1.1 Plan B：状态机落多维表格"状态"字段 + 群机器人通知）
 *
 * 四条业务线（reimburse/drawing/hardware/compliance）全部配置驱动：
 * 新增流程 = flows:config 加配置 + 建底表，零代码。flows:config 由 MCP config_flows 管理。
 */

import { getDashboardConfig } from "../dashboard";
import { fieldNum, fieldText, findFieldKey, type BitableRecord } from "../feishu/bitable";
import type { UserRole } from "../auth/role";

/** 审批流程类型（四条业务线） */
export const APPROVAL_TYPES = ["reimburse", "drawing", "hardware", "compliance"] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

/** 审批流程配置（KV key: flows:config，由 MCP config_flows 管理） */
export interface FlowConfig {
  engine: "table" | "feishu";   // 本期全部 table；feishu 为预留（引擎切换只换该字段）
  tableId: string;              // 底表 table_id（tbl 开头），空 = 未配置
  base: string;                 // 多维表格 app_token；空则 fallback dashboard:config.base
  prefix: string;               // 单号前缀 BX/MECH/HW/CP
  group: string | null;         // 限定提交组别（null=全队）
  approvers: {
    roles: string;              // 正则串，如 "队长|财务"
    groupLeaders?: string[];    // 这些组的组长可审，如 ["机械组"]
  };
  /** ≥coSign 金额时额外通知（Plan B 用通知实现会签，两级审批为 Plan A 能力） */
  thresholds?: { notifyRoles?: string; amountField?: string; coSign?: number };
  /** G-05 邮件通道：该流程审批结果的邮件收件人；未配置时 fallback env MAIL_TO，全空则不发邮件 */
  mailTo?: string[];
  /** G-03 时效治理：升级提醒/自动取消时长，0 = 关闭；不配则走 DEFAULT_FLOWS 默认值 */
  sla?: { escalateHours?: number; autoCancelDays?: number; escalateTo?: string };
  required: string[];           // 必填字段名（与底表字段名一致）
  conditional?: Array<{ when: { field: string; equals: string }; require: string[] }>;
}

export type FlowsConfig = Record<ApprovalType, FlowConfig>;

/** G-03 默认时效：48h 升级提醒（知会队长）+ 14 天自动取消 */
const DEFAULT_SLA: NonNullable<FlowConfig["sla"]> = { escalateHours: 48, autoCancelDays: 14, escalateTo: "队长" };

/** 默认流程配置（tableId/base 留空待 config_flows 配置；字段与 PRD §6.1 对齐） */
export const DEFAULT_FLOWS: FlowsConfig = {
  reimburse: {
    engine: "table",
    tableId: "",
    base: "",
    prefix: "BX",
    group: null,
    approvers: { roles: "队长|财务" },
    sla: { ...DEFAULT_SLA },
    required: ["事项", "报销金额", "发票号"],
    conditional: [{ when: { field: "发票照片", equals: "" }, require: ["无票说明"] }],
  },
  drawing: {
    engine: "table",
    tableId: "",
    base: "",
    prefix: "MECH",
    group: "机械组",
    approvers: { roles: "队长", groupLeaders: ["机械组"] },
    thresholds: { notifyRoles: "队长", amountField: "预估加工费", coSign: 500 },
    sla: { ...DEFAULT_SLA },
    required: ["图纸名称", "图号", "版本", "所属机构", "材料与工艺", "加工方式", "图纸文件"],
    conditional: [{ when: { field: "加工方式", equals: "外协加工" }, require: ["预估加工费"] }],
  },
  hardware: {
    engine: "table",
    tableId: "",
    base: "",
    prefix: "HW",
    group: null,
    approvers: { roles: "队长|指导老师" },
    thresholds: { notifyRoles: "队长|指导老师", amountField: "预估总价", coSign: 200 },
    sla: { ...DEFAULT_SLA },
    required: ["申请类型", "物料名称", "规格型号", "数量", "预估总价", "用途说明"],
    conditional: [{ when: { field: "申请类型", equals: "新购" }, require: ["购买链接"] }],
  },
  compliance: {
    engine: "table",
    tableId: "",
    base: "",
    prefix: "CP",
    group: null,
    approvers: { roles: "队长|指导老师", groupLeaders: ["运营组", "宣传组"] },
    sla: { ...DEFAULT_SLA },
    required: ["合规类型", "标题", "内容说明", "计划发布时间"],
    conditional: [{ when: { field: "赞助商相关", equals: "是" }, require: ["赞助商要求"] }],
  },
};

/** 读 flows:config；无配置/损坏返回默认值 deep copy；与默认值深合并保证向前兼容 */
export async function getFlowsConfig(env: Env): Promise<FlowsConfig> {
  const raw = await env.REGISTRY.get("flows:config");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<FlowsConfig>;
      const out = {} as FlowsConfig;
      for (const t of APPROVAL_TYPES) {
        const patch: Partial<FlowConfig> = parsed[t] ?? {};
        // sla 单独深合并：旧配置无 sla 段时落默认值，部分字段补丁不丢其余默认
        out[t] = { ...DEFAULT_FLOWS[t], ...patch, sla: { ...DEFAULT_FLOWS[t].sla, ...(patch.sla ?? {}) } } as FlowConfig;
      }
      return out;
    } catch {
      /* 配置损坏则回退默认值 */
    }
  }
  return JSON.parse(JSON.stringify(DEFAULT_FLOWS)) as FlowsConfig;
}

/** 流程底表所在 base：flows 未配则 fallback 看板配置（通常同一个多维表格） */
export async function getFlowBase(env: Env, flow: FlowConfig): Promise<string> {
  if (flow.base) return flow.base;
  const cfg = await getDashboardConfig(env);
  return cfg?.base ?? "";
}

/** 审批权限判定：角色正则命中，或（组长 ∧ 组在 groupLeaders 名单）；队长硬编码放行（兜底，PRD §3 代理人） */
export function isApprover(role: UserRole, approvers: FlowConfig["approvers"]): boolean {
  if (/队长/.test(role.role)) return true;
  if (new RegExp(approvers.roles).test(role.role)) return true;
  return role.role === "组长" && !!role.group && (approvers.groupLeaders ?? []).includes(role.group);
}

/** 声明式字段校验：required + conditional + 数字字段须 >0；返回缺失字段名列表（空=通过） */
export function evalFlowFields(flow: FlowConfig, fields: Record<string, unknown>): string[] {
  const missing: string[] = [];
  for (const name of flow.required) {
    if (!fieldText(fields[name]).trim()) missing.push(name);
  }
  for (const cond of flow.conditional ?? []) {
    if (fieldText(fields[cond.when.field]).trim() === cond.when.equals) {
      for (const name of cond.require) {
        if (!fieldText(fields[name]).trim()) missing.push(name);
      }
    }
  }
  for (const name of ["报销金额", "金额", "数量", "预估总价", "预估加工费"]) {
    const v = fieldNum(fields[name]);
    if (v !== null && v <= 0) missing.push(`${name}（须大于 0）`);
  }
  return [...new Set(missing)];
}

/** 在表记录里按"申请单号"字段定位一行（字段名不固定时模糊匹配） */
export function findRecordByAppId(records: BitableRecord[], appId: string): BitableRecord | null {
  const key = findFieldKey(records, [/^申请单号$/, /申请单号/, /单号/]);
  if (!key) return null;
  return records.find((r) => fieldText(r.fields[key]) === appId) ?? null;
}

/** 申请单号：<prefix>-<年>-<序号4位>（序号 = 现有记录数 + 1） */
export function nextAppId(prefix: string, existingCount: number): string {
  return `${prefix}-${new Date().getFullYear()}-${String(existingCount + 1).padStart(4, "0")}`;
}

/** 审批域错误：带 HTTP 状态码，REST 层直接映射 */
export class ApprovalError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ApprovalError";
    this.status = status;
  }
}
