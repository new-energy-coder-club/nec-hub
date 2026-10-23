/**
 * 动态 PRD 看板 + GitHub push webhook
 *
 * GET /api/prd：M1~M4 需求状态 + 总进度 + 最近 git 提交。子项（subs，如 FE-17/FE-18）挂靠大项、由门户悬停浮层展示，不计进度。
 *   初始状态为 PRD V2.1 §0 盘点基线（DEFAULT_PRD_ITEMS），之后由 Agent 调 MCP update_prd 维护（覆盖存 KV prd:status）。
 * POST /api/hooks/github：GitHub push webhook（HMAC-SHA256 验签 → 最近提交写 KV prd:last_commit + 列表 prd:recent_commits（最多 10 条）→ 推飞书群）。
 */

import { notifyFeishu } from "./feishu/bot";
import { json } from "./shared/http";
import { KV_KEYS } from "./shared/kv-keys";

export const PRD_STATUSES = ["done", "partial", "pending", "todo"] as const;
export type PrdStatus = (typeof PRD_STATUSES)[number];

export interface PrdItem {
  title: string;
  priority: "P0" | "P1" | "P2";
  status: PrdStatus;
  note?: string;
  /** 子项：挂靠在大项下，门户卡片悬停浮层展示，不计入里程碑进度 */
  subs?: Record<string, Omit<PrdItem, "subs">>;
}

/** 初始看板 = PRD V2.1 §0 盘点基线（2026-10-24 刷新，含 FE-14~18）；后续用 update_prd 维护，KV prd:status 覆盖本默认值 */
export const DEFAULT_PRD_ITEMS: Record<string, PrdItem> = {
  "FE-01": { title: "飞书 OAuth 登录态与权限角色", priority: "P0", status: "partial", note: "真实登录已验证 + 登录体验优化（无感重登/保现场）；飞书内 JSAPI 免登未做" },
  "FE-02": { title: "数据基建落地与看板接入", priority: "P0", status: "partial", note: "灌数收口：物资12/财务6/目标6，名单组别 48/53；剩 5 人待确认" },
  "FE-11": { title: "飞书工作台入口切换", priority: "P1", status: "partial", note: "就绪待超管后台启用定制工作台指向 hub（纯手动，无 OpenAPI）" },
  "FE-03": { title: "资料页", priority: "P1", status: "done", note: "后端 + 门户 Tab + publish_doc 已上线，持续维护" },
  "FE-04": {
    title: "赛季目标可视化面板", priority: "P1", status: "done",
    note: "goals 区块 + update_progress + goal-banner T-7 提醒已上线",
    subs: {
      "FE-18": { title: "赛季目标收集与自动规划", priority: "P1", status: "partial", note: "收集单提交/采纳/拒绝 + 按组聚合未完成任务生成目标建议已上线；待数据流打通验证与真实收集" },
    },
  },
  "FE-05": { title: "数据校验 Agent", priority: "P1", status: "done", note: "规则引擎 + 数据健康区块 + 周一 cron 周报推群已上线；异常清零中" },
  "FE-08": { title: "报销助手标杆应用", priority: "P1", status: "partial", note: "ERP 化（D1）+ 台账 manage 接口 + 发票 OCR 自动回填；待端到端实测一单" },
  "FE-10": { title: "品牌规范 Skill", priority: "P1", status: "done", note: "nec-vi / nec-ppt 已上架 Skill 中心" },
  "FE-06": { title: "千人千面「改我的首页」", priority: "P2", status: "done", note: "工作台升级 12 项全落地；待真实账号走查验收" },
  "FE-07": { title: "组别默认首页", priority: "P2", status: "done", note: "三层回退（个人 > 组 > 默认）已上线" },
  "FE-09": {
    title: "审批/待办聚合", priority: "P2", status: "partial",
    note: "四类聚合 + 合规 T-1 标红已交付，登录实测通过；48h 视角复核与审批 scope 待办",
    subs: {
      "FE-17": { title: "我的任务（飞书任务绑定同步）", priority: "P1", status: "partial", note: "Task v2 同步 + 5min 缓存 + 解绑已上线；待队员真实账号绑定走查" },
    },
  },
  "FE-12": { title: "Skill 仓库 CI", priority: "P2", status: "done", note: "quality-check.yml 强制校验 + PR 自动评论质量报告" },
  "FE-13": { title: "运营配置自动化复查（lark-cli）", priority: "P2", status: "done", note: "能力边界验证报告已交付" },
  "FE-14": { title: "新增机图纸评审流程", priority: "P1", status: "done", note: "10 表配齐 + 询价比价 + 流程看板 + 群通知 + 阻塞告警 cron；飞书会议/ERP/MES 联调待办" },
  "FE-15": { title: "硬件评审流程", priority: "P1", status: "partial", note: "后端 + 独立应用页 + 评估报告流转已上线；待真实数据走查与门户入口曝光" },
  "FE-16": { title: "合同审批流程", priority: "P1", status: "partial", note: "状态机 + 会签权限 + 前端可用性重构（12 项）已上线；待真实合同走查" },
};

