/**
 * 团队周报自动化 — 每周一 00:16–00:20（UTC）cron 聚合推送
 *
 * 数据流：五张底表（复用 dashboard 的 30 分钟缓存）+ 仓库列表（复用 repos 的 1 小时缓存）
 * → 与 KV weekly:snapshot 中上周快照 diff → 模板文案 → notifyFeishu（flow=weekly_report，
 * 可用 FEISHU_BOT_WEBHOOK_WEEKLY_REPORT 分流到独立群，缺省回落 FEISHU_BOT_WEBHOOK 主 webhook）。
 * 手动触发：POST /api/reports/weekly/run（队长/组长，供联调与补发）。
 *
 * 纯函数（extract / computeWeeklyData / buildSnapshot / buildWeeklyText）与 IO 分离，便于单测；v1 不接 LLM。
 * 子请求预算：免费档单次 cron 50 子请求上限——底表走缓存（过期才拉飞书），
 * 仓库 commits 只查本周 pushed_at 有更新的前 MAX_COMMIT_REPOS 个，每仓 1 次请求。
 */

import { ROLES, resolveUserRole } from "../auth/role";
import { DASH_TABLES, fetchTableCached, getDashboardConfig, type DashTable, type TableFetchResult } from "../dashboard";
import { BitableRecord, fieldNum, fieldText, fieldTs, findFieldKey, firstFieldText } from "../feishu/bitable";
import { notifyFeishu } from "../feishu/bot";
import { buildRepos } from "../repos";
import { json } from "../shared/http";
import { resolveSession } from "../shared/session";

/** KV：上周聚合快照（周环比 diff 用） */
export const WEEKLY_SNAPSHOT_KEY = "weekly:snapshot";
/** KV：最近一次周报文案与推送结果（手动触发端点回显用） */
export const WEEKLY_LAST_KEY = "weekly:last";
/** 本周有更新才查 commits 的仓库上限（配合 50 子请求预算） */
const MAX_COMMIT_REPOS = 8;
/** 逾期任务清单展示上限 */
const MAX_OVERDUE_ITEMS = 5;

/** 任务完成状态判定（与 dashboard.ts 同一口径） */
const TASK_DONE_RE = /完成|已完|完结|done|取消|cancel|关闭|close|drop/i;

/** 全量手动触发允许的角色（与 /api/validate/run 同一口径） */
const LEADER_ROLE_RE = ROLES.LEADER;

// ---------- 数据结构 ----------

/** 任务记录提取结果（diff 与逾期清单共用） */
export interface TaskItem {
  id: string;
  title: string;
  owner: string;
  done: boolean;
  deadline: number | null;
}

/** 报销记录提取结果（按 record_id diff 新增） */
export interface FinanceItem {
  id: string;
  amount: number;
}

/** 仓库本周提交数 */
export interface RepoCommit {
  name: string;
  url: string;
  count: number;
}

/** 落 KV 的周快照（只存 diff 所需的最小信息） */
export interface WeeklySnapshot {
  at: string;
  /** 任务 record_id → 是否已完成 */
  tasks: Record<string, boolean>;
  financeIds: string[];
  financeCount: number;
  financeTotal: number;
  inventoryCount: number;
  goalsCount: number;
  membersCount: number;
}

/** 周报聚合结果（prev 内嵌一份，buildWeeklyText 可直接取用） */
export interface WeeklyData {
  generatedAt: string;
  /** 本周统计起点（7 天前，ISO） */
  weekStart: string;
  membersCount: number;
  tasksTotal: number;
  tasksOpen: number;
  /** 本周新增任务数（首周无快照为 0） */
  tasksNew: number;
  /** 本周新完成任务数（含新增即完成；首周为 0） */
  tasksDone: number;
  overdueCount: number;
  overdueTop: Array<{ title: string; owner: string; deadline: string; days: number }>;
  financeCount: number;
  financeTotal: number;
  financeNewCount: number;
  financeNewAmount: number;
  inventoryCount: number;
  /** 较上周物资条数变动（首周无快照为 null） */
  inventoryDelta: number | null;
  goalsCount: number;
  commitsTotal: number;
  /** 本周有提交的仓库，按提交数降序 */
  repoCommits: RepoCommit[];
  /** 实际查询 commits 的仓库数 */
  reposChecked: number;
  /** 因本周无 pushed_at 更新或超上限而跳过的仓库数 */
  reposSkipped: number;
  /** 各数据源拉取失败信息（表名/仓库名 → 错误） */
  errors: Record<string, string>;
  prev: WeeklySnapshot | null;
}

/** computeWeeklyData 的输入（全部为已提取的纯数据） */
export interface WeeklyInput {
  taskItems: TaskItem[];
  financeItems: FinanceItem[];
  inventoryCount: number;
  goalsCount: number;
  membersCount: number;
  repoCommits: RepoCommit[];
  reposChecked: number;
  reposSkipped: number;
  errors: Record<string, string>;
  generatedAt: string;
}

