/**
 * 赛季目标管理 — 飞书 Base 数据适配器
 *
 * 读取侧按记录样本正则匹配字段名（findFieldKey，同 dashboard 风格），字段 key 在每批记录
 * 映射前一次性解析（resolveSeasonKeys），不再逐条记录重复嗅探；
 * 写入侧先拉字段元数据再按正则 + ui_type 匹配（matchField，同 reimburse 风格），
 * 日期字段为 DateTime 类型时转毫秒时间戳。字段名不做硬编码假设。
 */

import {
  BitableFieldMeta,
  BitableRecord,
  fieldNum,
  fieldText,
  fieldTs,
  listBitableFields,
  matchField,
} from "../feishu/bitable";
import {
  GOAL_DEADLINE_PATTERNS,
  GOAL_GROUP_PATTERNS,
  GOAL_KR_PATTERNS,
  GOAL_NOTE_PATTERNS,
  GOAL_PROGRESS_PATTERNS,
  GOAL_SOURCE_PATTERNS,
  GOAL_STATUS_PATTERNS,
  GOAL_SUBMITTER_PATTERNS,
  GOAL_TITLE_EXACT_PATTERNS,
  TASK_TITLE_EXACT_PATTERNS,
  findFieldKey,
} from "../shared/bitable-fields";
import { FeishuTableAdapter } from "../shared/feishu-table-adapter";
import type { CollectRecord, GoalRecord, SeasonGoalsConfig, SeasonGoalsTable, TaskLite } from "./types";

const TITLE_PATTERNS = GOAL_TITLE_EXACT_PATTERNS;
const KRS_PATTERNS = GOAL_KR_PATTERNS;
const GROUP_PATTERNS = GOAL_GROUP_PATTERNS;
const DEADLINE_PATTERNS = GOAL_DEADLINE_PATTERNS;
const PROGRESS_PATTERNS = GOAL_PROGRESS_PATTERNS;
const STATUS_PATTERNS = GOAL_STATUS_PATTERNS;
const SOURCE_PATTERNS = GOAL_SOURCE_PATTERNS;
const NOTE_PATTERNS = GOAL_NOTE_PATTERNS;
const SUBMITTER_PATTERNS = GOAL_SUBMITTER_PATTERNS;

/** 写入字段入参（目标表与收集单表共用形状） */
export interface GoalWriteFields {
  title?: string;
  krs?: string;
  group?: string;
  deadline?: string;
  progress?: number;
  status?: string;
  source?: string;
  note?: string;
  submitter?: string;
}

export class SeasonGoalsAdapter extends FeishuTableAdapter<SeasonGoalsConfig, SeasonGoalsTable> {
  private metaCache = new Map<SeasonGoalsTable, BitableFieldMeta[]>();

  constructor(env: Env, cfg: SeasonGoalsConfig) {
    super(env, cfg, "赛季目标管理");
  }

  private async metas(table: SeasonGoalsTable): Promise<BitableFieldMeta[]> {
    const cached = this.metaCache.get(table);
    if (cached) return cached;
    const token = await this.token();
    const metas = await listBitableFields(token, this.cfg.base, this.tableId(table));
    this.metaCache.set(table, metas);
    return metas;
  }

  /** 按字段元数据把业务字段映射为可写 record；日期遇 DateTime 字段转毫秒时间戳 */
  private async buildFields(table: SeasonGoalsTable, input: GoalWriteFields): Promise<Record<string, unknown>> {
    const metas = await this.metas(table);
    const out: Record<string, unknown> = {};
    const put = (patterns: RegExp[], value: string | number | undefined) => {
      if (value === undefined || value === "") return;
      const m = matchField(metas, patterns);
      if (!m) return;
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && /DateTime/i.test(m.ui_type)) {
        out[m.field_name] = Date.parse(value + "T00:00:00+08:00");
      } else {
        out[m.field_name] = value;
      }
    };
    put(TITLE_PATTERNS, input.title);
    put(KRS_PATTERNS, input.krs);
    put(GROUP_PATTERNS, input.group);
    put(DEADLINE_PATTERNS, input.deadline);
    put(PROGRESS_PATTERNS, input.progress);
    put(STATUS_PATTERNS, input.status);
    put(SOURCE_PATTERNS, input.source);
    put(NOTE_PATTERNS, input.note);
    put(SUBMITTER_PATTERNS, input.submitter);
    return out;
  }

  // ---------- 目标表 ----------

  async listGoals(): Promise<GoalRecord[]> {
    const records = await this.listRecords("goals");
    const keys = resolveSeasonKeys(records);
    return records.map((r) => recordToGoal(r, keys)).filter((g) => g.title);
  }

  async createGoal(input: GoalWriteFields): Promise<BitableRecord> {
    const fields = await this.buildFields("goals", input);
    return this.createRecord("goals", fields);
  }

  // ---------- 收集单表 ----------

  async listSubmissions(): Promise<CollectRecord[]> {
    const records = await this.listRecords("collect");
    const keys = resolveSeasonKeys(records);
    return records.map((r) => recordToSubmission(r, keys)).filter((s) => s.title);
  }

  async getSubmission(recordId: string): Promise<CollectRecord | null> {
    // 按 record_id 直连 GET /records/:record_id，不再全表扫描；
    // 单条记录可能缺空字段，字段 key 改从字段元数据（带缓存）解析，避免漏配字段被忽略
    const rec = await this.getRecord("collect", recordId);
    if (!rec) return null;
    return recordToSubmission(rec, keysFromMetas(await this.metas("collect")));
  }

  async createSubmission(input: GoalWriteFields): Promise<BitableRecord> {
    const fields = await this.buildFields("collect", input);
    return this.createRecord("collect", fields);
  }

  async updateSubmission(recordId: string, input: GoalWriteFields): Promise<BitableRecord> {
    const fields = await this.buildFields("collect", input);
    return this.updateRecord("collect", recordId, fields);
  }

  // ---------- 任务表（自动规划输入） ----------

  async listTasks(): Promise<TaskLite[]> {
    const records = await this.listRecords("tasks");
    return mapTaskRecords(records);
  }
}

