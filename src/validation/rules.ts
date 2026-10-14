/**
 * FE-05 数据校验 Agent — 声明式规则引擎（纯函数，可单测）
 * 规则 JSON 存 KV（validate:rules），新增规则无需改代码；DEFAULT_RULES 为兜底。
 */

import { BitableRecord, fieldNum, fieldText, fieldTs, findFieldKey } from "../feishu/bitable";

export const VALIDATE_TABLES = ["members", "tasks", "inventory", "finance"] as const;
export type ValidateTable = (typeof VALIDATE_TABLES)[number];

export type RuleCheck =
  | "empty" // 字段缺失或为空
  | "format" // 字段必填且须匹配 pattern 正则
  | "enum" // 字段非空时须在 values 枚举内
  | "negative" // 数值字段 < 0
  | "date-before" // 主字段日期早于 field2 日期（如截止早于创建）
  | "progress-done-mismatch" // 数值字段 >= threshold 但 field2 不匹配 pattern（如 100% 未标完成）
  | "conflict" // 主字段匹配 pattern 且 field2 匹配 pattern2 → 矛盾
  | "not-in-members"; // 字段人名不在队员名单姓名集合内

export interface ValidateRule {
  id: string;
  table: ValidateTable;
  /** 异常类型（异常清单按它分组） */
  type: string;
  description: string;
  /** 主字段名正则列表（在表字段名里按序匹配，同 findFieldKey） */
  fieldPatterns: string[];
  check: RuleCheck;
  pattern?: string;
  values?: string[];
  field2Patterns?: string[];
  pattern2?: string;
  threshold?: number;
  suggestion: string;
  enabled?: boolean;
}

export interface Violation {
  ruleId: string;
  table: ValidateTable;
  type: string;
  description: string;
  recordId: string;
  field: string;
  value: string;
  suggestion: string;
}

export interface ValidationContext {
  /** 队员名单表的姓名集合（not-in-members 用） */
  memberNames: Set<string>;
}

const COMPILED_CACHE = new Map<string, RegExp>();

function re(p: string): RegExp {
  let r = COMPILED_CACHE.get(p);
  if (!r) {
    r = new RegExp(p, "i");
    COMPILED_CACHE.set(p, r);
  }
  return r;
}

function findKey(records: BitableRecord[], patterns: string[]): string | null {
  return findFieldKey(records, patterns.map((p) => re(p)));
}