// ---------- 纯函数：字段提取 / diff / 快照 / 文案 ----------

/** 任务表记录 → TaskItem（字段名按看板同一套正则模糊匹配） */
export function extractTaskItems(records: BitableRecord[]): TaskItem[] {
  const statusKey = findFieldKey(records, [/^状态/, /状态/, /进度/, /status/i]);
  const ownerKey = findFieldKey(records, [/负责人/, /执行人/, /owner/i, /assignee/i]);
  const titleKey = findFieldKey(records, [/^任务/, /任务/, /事项/, /标题/, /title/i]);
  const deadlineKey = findFieldKey(records, [/截止/, /deadline/i, /完成时间/, /日期/]);
  return records.map((r) => {
    const status = statusKey ? fieldText(r.fields[statusKey]) : "";
    return {
      id: r.record_id,
      title: (titleKey ? fieldText(r.fields[titleKey]) : "") || firstFieldText(r),
      owner: ownerKey ? fieldText(r.fields[ownerKey]) : "",
      done: status ? TASK_DONE_RE.test(status) : false,
      deadline: deadlineKey ? fieldNum(r.fields[deadlineKey]) : null,
    };
  });
}

/** 财务表记录 → FinanceItem（金额字段模糊匹配，解析失败记 0） */
export function extractFinanceItems(records: BitableRecord[]): FinanceItem[] {
  const amountKey = findFieldKey(records, [/报销金额/, /^金额/, /金额/, /费用/, /amount/i]);
  return records.map((r) => ({
    id: r.record_id,
    amount: amountKey ? (fieldNum(r.fields[amountKey]) ?? 0) : 0,
  }));
}

/** 与上周快照 diff，产出周报结构化数据（首周 prev=null 时新增/完成/变动均不给环比数） */
export function computeWeeklyData(input: WeeklyInput, prev: WeeklySnapshot | null, now: number): WeeklyData {
  const { taskItems, financeItems } = input;
  // 逾期口径与看板一致：截止时间在「今天 0 点」之前且未完成
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const overdue = taskItems.filter((t) => !t.done && t.deadline !== null && t.deadline < dayStart.getTime());
  const overdueTop = overdue
    .slice()
    .sort((a, b) => (a.deadline ?? 0) - (b.deadline ?? 0))
    .slice(0, MAX_OVERDUE_ITEMS)
    .map((t) => ({
      title: t.title,
      owner: t.owner,
      deadline: fmtDay(new Date(t.deadline as number).toISOString()),
      days: Math.max(1, Math.ceil((now - (t.deadline as number)) / 86400000)),
    }));

  const prevFinanceIds = new Set(prev?.financeIds ?? []);
  const financeNew = prev ? financeItems.filter((f) => !prevFinanceIds.has(f.id)) : [];
  const repoCommits = input.repoCommits.slice().sort((a, b) => b.count - a.count);

  return {
    generatedAt: input.generatedAt,
    weekStart: new Date(now - 7 * 86400000).toISOString(),
    membersCount: input.membersCount,
    tasksTotal: taskItems.length,
    tasksOpen: taskItems.filter((t) => !t.done).length,
    tasksNew: prev ? taskItems.filter((t) => !(t.id in prev.tasks)).length : 0,
    tasksDone: prev ? taskItems.filter((t) => t.done && prev.tasks[t.id] !== true).length : 0,
    overdueCount: overdue.length,
    overdueTop,
    financeCount: financeItems.length,
    financeTotal: financeItems.reduce((s, f) => s + f.amount, 0),
    financeNewCount: financeNew.length,
    financeNewAmount: financeNew.reduce((s, f) => s + f.amount, 0),
    inventoryCount: input.inventoryCount,
    inventoryDelta: prev ? input.inventoryCount - prev.inventoryCount : null,
    goalsCount: input.goalsCount,
    commitsTotal: repoCommits.reduce((s, r) => s + r.count, 0),
    repoCommits,
    reposChecked: input.reposChecked,
    reposSkipped: input.reposSkipped,
    errors: input.errors,
    prev,
  };
}

/** 由聚合输入生成本周快照（写回 KV 供下周 diff） */
export function buildSnapshot(input: WeeklyInput): WeeklySnapshot {
  return {
    at: input.generatedAt,
    tasks: Object.fromEntries(input.taskItems.map((t) => [t.id, t.done])),
    financeIds: input.financeItems.map((f) => f.id),
    financeCount: input.financeItems.length,
    financeTotal: input.financeItems.reduce((s, f) => s + f.amount, 0),
    inventoryCount: input.inventoryCount,
    goalsCount: input.goalsCount,
    membersCount: input.membersCount,
  };
}

