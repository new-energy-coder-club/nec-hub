/**
 * NEC 开源仓库聚合（/api/repos）
 *
 * GitHub org + Gitee 账号双源拉取合并；KV 缓存 1 小时，刷新失败降级返回过期快照。
 * GitHub 提交数用 commits 接口 Link 尾页号推断；Gitee 用响应头 total_count。
 */

import { KV_KEYS } from "./shared/kv-keys";

/** NEC 开源仓库条目（/api/repos 返回项，GitHub/Gitee 合并） */
interface RepoEntry {
  host: "github" | "gitee";
  name: string;
  fullName: string;
  url: string;
  description: string;
  stars: number;
  forks: number;
  /** 默认分支提交总数；拉取失败时为 null（GitHub 用 Link 尾页号推断，Gitee 用 total_count 响应头） */
  commits: number | null;
  language: string;
  updatedAt: string;
  pushedAt: string;
  isFork: boolean;
  archived: boolean;
  defaultBranch: string;
}

/** NEC 开源仓库的 GitHub 组织名（/api/repos 数据源之一） */
const GITHUB_ORG = "necc-hub";

/** NEC 开源仓库的 Gitee 默认账号（组织无 Gitee 版，用队长账号兜底；可用 wrangler vars GITEE_USER 覆盖） */
const GITEE_USER_DEFAULT = "darrenpig";

/** 仓库列表缓存 TTL（秒）。两源合计单次刷新约 40+ 次请求（GitHub/Gitee 匿名均 60 次/小时），建议配置 GITHUB_TOKEN / GITEE_TOKEN */
const REPOS_CACHE_TTL_SEC = 3600;

export async function buildRepos(env: Env, ctx?: ExecutionContext): Promise<unknown> {
  const giteeUser = env.GITEE_USER ?? GITEE_USER_DEFAULT;
  const cacheKey = KV_KEYS.reposCache;
  const legacyKey = KV_KEYS.legacyReposCache;
  const cached = await env.REGISTRY.get(cacheKey, "json") as
    | { data: RepoEntry[]; cachedAt: number }
    | null;
  if (cached && cached.cachedAt > Date.now() - REPOS_CACHE_TTL_SEC * 1000) {
    return { github: GITHUB_ORG, gitee: giteeUser, cachedAt: new Date(cached.cachedAt).toISOString(), repos: cached.data };
  }
  try {
    const repos = await fetchAllRepos(env);
    const write = env.REGISTRY.put(cacheKey, JSON.stringify({ data: repos, cachedAt: Date.now() }))
      .then(() => env.REGISTRY.delete(legacyKey)); // 清理单源时代的旧缓存
    if (ctx) ctx.waitUntil(write);
    else await write;
    return { github: GITHUB_ORG, gitee: giteeUser, cachedAt: new Date().toISOString(), repos };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (cached) {
      return {
        github: GITHUB_ORG,
        gitee: giteeUser,
        cachedAt: new Date(cached.cachedAt).toISOString(),
        stale: true,
        error: `${msg}（展示缓存快照）`,
        repos: cached.data,
      };
    }
    return { github: GITHUB_ORG, gitee: giteeUser, repos: [], error: msg };
  }
}

/** 双源拉取合并：单源失败不阻断另一源；双源均失败才抛错走缓存降级 */
async function fetchAllRepos(env: Env): Promise<RepoEntry[]> {
  const [gh, gj] = await Promise.allSettled([fetchOrgRepos(env), fetchGiteeRepos(env)]);
  const repos = [
    ...(gh.status === "fulfilled" ? gh.value : []),
    ...(gj.status === "fulfilled" ? gj.value : []),
  ];
  if (gh.status === "rejected" && gj.status === "rejected") {
    const reason = (p: PromiseRejectedResult) => (p.reason instanceof Error ? p.reason.message : String(p.reason));
    throw new Error(`GitHub 与 Gitee 均拉取失败：${reason(gh as PromiseRejectedResult)}`);
  }
  return repos.sort((a, b) => b.stars - a.stars || b.forks - a.forks || a.name.localeCompare(b.name));
}