/** 人名类字段可能一人/多人（顿号、逗号分隔），逐一比对 */
export function splitNames(text: string): string[] {
  return text
    .split(/[、,，;；\/\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function violates(rule: ValidateRule, r: BitableRecord, key: string, key2: string | null, ctx: ValidationContext): boolean {
  const text = fieldText(r.fields[key]).trim();
  switch (rule.check) {
    case "empty":
      return !text;
    case "format": {
      if (!rule.pattern) return false;
      return !text || !re(rule.pattern).test(text);
    }
    case "enum": {
      if (!text || !rule.values?.length) return false;
      return !rule.values.includes(text);
    }
    case "negative": {
      const n = fieldNum(r.fields[key]);
      return n !== null && n < 0;
    }
    case "date-before": {
      if (!key2) return false;
      const a = fieldTs(r.fields[key]);
      const b = fieldTs(r.fields[key2]);
      return a !== null && b !== null && a < b;
    }
    case "progress-done-mismatch": {
      if (!key2 || !rule.pattern) return false;
      const n = fieldNum(r.fields[key]);
      if (n === null || n < (rule.threshold ?? 100)) return false;
      return !re(rule.pattern).test(fieldText(r.fields[key2]));
    }
    case "conflict": {
      if (!key2 || !rule.pattern || !rule.pattern2) return false;
      return re(rule.pattern).test(text) && re(rule.pattern2).test(fieldText(r.fields[key2]));
    }
    case "not-in-members": {
      if (!text || ctx.memberNames.size === 0) return false;
      const names = splitNames(text);
      return names.some((n) => !ctx.memberNames.has(n));
    }
  }
}

/** 对一张表跑一批规则；字段名在表内不存在时跳过该规则（避免大面积误报） */
export function runRules(
  table: ValidateTable,
  records: BitableRecord[],
  rules: ValidateRule[],
  ctx: ValidationContext,
): Violation[] {
  const out: Violation[] = [];
  for (const rule of rules) {
    if (rule.enabled === false || rule.table !== table) continue;
    const key = findKey(records, rule.fieldPatterns);
    if (!key) continue;
    const key2 = rule.field2Patterns?.length ? findKey(records, rule.field2Patterns) : null;
    for (const r of records) {
      if (!violates(rule, r, key, key2, ctx)) continue;
      out.push({
        ruleId: rule.id,
        table,
        type: rule.type,
        description: rule.description,
        recordId: r.record_id,
        field: key,
        value: fieldText(r.fields[key]).trim(),
        suggestion: rule.suggestion,
      });
    }
  }
  return out;
}

export interface ViolationGroup {
  type: string;
  count: number;
  items: Violation[];
}

/** 按异常类型分组（数量降序），供门户「数据健康」与 MCP 输出共用 */
export function groupViolations<T extends Violation>(violations: T[]): Array<Omit<ViolationGroup, "items"> & { items: T[] }> {
  const map = new Map<string, T[]>();
  for (const v of violations) {
    const list = map.get(v.type) ?? [];
    list.push(v);
    map.set(v.type, list);
  }
  return [...map.entries()]
    .map(([type, items]) => ({ type, count: items.length, items }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/** 异常去重键：同一条记录同一规则同一字段视为同一异常（周报 diff 用） */
export function violationKey(v: Violation): string {
  return `${v.ruleId}:${v.table}:${v.recordId}:${v.field}`;
}

export interface ViolationDiff {
  added: number;
  cleared: number;
  ongoing: number;
}

/** 与上周快照比对：新增 / 已清零 / 持续；prevKeys 为 null（首次）时全部计为新增 */
export function diffViolationKeys(prevKeys: string[] | null, currKeys: string[]): ViolationDiff {
  const curr = new Set(currKeys);
  if (!prevKeys) return { added: curr.size, cleared: 0, ongoing: 0 };
  const prev = new Set(prevKeys);
  let added = 0, ongoing = 0;
  for (const k of curr) (prev.has(k) ? ongoing++ : added++);
  let cleared = 0;
  for (const k of prev) if (!curr.has(k)) cleared++;
  return { added, cleared, ongoing };
}

/** 规则 JSON 形状校验（config_validate_rules 写入前调用）；返回清洗后的规则数组 */
export function parseValidateRules(raw: unknown): ValidateRule[] {
  if (!Array.isArray(raw)) throw new Error("规则必须是数组");
  const checks: RuleCheck[] = [
    "empty",
    "format",
    "enum",
    "negative",
    "date-before",
    "progress-done-mismatch",
    "conflict",
    "not-in-members",
  ];
  return raw.map((item, i) => {
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`第 ${i + 1} 条规则 id 不合法（小写字母/数字/连字符）`);
    const table = String(o.table ?? "");
    if (!VALIDATE_TABLES.includes(table as ValidateTable)) {
      throw new Error(`规则 ${id}：table 必须是 ${VALIDATE_TABLES.join(" / ")} 之一`);
    }
    const check = String(o.check ?? "") as RuleCheck;
    if (!checks.includes(check)) throw new Error(`规则 ${id}：check 必须是 ${checks.join(" / ")} 之一`);
    const fieldPatterns = o.fieldPatterns;
    if (!Array.isArray(fieldPatterns) || fieldPatterns.length === 0 || fieldPatterns.some((p) => typeof p !== "string" || !p)) {
      throw new Error(`规则 ${id}：fieldPatterns 必须是非空字符串数组`);
    }
    for (const p of [...(fieldPatterns as string[]), ...((o.field2Patterns as string[]) ?? [])]) {
      try {
        new RegExp(p, "i");
      } catch {
        throw new Error(`规则 ${id}：字段正则不合法：${p}`);
      }
    }
    if ((check === "format" || check === "progress-done-mismatch") && !o.pattern) {
      throw new Error(`规则 ${id}：check=${check} 需要 pattern`);
    }
    if (check === "conflict" && (!o.pattern || !o.pattern2)) {
      throw new Error(`规则 ${id}：check=conflict 需要 pattern 与 pattern2`);
    }
    if (check === "enum" && (!Array.isArray(o.values) || o.values.length === 0)) {
      throw new Error(`规则 ${id}：check=enum 需要非空 values`);
    }
    return {
      id,
      table: table as ValidateTable,
      type: String(o.type ?? "").trim() || "未分类",
      description: String(o.description ?? "").trim(),
      fieldPatterns: fieldPatterns as string[],
      check,
      ...(o.pattern ? { pattern: String(o.pattern) } : {}),
      ...(Array.isArray(o.values) ? { values: (o.values as unknown[]).map(String) } : {}),
      ...(Array.isArray(o.field2Patterns) ? { field2Patterns: (o.field2Patterns as unknown[]).map(String) } : {}),
      ...(o.pattern2 ? { pattern2: String(o.pattern2) } : {}),
      ...(typeof o.threshold === "number" ? { threshold: o.threshold } : {}),
      suggestion: String(o.suggestion ?? "").trim() || "请打开记录核对并修正",
      ...(o.enabled === false ? { enabled: false } : {}),
    };
  });
}

/** 内置默认规则集：覆盖 PRD FE-05 要求的 4 张底表 12 条规则 */
export const DEFAULT_RULES: ValidateRule[] = [
  {
    id: "members-feishu-id-format",
    table: "members",
    type: "飞书 ID 异常",
    description: "飞书 ID 为空或格式错误（应为 ou_ 开头的 open_id）",
    fieldPatterns: ["open_?id", "飞书"],
    check: "format",
    pattern: "^ou_[A-Za-z0-9_-]{8,}$",
    suggestion: "打开记录，让队员用飞书登录一次中台自动回填，或手动填入 ou_ 开头的 open_id",
  },
  {
    id: "members-group-enum",
    table: "members",
    type: "组别非法",
    description: "组别不在枚举值内",
    fieldPatterns: ["^组别", "组别", "小组", "部门", "group"],
    check: "enum",
    values: ["机械组", "电控组", "视觉组", "运营组", "宣传组", "管理组"],
    suggestion: "把组别改为枚举值之一，或通过 config_validate_rules 扩充枚举",
  },
  {
    id: "members-role-empty",
    table: "members",
    type: "角色缺失",
    description: "权限角色字段缺失，登录后按默认队员处理",
    fieldPatterns: ["权限角色", "角色", "role"],
    check: "empty",
    suggestion: "补上权限角色（队长 / 组长 / 队员 / 财务 / 指导）",
  },
  {
    id: "tasks-owner-empty",
    table: "tasks",
    type: "负责人缺失",
    description: "任务没有负责人",
    fieldPatterns: ["负责人", "执行人", "owner", "assignee"],
    check: "empty",
    suggestion: "指定一名负责人",
  },
  {
    id: "tasks-deadline-before-created",
    table: "tasks",
    type: "日期倒挂",
    description: "截止日期早于创建日期",
    fieldPatterns: ["截止", "deadline", "完成时间"],
    field2Patterns: ["创建日期", "创建时间", "创建"],
    check: "date-before",
    suggestion: "核对截止日期，改到创建日期之后",
  },
  {
    id: "tasks-progress-done-mismatch",
    table: "tasks",
    type: "状态进度矛盾",
    description: "完成度已达 100% 但状态未标记完成",
    fieldPatterns: ["完成度", "进度", "progress"],
    field2Patterns: ["^状态", "状态", "status"],
    check: "progress-done-mismatch",
    pattern: "完成|已完|完结|done|关闭|close",
    threshold: 100,
    suggestion: "把状态改为已完成，或把完成度降回真实值",
  },
  {
    id: "inventory-qty-negative",
    table: "inventory",
    type: "数量为负",
    description: "物资数量为负数",
    fieldPatterns: ["^数量", "数量", "库存", "余量", "现存", "quantity", "^count$"],
    check: "negative",
    suggestion: "核对实物盘点数量并修正",
  },
  {
    id: "inventory-borrower-unknown",
    table: "inventory",
    type: "领用人不在名单",
    description: "领用人不在队员名单表中",
    fieldPatterns: ["领用人", "领用", "借用人", "使用人"],
    check: "not-in-members",
    suggestion: "确认领用人姓名与名单表一致，或先把该队员补进名单表",
  },
  {
    id: "inventory-location-empty",
    table: "inventory",
    type: "位置缺失",
    description: "物资位置字段为空",
    fieldPatterns: ["位置", "库位", "货架", "仓库", "location"],
    check: "empty",
    suggestion: "补上存放位置（货架/库房）",
  },
  {
    id: "finance-amount-empty",
    table: "finance",
    type: "金额缺失",
    description: "报销金额为空",
    fieldPatterns: ["报销金额", "^金额", "金额", "费用", "amount"],
    check: "empty",
    suggestion: "补填报销金额",
  },
  {
    id: "finance-invoice-conflict",
    table: "finance",
    type: "发票流程矛盾",
    description: "发票状态为已收/已交，但流程仍停在未提交/草稿",
    fieldPatterns: ["发票"],
    field2Patterns: ["^状态", "流程", "进度", "status"],
    check: "conflict",
    pattern: "已收|已交|已上传|已开票",
    pattern2: "未提交|草稿|待提交",
    suggestion: "推进报销流程状态，或更正发票状态",
  },
];
