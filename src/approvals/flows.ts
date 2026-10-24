/**
 * 审批流程配置（PRD V1.1 Plan B：状态机落多维表格"状态"字段 + 群机器人通知）
 *
 * 业务线全部配置驱动：新增流程 = flows:config 加配置 + 建底表，零代码。flows:config 由 MCP config_flows 管理。
 * 四条存量流程（reimburse/drawing/hardware/compliance）走引擎全局中文状态机；
 * 三条评审流程（drawing_review/hardware_review/contract）走 flow.machine 自定义英文状态机（Phase 0 引擎泛化）。
 */

import { getDashboardConfig } from "../dashboard";
import { fieldNum, fieldText, findFieldKey, type BitableRecord } from "../feishu/bitable";
import { ROLES, type UserRole } from "../auth/role";
import { KV_KEYS } from "../shared/kv-keys";

/** 审批流程类型（存量四条业务线 + 评审迁移三条：drawing_review/hardware_review/contract） */
export const APPROVAL_TYPES = ["reimburse", "drawing", "hardware", "compliance", "drawing_review", "hardware_review", "contract"] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

/** 流程级自定义状态机的流转规则（from/to 为精确状态字符串；guard 缺省 = 仅登录） */
export interface FlowMachineTransition {
  action: string;
  from: string;
  to: string;
  guard?: "approver" | "finance" | "owner" | "participant" | "any";
}

/** 流程级自定义状态机：缺省时走引擎全局状态机（APPROVAL_TRANSITIONS，中文状态） */
export interface FlowMachine {
  /** 提交后的初始状态（缺省 "审批中"） */
  initial: string;
  /** 流转规则；同一动作允许多条（from 不同，如 complete：rectifying→bom_generating / procuring→archived） */
  transitions: FlowMachineTransition[];
}

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
  /** 流程级自定义状态机（评审模块英文状态）；缺省走引擎全局状态机 */
  machine?: FlowMachine;
  /** 状态字段名（默认 "状态"）；评审底表同名字段时可省略 */
  statusField?: string;
  /** 待审批状态集（待办聚合/SLA 判定用；缺省 ["审批中"]） */
  pendingStates?: string[];
  /** 会签：审批人名单 JSON 存底表该字段（[{approverId,name,status,comment?,actedAt?}]），approve 需全员通过 */
  countersign?: { approversField: string };
  /** 单号序号补零位数（默认 4：BX-2026-0001；合同 HT 用 3：HT-2026-001） */
  serialDigits?: number;
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
    // 已废弃：由 drawing_review（图纸评审模块迁入引擎，DR 前缀 + 英文状态机）取代。
    // 保留仅为兼容存量 flows:config 与底表数据；tableId 清空即停用（代码不删）。
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
    // 已废弃：由 hardware_review（硬件评审模块迁入引擎，HR 前缀 + 英文状态机）取代。
    // 保留仅为兼容存量 flows:config 与底表数据；tableId 清空即停用（代码不删）。
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
  // 评审迁移三流程：英文状态机（照搬各模块 flow.service TRANSITIONS），guard "any"（模块自身在路由层控权）。
  // sla 默认全关：自动取消写的「已取消」不是英文状态机的合法状态，需要时按流程显式开启。
  drawing_review: {
    engine: "table",
    tableId: "",
    base: "",
    prefix: "DR",
    group: null,
    approvers: { roles: "队长", groupLeaders: ["机械组"] },
    sla: { escalateHours: 0, autoCancelDays: 0 },
    statusField: "状态",
    pendingStates: ["pending_review", "in_review"],
    machine: {
      initial: "pending_review",
      transitions: [
        { action: "submit", from: "draft", to: "pending_review", guard: "any" },
        { action: "start_meeting", from: "pending_review", to: "in_review", guard: "any" },
        { action: "conclude_passed", from: "in_review", to: "bom_generating", guard: "any" },
        { action: "conclude_conditional", from: "in_review", to: "rectifying", guard: "any" },
        { action: "conclude_rejected", from: "in_review", to: "draft", guard: "any" },
        { action: "complete", from: "rectifying", to: "bom_generating", guard: "any" },
        { action: "re_review", from: "rectifying", to: "pending_review", guard: "any" },
        { action: "generated", from: "bom_generating", to: "assessing", guard: "any" },
        { action: "pass", from: "assessing", to: "scheduling", guard: "any" },
        { action: "fail", from: "assessing", to: "draft", guard: "any" },
        { action: "confirm", from: "scheduling", to: "procuring", guard: "any" },
        { action: "complete", from: "procuring", to: "archived", guard: "any" },
      ],
    },
    required: ["项目编号", "机型名称", "图纸文件"],
  },
  hardware_review: {
    engine: "table",
    tableId: "",
    base: "",
    prefix: "HR",
    group: null,
    approvers: { roles: "队长|指导老师" },
    sla: { escalateHours: 0, autoCancelDays: 0 },
    statusField: "状态",
    pendingStates: ["pending_review", "in_review"],
    machine: {
      initial: "pending_review",
      transitions: [
        { action: "submit", from: "draft", to: "pending_review", guard: "any" },
        { action: "start_meeting", from: "pending_review", to: "in_review", guard: "any" },
        { action: "conclude_passed", from: "in_review", to: "report_generating", guard: "any" },
        { action: "conclude_conditional", from: "in_review", to: "rectifying", guard: "any" },
        { action: "conclude_rejected", from: "in_review", to: "draft", guard: "any" },
        { action: "complete", from: "rectifying", to: "report_generating", guard: "any" },
        { action: "re_review", from: "rectifying", to: "pending_review", guard: "any" },
        { action: "generated", from: "report_generating", to: "assessing", guard: "any" },
        { action: "pass", from: "assessing", to: "approved", guard: "any" },
        { action: "fail", from: "assessing", to: "draft", guard: "any" },
        { action: "archive", from: "approved", to: "archived", guard: "any" },
      ],
    },
    required: ["项目编号", "硬件名称", "硬件资料"],
  },
  contract: {
    engine: "table",
    tableId: "",
    base: "",
    prefix: "HT",
    group: null,
    approvers: { roles: "队长|财务" },
    sla: { escalateHours: 0, autoCancelDays: 0 },
    statusField: "状态",
    pendingStates: ["pending_approval", "in_review"],
    serialDigits: 3,
    countersign: { approversField: "审批人" },
    machine: {
      initial: "pending_approval",
      transitions: [
        { action: "submit", from: "draft", to: "pending_approval", guard: "owner" },
        { action: "start_review", from: "pending_approval", to: "in_review", guard: "participant" },
        { action: "approve", from: "in_review", to: "approved", guard: "participant" },
        { action: "reject", from: "in_review", to: "rejected", guard: "participant" },
        { action: "revise", from: "in_review", to: "revised", guard: "participant" },
        { action: "resubmit", from: "revised", to: "pending_approval", guard: "owner" },
        { action: "archive", from: "approved", to: "archived", guard: "participant" },
        { action: "archive", from: "rejected", to: "archived", guard: "participant" },
      ],
    },
    required: ["合同名称", "合同金额", "合同文件", "审批人"],
  },
};