/** ISO → MM-DD（按 UTC+8 展示，群消息给国内队员看） */
function fmtDay(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** 金额格式化：保留两位小数，整数去尾零 */
function fmtMoney(n: number): string {
  return String(Number(n.toFixed(2)));
}

/** 周报群消息文案（纯函数；prev=null 时输出「首次运行」提示） */
export function buildWeeklyText(data: WeeklyData, prev: WeeklySnapshot | null): string {
  const lines: string[] = [`📊 NEC 团队周报（${fmtDay(data.weekStart)} ～ ${fmtDay(data.generatedAt)}）`];

  lines.push(`✅ 任务：完成 ${data.tasksDone} · 新增 ${data.tasksNew} · 在办 ${data.tasksOpen}`);
  if (data.overdueCount > 0) {
    lines.push(`⚠️ 逾期 ${data.overdueCount} 项：`);
    for (const o of data.overdueTop) {
      lines.push(`· ${o.title}${o.owner ? `（${o.owner}）` : ""} 截止 ${o.deadline}，逾期 ${o.days} 天`);
    }
    if (data.overdueCount > data.overdueTop.length) {
      lines.push(`· … 另有 ${data.overdueCount - data.overdueTop.length} 项，见数据看板`);
    }
  } else {
    lines.push(`👍 无逾期任务`);
  }

  lines.push(
    `💰 报销：本周 +${data.financeNewCount} 笔 ¥${fmtMoney(data.financeNewAmount)}` +
      `（累计 ${data.financeCount} 笔 ¥${fmtMoney(data.financeTotal)}）`,
  );
  lines.push(
    `📦 物资：台账 ${data.inventoryCount} 条` +
      (data.inventoryDelta === null ? "" : `（较上周 ${data.inventoryDelta >= 0 ? "+" : ""}${data.inventoryDelta}）`),
  );
  lines.push(`🎯 赛季目标 ${data.goalsCount} 项 · 👥 队员 ${data.membersCount} 人`);

  if (data.reposChecked > 0) {
    lines.push(`💻 代码：本周 ${data.commitsTotal} 次提交（检查 ${data.reposChecked} 个活跃仓库）`);
    for (const r of data.repoCommits.slice(0, 3)) lines.push(`· ${r.name} ×${r.count}`);
  } else {
    lines.push(`💻 代码：本周仓库无新提交`);
  }

  if (prev === null) lines.push(`ℹ️ 首次运行，已建立本周快照，下周起提供环比数据`);
  const errKeys = Object.keys(data.errors);
  if (errKeys.length) lines.push(`⚠️ 部分数据源拉取失败：${errKeys.join("、")}`);
  return lines.join("\n");
}

// ---------- IO：仓库周提交数（GitHub/Gitee 复用 repos.ts 同款凭证与计数技巧） ----------

interface RepoInfo {
  host: "github" | "gitee";
  name: string;
  fullName: string;
  url: string;
  pushedAt: string;
}

/** GitHub commits?per_page=1&since= 的 Link 尾页号即区间内提交总数（与 repos.ts fetchCommitCount 同技巧） */
async function fetchGithubCommitCountSince(env: Env, fullName: string, sinceIso: string): Promise<number> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "nec-hub",
    "x-github-api-version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const resp = await fetch(
    `https://api.github.com/repos/${fullName}/commits?per_page=1&since=${encodeURIComponent(sinceIso)}`,
    { headers },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const link = resp.headers.get("link") ?? "";
  const last = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
  if (last) return Number(last[1]);
  const arr = (await resp.json()) as unknown[];
  return Array.isArray(arr) ? arr.length : 0;
}