const PRD_MILESTONES = [
  { id: "M1", title: "地基", items: ["FE-01", "FE-02", "FE-11"] },
  { id: "M2", title: "资产与智能", items: ["FE-03", "FE-04", "FE-05", "FE-08", "FE-10"] },
  { id: "M3", title: "个性化与自动化", items: ["FE-06", "FE-07", "FE-09", "FE-12", "FE-13"] },
  { id: "M4", title: "业务流程域", items: ["FE-14", "FE-15", "FE-16"] },
];

export async function buildPrdBoard(env: Env): Promise<unknown> {
  const raw = await env.REGISTRY.get(KV_KEYS.prdStatus);
  let items = { ...DEFAULT_PRD_ITEMS };
  let updatedAt = "2026-10-12T00:00:00.000Z";
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { items?: Record<string, PrdItem>; updatedAt?: string };
      if (parsed.items) {
        const merged: Record<string, PrdItem> = { ...DEFAULT_PRD_ITEMS };
        for (const [id, override] of Object.entries(parsed.items)) {
          const base = DEFAULT_PRD_ITEMS[id];
          const subs = { ...base?.subs, ...override?.subs };
          merged[id] = { ...base, ...override, ...(Object.keys(subs).length ? { subs } : {}) } as PrdItem;
        }
        items = merged;
      }
      if (parsed.updatedAt) updatedAt = parsed.updatedAt;
    } catch { /* 用默认 */ }
  }
  const lastCommitRaw = await env.REGISTRY.get(KV_KEYS.prdLastCommit);
  let lastCommit: unknown = null;
  try {
    lastCommit = lastCommitRaw ? JSON.parse(lastCommitRaw) : null;
  } catch { lastCommit = null; }

  let recentCommits: unknown[] = [];
  try {
    const rawList = await env.REGISTRY.get(KV_KEYS.prdRecentCommits);
    const parsed = rawList ? JSON.parse(rawList) : [];
    if (Array.isArray(parsed)) recentCommits = parsed;
  } catch { recentCommits = []; }
  // 列表为空但存在单条记录（列表功能上线前的存量数据）时回落
  if (!recentCommits.length && lastCommit) recentCommits = [lastCommit];

  const milestones = PRD_MILESTONES.map((m) => ({
    ...m,
    done: m.items.filter((id) => items[id]?.status === "done").length,
    total: m.items.length,
    cards: m.items.map((id) => ({ id, ...(items[id] ?? { title: id, priority: "P2" as const, status: "todo" as const }) })),
  }));
  const all = Object.values(items);
  return {
    doc: "docs/团队AI中台PRD_V2.1.md",
    updatedAt,
    progress: { done: all.filter((i) => i.status === "done").length, total: all.length },
    milestones,
    lastCommit,
    recentCommits,
  };
}

/** update_prd：更新 PRD 看板需求状态（需 MCP_TOKEN）；状态变化推飞书群。子项（如 FE-17/FE-18）自动归到所属大项的 subs 下 */
export async function toolUpdatePrd(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) throw new Error("update_prd 仅管理端可用（需 MCP_TOKEN）");
  const id = String(args.id ?? "").trim().toUpperCase();
  const status = String(args.status ?? "").trim() as PrdStatus;
  if (!PRD_STATUSES.includes(status)) {
    throw new Error(`status 必须是：${PRD_STATUSES.join(" | ")}`);
  }
  // 大项直接命中；否则在子项（subs）里找归属大项
  let parentId: string | null = null;
  if (!DEFAULT_PRD_ITEMS[id]) {
    for (const [pid, item] of Object.entries(DEFAULT_PRD_ITEMS)) {
      if (item.subs?.[id]) { parentId = pid; break; }
    }
    if (!parentId) throw new Error(`未知需求 id：${id}（FE-01 ~ FE-18）`);
  }
  const note = args.note != null ? String(args.note) : undefined;

  const raw = await env.REGISTRY.get(KV_KEYS.prdStatus);
  let data: { items: Record<string, PrdItem>; updatedAt: string };
  try {
    data = raw ? (JSON.parse(raw) as typeof data) : { items: {}, updatedAt: "" };
  } catch {
    data = { items: {}, updatedAt: "" };
  }

  let prev: string | undefined;
  let title: string;
  if (parentId) {
    const parent = (data.items[parentId] ??= { ...DEFAULT_PRD_ITEMS[parentId] });
    const subs = (parent.subs ??= {});
    prev = subs[id]?.status;
    subs[id] = { ...DEFAULT_PRD_ITEMS[parentId].subs![id], ...subs[id], status, ...(note !== undefined ? { note } : {}) };
    title = subs[id].title;
  } else {
    prev = data.items[id]?.status;
    data.items[id] = { ...DEFAULT_PRD_ITEMS[id], ...data.items[id], status, ...(note !== undefined ? { note } : {}) };
    title = data.items[id].title;
  }
  data.updatedAt = new Date().toISOString();
  await env.REGISTRY.put(KV_KEYS.prdStatus, JSON.stringify(data));

  // 状态变化推群（未配置 webhook 时静默跳过，由 notifyFeishu 内部留痕）
  if (prev !== status) {
    await notifyFeishu(env, "prd", `📋 PRD 状态变更：${id} → ${status}`,
      `${title}${note ? `\n备注：${note}` : ""}`,
      "https://hub.newenergycoder.club");
  }
  const label = parentId ? `${parentId} › ${id}` : id;
  return {
    content: [{ type: "text", text: `✅ ${label} 状态已更新：${prev ?? "-"} → ${status}（看板 /api/prd 与门户「PRD 看板」Tab 已同步）` }],
  };
}

