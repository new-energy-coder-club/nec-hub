/**
 * FE-05 数据校验 Agent — 编排层：拉表 → 跑规则 → 出报告（KV）→ 飞书群机器人推送
 * 飞书表读取函数由调用方注入（index.ts 传 fetchTableCached，自带 5 分钟缓存与限流保护）
 */

import { BitableRecord, fieldText, findFieldKey } from "../feishu/bitable";
import { KV_KEYS } from "../shared/kv-keys";
import {
  DEFAULT_RULES,
  ValidateRule,
  ValidateTable,
  VALIDATE_TABLES,
  ValidationContext,
  Violation,
  diffViolationKeys,
  groupViolations,
  parseValidateRules,
  runRules,
  splitNames,
  violationKey,
} from "./rules";

/** KV：最新全量校验报告 */
export const VALIDATE_REPORT_KEY = KV_KEYS.validateReport;
/** KV：声明式规则集（缺省/损坏时回退 DEFAULT_RULES） */
export const VALIDATE_RULES_KEY = KV_KEYS.validateRules;
/** KV：上周全量校验的异常键快照（周报 diff 用） */
export const VALIDATE_WEEKLY_KEY = KV_KEYS.validateWeeklySnapshot;

export interface LinkedViolation extends Violation {
  link: string;
  /** 该记录里人名/飞书 ID 类字段的值（scope=mine 归属过滤用） */
  persons: string[];
}

export interface ValidateReport {
  generatedAt: string;
  scope: "all" | "mine";
  base: string;
  total: number;
  byType: Array<{ type: string; count: number }>;
  violations: LinkedViolation[];
  /** 各表拉取失败信息（表名 → 错误） */
  errors?: Record<string, string>;
}

/** 多维表格记录直链：形如 https://feishu.cn/base/<app_token>?table=<table_id>&record=<record_id> */
export function buildRecordLink(base: string, tableId: string, recordId: string): string {
  return `https://feishu.cn/base/${base}?table=${tableId}&record=${recordId}`;
}

export async function getValidateRules(env: Env): Promise<ValidateRule[]> {
  const raw = await env.REGISTRY.get(VALIDATE_RULES_KEY);
  if (!raw) return DEFAULT_RULES;
  try {
    const rules = parseValidateRules(JSON.parse(raw));
    return rules.length > 0 ? rules : DEFAULT_RULES;
  } catch {
    return DEFAULT_RULES;
  }
}

export async function setValidateRules(env: Env, raw: unknown): Promise<ValidateRule[]> {
  const rules = parseValidateRules(raw);
  if (rules.length === 0) throw new Error("规则数组不能为空（想恢复默认可用 action=reset）");
  await env.REGISTRY.put(VALIDATE_RULES_KEY, JSON.stringify(rules));
  return rules;
}

export async function resetValidateRules(env: Env): Promise<void> {
  await env.REGISTRY.delete(VALIDATE_RULES_KEY);
}

export interface ValidateTableSource {
  base: string;
  tables: Partial<Record<ValidateTable, string>>;
}

export type FetchValidateTable = (table: ValidateTable) => Promise<{ records: BitableRecord[]; error?: string }>;

/** 人名/飞书 ID 类字段（scope=mine 归属过滤用） */
const PERSON_FIELD_RE = /负责人|执行人|领用人|领用|借用人|使用人|申请人|报销人|经手人|提交人|姓名|open_?id|飞书|owner|assignee/i;

function recordPersons(r: BitableRecord): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(r.fields ?? {})) {
    if (!PERSON_FIELD_RE.test(k)) continue;
    const t = fieldText(v).trim();
    if (t) out.push(t);
  }
  return out;
}

