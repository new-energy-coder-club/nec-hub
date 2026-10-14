/**
 * 动态 PRD 看板 + GitHub push webhook
 *
 * GET /api/prd：M1/M2/M3 需求状态 + 总进度 + 最近 git 提交。
 *   初始状态为 PRD V2.0 §5 盘点基线（DEFAULT_PRD_ITEMS），之后由 Agent 调 MCP update_prd 维护（覆盖存 KV prd:status）。
 * POST /api/hooks/github：GitHub push webhook（HMAC-SHA256 验签 → 记录最近提交到 KV prd:last_commit → 推飞书群）。
 */

import { notifyFeishu } from "./feishu/bot";
import { json } from "./shared/http";

export const PRD_STATUSES = ["done", "partial", "pending", "todo"] as const;
export type PrdStatus = (typeof PRD_STATUSES)[number];

export interface PrdItem {
  title: string;
  priority: "P0" | "P1" | "P2";
  status: PrdStatus;
  note?: string;
}

/** 初始看板 = PRD V2.0 §5 盘点基线（2026-10-12）；后续用 update_prd 维护，KV prd:status 覆盖本默认值 */
export const DEFAULT_PRD_ITEMS: Record<string, PrdItem> = {
  "FE-01": { title: "飞书 OAuth 登录态与权限角色", priority: "P0", status: "done", note: "真实队长登录已验证" },
  "FE-02": { title: "数据基建落地与看板接入", priority: "P0", status: "partial", note: "4 表建成读真实数据；待团队录数据过验收" },
  "FE-11": { title: "飞书工作台入口切换", priority: "P1", status: "pending", note: "免费版路径：改应用 URL 为 hub，差发版" },
  "FE-03": { title: "资料页", priority: "P1", status: "partial", note: "功能上线；待填充内容（每类 ≥3 条）" },
  "FE-04": { title: "赛季目标可视化面板", priority: "P1", status: "todo" },
  "FE-05": { title: "数据校验 Agent", priority: "P1", status: "partial", note: "规则引擎上线；定时推送待配群机器人" },
  "FE-08": { title: "报销助手标杆应用", priority: "P1", status: "todo", note: "add_records 回写已就位" },
  "FE-10": { title: "品牌规范 Skill", priority: "P1", status: "partial", note: "nec-vi / nec-ppt 已上架" },
  "FE-06": { title: "千人千面「改我的首页」", priority: "P2", status: "todo" },
  "FE-07": { title: "组别默认首页", priority: "P2", status: "todo" },
  "FE-09": { title: "审批/待办聚合", priority: "P2", status: "partial", note: "并行会话已建 Plan B 审批引擎 v1" },
  "FE-12": { title: "Skill 仓库 CI", priority: "P2", status: "todo" },
  "FE-13": { title: "运营配置自动化复查（lark-cli）", priority: "P2", status: "todo" },
};

const PRD_MILESTONES = [
  { id: "M1", title: "地基", items: ["FE-01", "FE-02", "FE-11"] },
  { id: "M2", title: "资产与智能", items: ["FE-03", "FE-04", "FE-05", "FE-08", "FE-10"] },
  { id: "M3", title: "个性化与自动化", items: ["FE-06", "FE-07", "FE-09", "FE-12", "FE-13"] },
];

export async function buildPrdBoard(env: Env): Promise<unknown> {
  const raw = await env.REGISTRY.get("prd:status");
  let items = { ...DEFAULT_PRD_ITEMS };
  let updatedAt = "2026-10-12T00:00:00.000Z";
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { items?: Record<string, PrdItem>; updatedAt?: string };
      if (parsed.items) items = { ...DEFAULT_PRD_ITEMS, ...parsed.items };
      if (parsed.updatedAt) updatedAt = parsed.updatedAt;
    } catch { /* 用默认 */ }
  }
  const lastCommitRaw = await env.REGISTRY.get("prd:last_commit");
  let lastCommit: unknown = null;
  try {
    lastCommit = lastCommitRaw ? JSON.parse(lastCommitRaw) : null;
  } catch { lastCommit = null; }

  const milestones = PRD_MILESTONES.map((m) => ({
    ...m,
    done: m.items.filter((id) => items[id]?.status === "done").length,
    total: m.items.length,
    cards: m.items.map((id) => ({ id, ...(items[id] ?? { title: id, priority: "P2" as const, status: "todo" as const }) })),
  }));
  const all = Object.values(items);
  return {
    doc: "docs/团队AI中台PRD_V2.0.md",
    updatedAt,
    progress: { done: all.filter((i) => i.status === "done").length, total: all.length },
    milestones,
    lastCommit,
  };
}

/** update_prd：更新 PRD 看板需求状态（需 MCP_TOKEN）；状态变化推飞书群 */
export async function toolUpdatePrd(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) throw new Error("update_prd 仅管理端可用（需 MCP_TOKEN）");
  const id = String(args.id ?? "").trim().toUpperCase();
  const status = String(args.status ?? "").trim() as PrdStatus;
  if (!DEFAULT_PRD_ITEMS[id]) throw new Error(`未知需求 id：${id}（FE-01 ~ FE-13）`);
  if (!PRD_STATUSES.includes(status)) {
    throw new Error(`status 必须是：${PRD_STATUSES.join(" | ")}`);
  }
  const note = args.note != null ? String(args.note) : undefined;

  const raw = await env.REGISTRY.get("prd:status");
  let data: { items: Record<string, PrdItem>; updatedAt: string };
  try {
    data = raw ? (JSON.parse(raw) as typeof data) : { items: {}, updatedAt: "" };
  } catch {
    data = { items: {}, updatedAt: "" };
  }
  const prev = data.items[id]?.status;
  data.items[id] = { ...DEFAULT_PRD_ITEMS[id], ...data.items[id], status, ...(note !== undefined ? { note } : {}) };
  data.updatedAt = new Date().toISOString();
  await env.REGISTRY.put("prd:status", JSON.stringify(data));

  // 状态变化推群（未配置 webhook 时静默跳过，由 notifyFeishu 内部留痕）
  if (prev !== status) {
    await notifyFeishu(env, "prd", `📋 PRD 状态变更：${id} → ${status}`,
      `${data.items[id].title}${note ? `\n备注：${note}` : ""}`,
      "https://hub.newenergycoder.club");
  }
  return {
    content: [{ type: "text", text: `✅ ${id} 状态已更新：${prev ?? "-"} → ${status}（看板 /api/prd 与门户「PRD 看板」Tab 已同步）` }],
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
  await env.REGISTRY.put("prd:last_commit", JSON.stringify(entry), { expirationTtl: 30 * 24 * 3600 });
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