async function fetchOrgRepos(env: Env): Promise<RepoEntry[]> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "nec-hub",
    "x-github-api-version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;

  const listResp = await fetch(
    `https://api.github.com/orgs/${GITHUB_ORG}/repos?per_page=100&type=public`,
    { headers },
  );
  if (!listResp.ok) {
    const body = await listResp.text().catch(() => "");
    throw new Error(`GitHub API 错误：HTTP ${listResp.status} ${body.slice(0, 200)}`);
  }
  const list = (await listResp.json()) as Array<{
    name: string;
    full_name: string;
    html_url: string;
    description: string | null;
    stargazers_count: number;
    forks_count: number;
    language: string | null;
    updated_at: string;
    pushed_at: string;
    fork: boolean;
    archived: boolean;
    default_branch: string;
  }>;

  // 逐仓库取默认分支提交总数；单仓库失败不阻断整表
  const repos = await Promise.all(
    list.map(async (r): Promise<RepoEntry> => {
      let commits = 0;
      try {
        commits = await fetchCommitCount(r.full_name, r.default_branch, headers);
      } catch { /* 该仓库提交数记 0 */ }
      return {
        host: "github",
        name: r.name,
        fullName: r.full_name,
        url: r.html_url,
        description: r.description ?? "",
        stars: r.stargazers_count,
        forks: r.forks_count,
        commits,
        language: r.language ?? "",
        updatedAt: r.updated_at,
        pushedAt: r.pushed_at,
        isFork: r.fork,
        archived: r.archived,
        defaultBranch: r.default_branch,
      };
    }),
  );
  return repos.sort((a, b) => b.stars - a.stars || b.forks - a.forks || a.name.localeCompare(b.name));
}

/** GET /repos/{full}/commits?per_page=1 时，Link 头的尾页号即提交总数；无 Link 头按返回条数计 */
async function fetchCommitCount(
  fullName: string,
  branch: string,
  headers: Record<string, string>,
): Promise<number> {
  const resp = await fetch(
    `https://api.github.com/repos/${fullName}/commits?per_page=1&sha=${encodeURIComponent(branch)}`,
    { headers },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const link = resp.headers.get("link") ?? "";
  const last = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
  if (last) return Number(last[1]);
  const arr = (await resp.json()) as unknown[];
  return Array.isArray(arr) ? arr.length : 0;
}

// ---------- Gitee 源 ----------

interface GiteeRepoApi {
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  updated_at: string;
  fork: boolean;
}

async function fetchGiteeRepos(env: Env): Promise<RepoEntry[]> {
  const token = env.GITEE_TOKEN;
  const list: GiteeRepoApi[] = [];
  for (let page = 1; page <= 5; page++) {
    const u = new URL(`https://gitee.com/api/v5/users/${env.GITEE_USER ?? GITEE_USER_DEFAULT}/repos`);
    u.searchParams.set("per_page", "100");
    u.searchParams.set("page", String(page));
    if (token) u.searchParams.set("access_token", token);
    const resp = await fetch(u.toString(), { headers: { "user-agent": "nec-hub" } });
    const data = (await resp.json()) as GiteeRepoApi[] | { message?: string };
    if (!resp.ok || !Array.isArray(data)) {
      const msg = (data as { message?: string }).message ?? "";
      throw new Error(`Gitee API 错误：HTTP ${resp.status} ${msg}`.trim());
    }
    list.push(...data);
    if (data.length < 100) break;
  }

  // 逐仓库取提交总数；单仓库失败仅该列留空
  const repos = await Promise.all(
    list.map(async (r): Promise<RepoEntry> => {
      let commits: number | null = null;
      try {
        commits = await fetchGiteeCommitCount(r.full_name, token);
      } catch { /* 该仓库提交数留空 */ }
      return {
        host: "gitee",
        name: r.name,
        fullName: r.full_name,
        url: `https://gitee.com/${r.full_name}`,
        description: r.description ?? "",
        stars: r.stargazers_count ?? 0,
        forks: r.forks_count ?? 0,
        commits,
        language: r.language ?? "",
        updatedAt: r.updated_at,
        pushedAt: r.updated_at,
        isFork: r.fork ?? false,
        archived: false,
        defaultBranch: "",
      };
    }),
  );
  return repos;
}

/** Gitee commits 接口响应头的 total_count 即提交总数 */
async function fetchGiteeCommitCount(fullName: string, token?: string): Promise<number | null> {
  const u = new URL(`https://gitee.com/api/v5/repos/${fullName}/commits`);
  u.searchParams.set("per_page", "1");
  if (token) u.searchParams.set("access_token", token);
  const resp = await fetch(u.toString(), { headers: { "user-agent": "nec-hub" } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const raw = resp.headers.get("total_count");
  if (raw == null) return null;
  const total = Number(raw);
  return Number.isFinite(total) ? total : null;
}

/** Cron 预热：刷新开源仓库缓存 */
export async function prewarmRepos(env: Env): Promise<void> {
  try {
    const repos = await fetchAllRepos(env);
    await env.REGISTRY.put(KV_KEYS.reposCache, JSON.stringify({ data: repos, cachedAt: Date.now() }));
  } catch (err) {
    console.error("[nec-hub] prewarm repos failed:", err);
  }
}