/** Gitee commits 接口响应头 total_count 即提交总数（支持 since 过滤；无头时按返回条数计） */
async function fetchGiteeCommitCountSince(env: Env, fullName: string, sinceIso: string): Promise<number> {
  const u = new URL(`https://gitee.com/api/v5/repos/${fullName}/commits`);
  u.searchParams.set("per_page", "1");
  u.searchParams.set("since", sinceIso);
  if (env.GITEE_TOKEN) u.searchParams.set("access_token", env.GITEE_TOKEN);
  const resp = await fetch(u.toString(), { headers: { "user-agent": "nec-hub" } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const raw = resp.headers.get("total_count");
  if (raw != null && Number.isFinite(Number(raw))) return Number(raw);
  const arr = (await resp.json()) as unknown[];
  return Array.isArray(arr) ? arr.length : 0;
}

/** 读上周快照（损坏/不存在均视为首周） */
async function readPrevSnapshot(env: Env): Promise<WeeklySnapshot | null> {
  try {
    const raw = await env.REGISTRY.get(WEEKLY_SNAPSHOT_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as WeeklySnapshot;
    return s && typeof s === "object" && s.tasks ? s : null;
  } catch {
    return null;
  }
}

// ---------- 编排：聚合 / 推送 / 手动触发 ----------

/** 聚合一周数据：并行拉五张底表 + 仓库列表，与上周快照 diff 后写回本周快照 */
export async function aggregateWeekly(env: Env): Promise<WeeklyData> {
  const cfg = await getDashboardConfig(env);
  if (!cfg) throw new Error("数据看板尚未配置：请先调用 config_dashboard（action=set）写入 base 与 tables");
  const now = Date.now();
  const sinceMs = now - 7 * 86400000;
  const sinceIso = new Date(sinceMs).toISOString();

  // 五张底表 + 仓库列表并行；单源失败记 error 不中断整轮
  const tableResults = await Promise.all(DASH_TABLES.map((k) => fetchTableCached(env, cfg, k)));
  const tables = Object.fromEntries(DASH_TABLES.map((k, i) => [k, tableResults[i]])) as Record<DashTable, TableFetchResult>;
  const errors: Record<string, string> = {};
  for (const k of DASH_TABLES) {
    if (tables[k].error) errors[k] = tables[k].error as string;
  }

  let repos: RepoInfo[] = [];
  try {
    const r = (await buildRepos(env)) as { repos?: RepoInfo[] };
    repos = Array.isArray(r.repos) ? r.repos : [];
  } catch (err) {
    errors.repos = err instanceof Error ? err.message : String(err);
  }

  // 先按 pushed_at 过滤掉本周无更新的仓库（Gitee 的 pushedAt 取自 updated_at，偏宽但安全），
  // 按最近活跃排序后截取上限，控制子请求数
  const active = repos
    .filter((r) => r.pushedAt && Date.parse(r.pushedAt) >= sinceMs)
    .sort((a, b) => Date.parse(b.pushedAt) - Date.parse(a.pushedAt));
  const toCheck = active.slice(0, MAX_COMMIT_REPOS);
  const repoCommits: RepoCommit[] = [];
  await Promise.all(
    toCheck.map(async (r) => {
      try {
        const count =
          r.host === "gitee"
            ? await fetchGiteeCommitCountSince(env, r.fullName, sinceIso)
            : await fetchGithubCommitCountSince(env, r.fullName, sinceIso);
        if (count > 0) repoCommits.push({ name: r.name, url: r.url, count });
      } catch (err) {
        errors[`repo:${r.name}`] = err instanceof Error ? err.message : String(err);
      }
    }),
  );

  const input: WeeklyInput = {
    taskItems: extractTaskItems(tables.tasks.records),
    financeItems: extractFinanceItems(tables.finance.records),
    inventoryCount: tables.inventory.records.length,
    goalsCount: tables.goals.records.length,
    membersCount: tables.members.records.length,
    repoCommits,
    reposChecked: toCheck.length,
    reposSkipped: repos.length - toCheck.length,
    errors,
    generatedAt: new Date(now).toISOString(),
  };
  const prev = await readPrevSnapshot(env);
  const data = computeWeeklyData(input, prev, now);
  // 快照写回放在聚合末尾：本周数据作为下周的环比基线
  await env.REGISTRY.put(WEEKLY_SNAPSHOT_KEY, JSON.stringify(buildSnapshot(input)));
  return data;
}

/** 周报入口（cron / 手动触发共用）：聚合 → 文案 → 飞书推送；整体不抛错 */
export async function runWeeklyReport(env: Env): Promise<void> {
  try {
    const data = await aggregateWeekly(env);
    const text = buildWeeklyText(data, data.prev);
    const [title, ...rest] = text.split("\n");
    const res = await notifyFeishu(env, "weekly_report", title, rest.join("\n"), "https://hub.newenergycoder.club/#tab-dashboard");
    // 留痕最近一次周报（手动触发端点回显与排障用；写失败不影响主流程）
    await env.REGISTRY.put(WEEKLY_LAST_KEY, JSON.stringify({ at: data.generatedAt, text, notify: res.detail })).catch(() => {});
    if (!res.ok) console.error(`[nec-hub] weekly report push failed: ${res.detail}`);
  } catch (err) {
    console.error("[nec-hub] weekly report failed:", err);
  }
}

/** POST/GET /api/reports/weekly/run：队长/组长手动触发周报（联调与补发用），返回推送结果与文案 */
export async function handleWeeklyReportRun(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "请先登录后再触发周报" }, 401);
  const role = await resolveUserRole(env, session.user, ctx);
  if (!LEADER_ROLE_RE.test(role.role)) {
    return json({ error: `周报仅队长/组长可手动触发（当前角色：${role.role}）` }, 403);
  }
  await runWeeklyReport(env);
  const last = (await env.REGISTRY.get(WEEKLY_LAST_KEY, "json").catch(() => null)) as
    | { at: string; text: string; notify: string }
    | null;
  return json({ ok: true, last });
}