/** 读 flows:config；无配置/损坏返回默认值 deep copy；与默认值深合并保证向前兼容 */
export async function getFlowsConfig(env: Env): Promise<FlowsConfig> {
  const raw = await env.REGISTRY.get(KV_KEYS.flowsConfig);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<FlowsConfig>;
      const out = {} as FlowsConfig;
      for (const t of APPROVAL_TYPES) {
        const patch: Partial<FlowConfig> = parsed[t] ?? {};
        const def = DEFAULT_FLOWS[t];
        out[t] = {
          ...def,
          ...patch,
          // sla 单独深合并：旧配置无 sla 段时落默认值，部分字段补丁不丢其余默认
          sla: { ...def.sla, ...(patch.sla ?? {}) },
          // machine/countersign 对象级合并（patch 可只覆盖 initial 或 transitions）
          machine: patch.machine ? { ...def.machine, ...patch.machine } : def.machine,
          countersign: patch.countersign ? { ...def.countersign, ...patch.countersign } : def.countersign,
          // pendingStates 数组整体替换，不做元素级合并
          pendingStates: patch.pendingStates ?? def.pendingStates,
        } as FlowConfig;
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

/**
 * 引擎流程底表链接回填（评审迁移双配置同源）：flows:config 该流程 tableId 为空时，
 * 用模块自身配置（config_drawing_review 等）的 reviews 表与 base 补齐。两侧配置指向
 * 同一张表是刻意的：引擎写单/流转，模块 adapter 供子表（BOM/纪要/整改…）查询。
 * 已配置时不覆盖（flows:config 为准），回填后清该流程待办缓存。
 */
export async function ensureFlowTableLink(env: Env, type: ApprovalType, tableId: string | undefined, base: string): Promise<void> {
  if (!tableId) return;
  const cfg = await getFlowsConfig(env);
  if (cfg[type].tableId) return;
  cfg[type] = { ...cfg[type], tableId, base: cfg[type].base || base };
  await env.REGISTRY.put(KV_KEYS.flowsConfig, JSON.stringify(cfg));
  await env.REGISTRY.delete(KV_KEYS.todoTable(type)).catch(() => {});
}

/** 审批权限判定：角色正则命中，或（组长 ∧ 组在 groupLeaders 名单）；队长硬编码放行（兜底，PRD §3 代理人） */
export function isApprover(role: UserRole, approvers: FlowConfig["approvers"]): boolean {
  if (ROLES.CAPTAIN.test(role.role)) return true;
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
  for (const name of ["报销金额", "金额", "数量", "预估总价", "预估加工费", "合同金额"]) {
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

/** 流程状态字段名（默认 "状态"） */
export function statusFieldOf(flow: FlowConfig): string {
  return (flow.statusField ?? "").trim() || "状态";
}

/** 流程待审批状态集（待办聚合/SLA/待我审批共用判定） */
export function pendingStatesOf(flow: FlowConfig): string[] {
  return flow.pendingStates?.length ? flow.pendingStates : ["审批中"];
}

/** 状态字段的模糊匹配模式：配置的 statusField 精确匹配优先，其后回退通用模式 */
export function statusFieldPatterns(flow: FlowConfig): RegExp[] {
  const sf = statusFieldOf(flow);
  const head = sf !== "状态" ? [new RegExp(`^${sf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)] : [];
  return [...head, /^状态$/, /状态/, /进度/];
}

/** 审批域错误：带 HTTP 状态码，REST 层直接映射；info 携带结构化细节（如 409 的当前/目标状态） */
export class ApprovalError extends Error {
  status: number;
  info?: Record<string, unknown>;
  constructor(message: string, status = 400, info?: Record<string, unknown>) {
    super(message);
    this.name = "ApprovalError";
    this.status = status;
    this.info = info;
  }
}