/** 毫秒时间戳 → YYYY-MM-DD（按 UTC+8） */
export function tsToDateStr(ts: number): string {
  return new Date(ts + 8 * 3600_000).toISOString().slice(0, 10);
}

/** 把记录中的日期字段（时间戳或文本）归一化为 YYYY-MM-DD */
function deadlineText(v: unknown): string {
  const ts = fieldTs(v);
  return ts !== null ? tsToDateStr(ts) : "";
}

/** 飞书「进度」字段返回 0-1 小数时归一到 0-100 */
export function normalizeProgress(v: unknown): number {
  let p = fieldNum(v);
  if (p === null) return 0;
  if (p > 0 && p <= 1) p = p * 100;
  return Math.min(Math.max(Math.round(p), 0), 100);
}

/** 一批记录的字段 key 快照：映射前一次性解析，避免逐条记录重复 findFieldKey */
interface SeasonFieldKeys {
  title: string | null;
  krs: string | null;
  group: string | null;
  deadline: string | null;
  progress: string | null;
  status: string | null;
  source: string | null;
  note: string | null;
  submitter: string | null;
}

function resolveSeasonKeys(records: BitableRecord[]): SeasonFieldKeys {
  return {
    title: findFieldKey(records, TITLE_PATTERNS),
    krs: findFieldKey(records, KRS_PATTERNS),
    group: findFieldKey(records, GROUP_PATTERNS),
    deadline: findFieldKey(records, DEADLINE_PATTERNS),
    progress: findFieldKey(records, PROGRESS_PATTERNS),
    status: findFieldKey(records, STATUS_PATTERNS),
    source: findFieldKey(records, SOURCE_PATTERNS),
    note: findFieldKey(records, NOTE_PATTERNS),
    submitter: findFieldKey(records, SUBMITTER_PATTERNS),
  };
}

/** 单条读取路径的 key 解析：从字段元数据匹配（覆盖值为空、记录 JSON 里不出现的字段） */
function keysFromMetas(metas: BitableFieldMeta[]): SeasonFieldKeys {
  const pick = (patterns: RegExp[]) => matchField(metas, patterns)?.field_name ?? null;
  return {
    title: pick(TITLE_PATTERNS),
    krs: pick(KRS_PATTERNS),
    group: pick(GROUP_PATTERNS),
    deadline: pick(DEADLINE_PATTERNS),
    progress: pick(PROGRESS_PATTERNS),
    status: pick(STATUS_PATTERNS),
    source: pick(SOURCE_PATTERNS),
    note: pick(NOTE_PATTERNS),
    submitter: pick(SUBMITTER_PATTERNS),
  };
}

function recordToGoal(r: BitableRecord, keys: SeasonFieldKeys): GoalRecord {
  const f = r.fields;
  const get = (k: string | null) => (k ? f[k] : undefined);
  return {
    recordId: r.record_id,
    title: fieldText(get(keys.title)),
    krs: fieldText(get(keys.krs)),
    group: fieldText(get(keys.group)) || "未分组",
    deadline: deadlineText(get(keys.deadline)),
    progress: normalizeProgress(get(keys.progress)),
    status: fieldText(get(keys.status)),
    source: fieldText(get(keys.source)),
    note: fieldText(get(keys.note)),
  };
}

function recordToSubmission(r: BitableRecord, keys: SeasonFieldKeys): CollectRecord {
  const f = r.fields;
  const get = (k: string | null) => (k ? f[k] : undefined);
  return {
    recordId: r.record_id,
    title: fieldText(get(keys.title)),
    krs: fieldText(get(keys.krs)),
    group: fieldText(get(keys.group)) || "未分组",
    deadline: deadlineText(get(keys.deadline)),
    note: fieldText(get(keys.note)),
    source: fieldText(get(keys.source)) || "手工",
    submitter: fieldText(get(keys.submitter)),
    status: fieldText(get(keys.status)) || "待评审",
  };
}

/** 任务表记录 → TaskLite（模块 tasks 表与看板 tasks 表共用映射） */
export function mapTaskRecords(records: BitableRecord[]): TaskLite[] {
  const titleKey = findFieldKey(records, TASK_TITLE_EXACT_PATTERNS);
  const groupKey = findFieldKey(records, GROUP_PATTERNS);
  const deadlineKey = findFieldKey(records, DEADLINE_PATTERNS);
  const statusKey = findFieldKey(records, STATUS_PATTERNS);
  return records
    .map((r) => ({
      recordId: r.record_id,
      title: titleKey ? fieldText(r.fields[titleKey]) : "",
      group: (groupKey ? fieldText(r.fields[groupKey]) : "") || "未分组",
      deadline: deadlineKey ? deadlineText(r.fields[deadlineKey]) : "",
      status: statusKey ? fieldText(r.fields[statusKey]) : "",
    }))
    .filter((t) => t.title);
}