/** 全量校验：4 表并行拉取（复用调用方缓存），跑规则后拼记录直链与归属人 */
export async function runValidation(
  cfg: ValidateTableSource,
  fetchTable: FetchValidateTable,
  rules: ValidateRule[],
  scope: "all" | "mine" = "all",
  tables?: ValidateTable[],
): Promise<ValidateReport> {
  const wanted = (tables?.length ? tables : [...VALIDATE_TABLES]).filter((t) => VALIDATE_TABLES.includes(t));
  const data = new Map<ValidateTable, BitableRecord[]>();
  const errors: Record<string, string> = {};
  const results = await Promise.all(
    wanted.map(async (t) => {
      if (!cfg.tables[t]) return { t, records: null as BitableRecord[] | null, error: "未配置 table_id" };
      const res = await fetchTable(t);
      return { t, records: res.records, error: res.error };
    }),
  );
  for (const { t, records, error } of results) {
    if (records) data.set(t, records);
    if (error) errors[t] = error;
  }

  const memberRecords = data.get("members") ?? [];
  const nameKey = findFieldKey(memberRecords, [/^姓名$/, /姓名/, /名字/, /^name$/i]);
  const memberNames = new Set<string>();
  if (nameKey) {
    for (const r of memberRecords) {
      const n = fieldText(r.fields[nameKey]).trim();
      if (n) memberNames.add(n);
    }
  }
  const ctx: ValidationContext = { memberNames };

  const violations: LinkedViolation[] = [];
  for (const t of wanted) {
    const tableId = cfg.tables[t];
    if (!tableId) continue;
    const records = data.get(t) ?? [];
    const personsByRecord = new Map(records.map((r) => [r.record_id, recordPersons(r)]));
    for (const v of runRules(t, records, rules, ctx)) {
      violations.push({
        ...v,
        link: buildRecordLink(cfg.base, tableId, v.recordId),
        persons: personsByRecord.get(v.recordId) ?? [],
      });
    }
  }
  const groups = groupViolations(violations);
  return {
    generatedAt: new Date().toISOString(),
    scope,
    base: cfg.base,
    total: violations.length,
    byType: groups.map(({ type, count }) => ({ type, count })),
    violations,
    ...(Object.keys(errors).length ? { errors } : {}),
  };
}

/** 个人范围过滤：该记录的人名/飞书 ID 字段里命中本人姓名或 open_id */
export function filterViolationsForUser(report: ValidateReport, user: { name: string; open_id: string }): ValidateReport {
  const mine = (v: LinkedViolation): boolean =>
    v.persons.some((p) => p === user.open_id || (user.name && splitNames(p).includes(user.name)));
  const violations = report.violations.filter(mine);
  const groups = groupViolations(violations);
  return {
    ...report,
    scope: "mine",
    total: violations.length,
    byType: groups.map(({ type, count }) => ({ type, count })),
    violations,
  };
}

/** 周报快照 diff 并落 KV；返回 diff 结果（首次运行 prev 为空，全部计新增） */
export async function snapshotAndDiff(env: Env, report: ValidateReport) {
  const currKeys = report.violations.map(violationKey);
  const prev = (await env.REGISTRY.get(VALIDATE_WEEKLY_KEY, "json")) as { keys?: string[] } | null;
  const diff = diffViolationKeys(prev?.keys ?? null, currKeys);
  await env.REGISTRY.put(VALIDATE_WEEKLY_KEY, JSON.stringify({ keys: currKeys, at: report.generatedAt }));
  return diff;
}

/** 周报摘要文案（本周新增 / 已清零 / 持续异常） */
export function buildWeeklySummaryText(report: ValidateReport, diff: { added: number; cleared: number; ongoing: number }): string {
  const day = report.generatedAt.slice(0, 10);
  const lines = report.byType.map((t) => `· ${t.type} × ${t.count}`);
  return [
    `📋 NEC 数据健康周报（${day}）`,
    `本次校验共 ${report.total} 条异常：新增 ${diff.added} / 已清零 ${diff.cleared} / 持续 ${diff.ongoing}`,
    ...(lines.length ? ["按类型：", ...lines] : ["🎉 未发现异常，数据全绿"]),
    `详情与修复入口：https://hub.newenergycoder.club/#tab-dashboard （数据健康）`,
  ].join("\n");
}