/** GitHub push webhook：验签 → 记录最近提交 → 推群通知 */
export async function handleGithubPush(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_WEBHOOK_SECRET) {
    return json({ error: "未配置 GITHUB_WEBHOOK_SECRET：先用 wrangler secret put GITHUB_WEBHOOK_SECRET 设置后，再在 GitHub 仓库 Settings → Webhooks 添加 https://hub.newenergycoder.club/api/hooks/github（Content type: application/json，secret 同上）" }, 500);
  }
  const bodyText = await request.text();
  const sig = request.headers.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + (await hmacSha256Hex(env.GITHUB_WEBHOOK_SECRET, bodyText));
  if (!(await timingSafeEqual(sig, expected))) {
    return json({ error: "signature mismatch" }, 401);
  }
  if (request.headers.get("x-github-event") !== "push") {
    return json({ ok: true, ignored: "not a push event" });
  }
  let payload: {
    ref?: string;
    repository?: { full_name?: string; html_url?: string };
    head_commit?: { message?: string; author?: { name?: string }; url?: string; timestamp?: string } | null;
    commits?: Array<{ message?: string; author?: { name?: string }; url?: string; timestamp?: string }>;
  };
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const branch = (payload.ref ?? "").replace("refs/heads/", "") || "main";
  const commit = payload.head_commit ?? payload.commits?.[payload.commits.length - 1] ?? null;
  if (!commit) return json({ ok: true, ignored: "no commit" });

  const shortMsg = String(commit.message ?? "").split("\n")[0].slice(0, 80);
  const author = commit.author?.name ?? "unknown";
  const repo = payload.repository?.full_name ?? "nec-hub";
  const entry = {
    repo, branch, message: shortMsg, author,
    url: commit.url ?? payload.repository?.html_url ?? "",
    at: new Date().toISOString(),
  };
  await env.REGISTRY.put(KV_KEYS.prdLastCommit, JSON.stringify(entry), { expirationTtl: 30 * 24 * 3600 });
  // 最近提交列表（首页「团队动态」窄条消费，最多保留 10 条；prd:last_commit 保留兼容 PRD 看板）
  let recent: unknown[] = [];
  try {
    const rawList = await env.REGISTRY.get(KV_KEYS.prdRecentCommits);
    const parsed = rawList ? JSON.parse(rawList) : [];
    if (Array.isArray(parsed)) recent = parsed;
  } catch { /* 损坏则重建 */ }
  recent.unshift(entry);
  await env.REGISTRY.put(KV_KEYS.prdRecentCommits, JSON.stringify(recent.slice(0, 10)), { expirationTtl: 30 * 24 * 3600 });
  const pushResult = await notifyFeishu(env, "prd", `🔀 ${repo} 新提交（${branch}）`, `${shortMsg} — ${author}`, entry.url);
  return json({ ok: true, commit: entry, notified: pushResult.ok, notifyDetail: pushResult.detail });
}

/** HMAC-SHA256 → 小写 hex（GitHub webhook 验签用） */
async function hmacSha256Hex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  // Workers 运行时提供 subtle.timingSafeEqual；Node 测试环境没有，退化为手写常量时间比较
  if (typeof crypto.subtle.timingSafeEqual === "function") return crypto.subtle.timingSafeEqual(ab, bb);
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
