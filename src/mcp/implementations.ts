/**
 * MCP 工具实现：应用广场 / Skill 中心 / 看板查询与配置 / 资料页 / FE-04 赛季目标回写
 *
 * config_drawing_review / config_hardware_review / config_contract_approval 三个模块配置工具
 * 已收敛到 ./module-config-tools 的工厂；FE-05 校验工具在 ../validation/handlers。
 */

import { validateUserToken } from "../auth/feishu-auth";
import { canSeeFinanceDetail, resolveUserRole } from "../auth/role";
import {
  DASH_TABLES,
  DOCS_REGISTRY_KEY,
  getDashboardConfig,
  type DashTable,
  type DashboardConfig,
  type DocEntry,
} from "../dashboard";
import {
  fieldNum,
  fieldText,
  findFieldKey,
  getTenantAccessToken,
  listBitableFields,
  listBitableRecords,
  matchField,
  updateBitableRecord,
} from "../feishu/bitable";
import { readIndex, upsertIndex, type AppEntry, type SkillEntry } from "../hosting";

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function toolDeployApp(args: Record<string, unknown>, env: Env, request: Request) {
  const appName = String(args.name ?? "");
  if (!NAME_RE.test(appName)) {
    throw new Error("应用名不合法：仅允许小写字母/数字/连字符（2-41 字符），如 inventory-check");
  }
  const files = (args.files ?? []) as Array<{ path?: string; text?: string; base64?: string }>;
  if (!Array.isArray(files) || files.length === 0) throw new Error("files 不能为空");
  if (files.length > 100) throw new Error("单次最多上传 100 个文件");
  if (!files.some((f) => f.path === "index.html")) {
    throw new Error("必须包含入口文件 index.html");
  }
  for (const f of files) {
    const p = String(f.path ?? "");
    if (!p || p.includes("..") || p.startsWith("/")) throw new Error(`非法文件路径：${p}`);
    let body: string | Uint8Array;
    if (typeof f.text === "string") body = f.text;
    else if (typeof f.base64 === "string") body = base64ToBytes(f.base64);
    else throw new Error(`文件 ${p} 缺少 text 或 base64 内容`);
    await env.APPS_BUCKET.put(`apps/${appName}/${p}`, body);
  }
  const origin = new URL(request.url).origin;
  // 让边缘缓存里的旧版本立即失效（含目录入口与每个文件）
  await Promise.all([
    caches.default.delete(new Request(`${origin}/apps/${appName}/`, { method: "GET" })),
    ...files.map((f) =>
      caches.default.delete(new Request(`${origin}/apps/${appName}/${String(f.path)}`, { method: "GET" })),
    ),
  ]);
  const entry: AppEntry = {
    name: appName,
    title: String(args.title ?? appName),
    author: String(args.author ?? "未知"),
    visibility: String(args.visibility ?? "all"),
    version: String(args.version ?? "0.1.0"),
    updatedAt: new Date().toISOString(),
    url: `${origin}/apps/${appName}/`,
  };
  const list = await upsertIndex(env, "apps:index", entry);
  return {
    content: [
      {
        type: "text",
        text: `✅ 应用已上架：${entry.title}\n访问链接：${entry.url}\n共上传 ${files.length} 个文件，应用广场现有 ${list.length} 个应用。`,
      },
    ],
  };
}

export async function toolRegisterApp(args: Record<string, unknown>, env: Env) {
  const appName = String(args.name ?? "");
  if (!NAME_RE.test(appName)) {
    throw new Error("应用名不合法：仅允许小写字母/数字/连字符（2-41 字符），如 mes-warehouse");
  }
  const url = String(args.url ?? "");
  if (!/^https?:\/\/.+/.test(url)) throw new Error("url 必须是 http(s) 完整链接");
  const entry: AppEntry = {
    name: appName,
    title: String(args.title ?? appName),
    author: String(args.author ?? "未知"),
    visibility: String(args.visibility ?? "all"),
    version: String(args.version ?? "1.0.0"),
    updatedAt: new Date().toISOString(),
    url,
    external: true,
  };
  const list = await upsertIndex(env, "apps:index", entry);
  return {
    content: [
      {
        type: "text",
        text: `✅ 外部应用已登记：${entry.title}\n访问链接：${entry.url}\n应用广场现有 ${list.length} 个应用。`,
      },
    ],
  };
}

/** sync_vercel 默认排除：临时/备份项目（可用 exclude 参数追加） */
const VERCEL_DEFAULT_EXCLUDE = ["dist", "newenergycoder.club-satble", "solarglyph"];
const VERCEL_DEFAULT_EXCLUDE_PREFIX = ["trae_"];

export async function toolSyncVercel(args: Record<string, unknown>, env: Env) {
  if (!env.VERCEL_TOKEN) {
    return {
      content: [
        { type: "text", text: "⚠️ 未配置 VERCEL_TOKEN。请运行 wrangler secret put VERCEL_TOKEN 后重试。" },
      ],
    };
  }
  const team = String(args.team ?? env.VERCEL_TEAM ?? "necc");
  const confirm = args.confirm === true;
  const extraExclude = Array.isArray(args.exclude) ? args.exclude.map(String) : [];
  const excluded = new Set([...VERCEL_DEFAULT_EXCLUDE, ...extraExclude]);

  const headers = { authorization: `Bearer ${env.VERCEL_TOKEN}` };
  const listResp = await fetch(`https://api.vercel.com/v9/projects?slug=${encodeURIComponent(team)}&limit=100`, { headers });
  const listData = (await listResp.json()) as { projects?: Array<{ name?: string }>; error?: { message?: string } };
  if (!listResp.ok || !listData.projects) {
    throw new Error(`Vercel API 错误：${listData.error?.message ?? listResp.status}`);
  }

  const registry = await readIndex<AppEntry>(env, "apps:index");
  const existingHosts = new Set(
    registry.map((a) => { try { return new URL(a.url).host; } catch { return ""; } }),
  );
  const existingNames = new Set(registry.map((a) => a.name));

  const plan: Array<{ name: string; url: string; action: string }> = [];
  for (const p of listData.projects) {
    const name = p.name ?? "";
    if (!name) continue;
    if (excluded.has(name) || VERCEL_DEFAULT_EXCLUDE_PREFIX.some((pre) => name.startsWith(pre))) {
      plan.push({ name, url: "-", action: "skip: 排除名单" });
      continue;
    }
    if (existingNames.has(name)) {
      plan.push({ name, url: "-", action: "skip: 已在广场" });
      continue;
    }
    // 取项目生产域名：targets.production.alias，优先非 vercel.app 的自定义域名
    let url = `https://${name}.vercel.app`;
    try {
      const dResp = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(name)}?slug=${encodeURIComponent(team)}`, { headers });
      const detail = (await dResp.json()) as { targets?: { production?: { alias?: string[] } } };
      const domains = detail.targets?.production?.alias ?? [];
      const custom = domains.find((d) => !d.endsWith(".vercel.app"));
      if (custom) url = `https://${custom}`;
      else if (domains.length > 0) url = `https://${domains[0]}`;
    } catch { /* 详情失败则用默认 vercel.app 域名 */ }

    const host = new URL(url).host;
    if (existingHosts.has(host)) {
      plan.push({ name, url, action: "skip: 同域名已收录" });
      continue;
    }
    plan.push({ name, url, action: confirm ? "registered" : "would register" });
    if (confirm) {
      await upsertIndex(env, "apps:index", {
        name,
        title: name,
        author: "Vercel 同步",
        visibility: "all",
        version: "1.0.0",
        updatedAt: new Date().toISOString(),
        url,
        external: true,
      });
    }
  }

  const lines = plan.map((p) => `- ${p.action === "registered" || p.action === "would register" ? "➕" : "⏭️"} ${p.name} → ${p.url}（${p.action}）`);
  const newCount = plan.filter((p) => p.action === "registered" || p.action === "would register").length;
  return {
    content: [
      {
        type: "text",
        text: `${confirm ? "✅ 已同步" : "🔍 预览（confirm=true 才会写入）"}：Vercel 团队 ${team} 共 ${listData.projects.length} 个项目，新增 ${newCount} 个\n\n${lines.join("\n")}`,
      },
    ],
  };
}

export async function toolImportSkills(args: Record<string, unknown>, env: Env) {
  const skills = (args.skills ?? []) as Array<{ name?: string; description?: string; url?: string }>;
  if (!Array.isArray(skills) || skills.length === 0) throw new Error("skills 不能为空");
  if (skills.length > 200) throw new Error("单次最多导入 200 个");
  const source = String(args.source ?? "external");
  const list = await readIndex<SkillEntry>(env, "skills:index");
  const byName = new Map(list.map((s) => [s.name, s]));
  let added = 0, updated = 0, skipped = 0;
  for (const s of skills) {
    const name = String(s.name ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!NAME_RE.test(name)) { skipped++; continue; }
    const existing = byName.get(name);
    if (existing && existing.source === "hub") { skipped++; continue; } // 不覆盖中台自托管的 Skill
    const entry: SkillEntry = {
      name,
      description: String(s.description ?? existing?.description ?? ""),
      url: s.url ? String(s.url) : existing?.url,
      source,
      updatedAt: new Date().toISOString(),
    };
    if (existing) { byName.set(name, entry); updated++; }
    else { byName.set(name, entry); added++; }
  }
  await env.REGISTRY.put("skills:index", JSON.stringify([...byName.values()]));
  return {
    content: [
      {
        type: "text",
        text: `✅ 批量导入完成（来源：${source}）：新增 ${added}，更新 ${updated}，跳过 ${skipped}。Skill 中心现有 ${byName.size} 个。`,
      },
    ],
  };
}

export async function toolRemoveSkills(args: Record<string, unknown>, env: Env) {
  const names = new Set(((args.names ?? []) as unknown[]).map((n) => String(n)));
  if (names.size === 0) throw new Error("names 不能为空");
  const list = await readIndex<SkillEntry>(env, "skills:index");
  const kept: SkillEntry[] = [];
  let removed = 0;
  const protectedNames: string[] = [];
  for (const s of list) {
    if (names.has(s.name)) {
      if (s.source === "hub" || (!s.source && !s.url)) { protectedNames.push(s.name); kept.push(s); }
      else removed++;
    } else kept.push(s);
  }
  await env.REGISTRY.put("skills:index", JSON.stringify(kept));
  return {
    content: [
      {
        type: "text",
        text: `✅ 已下架 ${removed} 个 Skill，Skill 中心剩余 ${kept.length} 个。` +
          (protectedNames.length ? `（${protectedNames.join("、")} 为中台自托管，受保护未删除）` : ""),
      },
    ],
  };
}

export async function toolPublishSkill(args: Record<string, unknown>, env: Env, request: Request) {
  const skillName = String(args.name ?? "");
  if (!NAME_RE.test(skillName)) throw new Error("Skill 名不合法：小写字母/数字/连字符");
  const content = String(args.content ?? "");
  if (!content.includes("---")) throw new Error("content 看起来不是合法的 SKILL.md（缺少 frontmatter）");
  await env.APPS_BUCKET.put(`skills/${skillName}/SKILL.md`, content);
  // 让边缘缓存里的旧版本立即失效
  const origin = new URL(request.url).origin;
  await caches.default.delete(new Request(`${origin}/skills/${skillName}/SKILL.md`, { method: "GET" }));
  const entry: SkillEntry = {
    name: skillName,
    description: String(args.description ?? ""),
    source: "hub", // 标记为中台自托管，import_skills 同步外部来源时不覆盖
    updatedAt: new Date().toISOString(),
  };
  const list = await upsertIndex(env, "skills:index", entry);
  return {
    content: [
      {
        type: "text",
        text: `✅ Skill 已上架：${skillName}\nSkill 中心现有 ${list.length} 个 Skill。`,
      },
    ],
  };
}

export async function toolQueryBitable(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  const table = String(args.table ?? "") as DashTable;
  if (!DASH_TABLES.includes(table)) {
    throw new Error("table 必须是 members | tasks | inventory | finance | goals 之一");
  }
  // finance 表按角色受限：管理端（持 MCP_TOKEN）或持有效 user_token 且角色为队长/财务
  if (table === "finance" && !hasMcpToken) {
    const userToken = String(args.user_token ?? "").trim();
    if (!userToken) {
      throw new Error("finance 表受限：请提供 user_token（飞书 user_access_token，角色需为队长/财务），或由配置了 MCP_TOKEN 的管理端调用");
    }
    const { openId } = await validateUserToken(userToken);
    const role = await resolveUserRole(env, { name: "", open_id: openId });
    if (!canSeeFinanceDetail(role)) {
      throw new Error(`权限不足：finance 表仅队长/财务角色可查（当前角色：${role.role}）`);
    }
  }
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    return {
      content: [
        {
          type: "text",
          text: "⚠️ 飞书自建应用尚未配置（FEISHU_APP_ID / FEISHU_APP_SECRET）。请按 docs/飞书免登接入_MES.md 创建企业自建应用并 wrangler secret put 配置后重试。",
        },
      ],
    };
  }
  const cfg = await getDashboardConfig(env);
  const appToken = String(args.app_token ?? cfg?.base ?? "");
  const tableId = String(args.table_id ?? cfg?.tables?.[table] ?? "");
  if (!appToken || !tableId) {
    return {
      content: [
        {
          type: "text",
          text: `⚠️ 尚未配置 ${table} 表。两种方式任选：\n1. 调用 config_dashboard（action=set）写入 base 与 tables.${table}；\n2. 本次调用显式传 app_token + table_id。`,
        },
      ],
    };
  }
  const token = await getTenantAccessToken(env);
  const records = await listBitableRecords(token, appToken, tableId);
  const filter = String(args.filter ?? "").trim().toLowerCase();
  const matched = filter
    ? records.filter((r) => JSON.stringify(r.fields).toLowerCase().includes(filter))
    : records;
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
  return {
    content: [
      {
        type: "text",
        text:
          `表 ${table} 共 ${matched.length} 条匹配记录（展示前 ${Math.min(limit, matched.length)} 条）：\n` +
          JSON.stringify(matched.slice(0, limit).map((r) => r.fields), null, 2),
      },
    ],
  };
}

export async function toolConfigDashboard(args: Record<string, unknown>, env: Env) {
  const action = String(args.action ?? "get");
  if (action === "get") {
    const cfg = await getDashboardConfig(env);
    return {
      content: [
        {
          type: "text",
          text: cfg
            ? `当前看板配置：\n${JSON.stringify(cfg, null, 2)}`
            : "尚未配置。用 action=set 写入：base = 多维表格 app_token（URL 中 /base/ 后的一段），tables = 逻辑表名到 table_id 的映射。",
        },
      ],
    };
  }
  if (action !== "set") throw new Error("action 必须是 get | set");

  const base = String(args.base ?? "").trim();
  if (!/^[A-Za-z0-9]{10,}$/.test(base)) {
    throw new Error("base 不合法：应为飞书多维表格 URL 中 /base/ 后的 app_token（10 位以上字母数字串）");
  }
  const rawTables = (args.tables ?? {}) as Record<string, unknown>;
  const tables: DashboardConfig["tables"] = {};
  for (const key of DASH_TABLES) {
    const v = String(rawTables[key] ?? "").trim();
    if (v) {
      if (!/^tbl[A-Za-z0-9]+$/.test(v)) {
        throw new Error(`table_id 不合法（${key}）：应以 tbl 开头，如 tblsH8aOxxx`);
      }
      tables[key] = v;
    }
  }
  if (Object.keys(tables).length === 0) {
    throw new Error("tables 至少提供一张表：members / tasks / inventory / finance / goals → table_id");
  }
  const cfg: DashboardConfig = { base, tables, updatedAt: new Date().toISOString() };
  await env.REGISTRY.put("dashboard:config", JSON.stringify(cfg));
  // 配置变更后清掉旧缓存，让下一次读取拉最新数据
  await Promise.all(DASH_TABLES.map((k) => env.REGISTRY.delete(`dashboard:cache:${k}`)));
  return {
    content: [
      {
        type: "text",
        text: `✅ 数据看板配置已保存：base=${base}，共 ${Object.keys(tables).length} 张表（${Object.keys(tables).join(" / ")}）。\n打开门户「数据看板」Tab 或 GET /api/dashboard 验证渲染。`,
      },
    ],
  };
}

// ---------- 资料页（publish_doc） ----------

export async function toolPublishDoc(args: Record<string, unknown>, env: Env) {
  const id = String(args.id ?? "").trim();
  if (!NAME_RE.test(id)) {
    throw new Error("资料 id 不合法：仅允许小写字母/数字/连字符（2-41 字符），如 nec-vi、reimburse-sop");
  }
  const title = String(args.title ?? "").trim();
  const description = String(args.description ?? "").trim();
  const category = String(args.category ?? "").trim();
  const url = String(args.url ?? "").trim();
  const visibility = String(args.visibility ?? "all").trim();
  const maintainer = String(args.maintainer ?? "").trim();

  if (!title) throw new Error("title 不能为空");
  if (!["brand", "template", "sop", "training"].includes(category)) {
    throw new Error("category 必须是 brand / template / sop / training");
  }
  if (!url) throw new Error("url 不能为空");

  const entry: DocEntry = {
    id,
    title,
    description,
    category: category as DocEntry["category"],
    url,
    visibility,
    maintainer,
    updatedAt: new Date().toISOString(),
    source: "hub",
  };

  const list = await readIndex<DocEntry>(env, DOCS_REGISTRY_KEY);
  const idx = list.findIndex((d) => d.id === id);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  await env.REGISTRY.put(DOCS_REGISTRY_KEY, JSON.stringify(list));

  return {
    content: [
      {
        type: "text",
        text: `✅ 资料已${idx >= 0 ? "更新" : "发布"}：${title}（${category}）\nid=${id} · 维护人=${maintainer || "未填"}\n打开 ${url} 或刷新门户「资料页」查看。`,
      },
    ],
  };
}

// ---------- FE-04 赛季目标：update_progress 回写 ----------

export async function toolUpdateProgress(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) {
    const userToken = String(args.user_token ?? "").trim();
    if (!userToken) {
      throw new Error("update_progress 需要鉴权：请提供 user_token（飞书 user_access_token），或由配置了 MCP_TOKEN 的管理端调用");
    }
    await validateUserToken(userToken);
  }
  let recordId = String(args.record_id ?? "").trim();
  const goalKw = String(args.goal ?? "").trim();
  if (!recordId && !goalKw) {
    throw new Error("record_id 与 goal 至少填一个（goal 支持目标名称/记录关键词模糊匹配）");
  }
  const hasProgress = args.progress !== undefined && args.progress !== null && args.progress !== "";
  const status = String(args.status ?? "").trim();
  const note = String(args.note ?? "").trim();
  if (!hasProgress && !status && !note) throw new Error("progress / status / note 至少填一个");
  let progress: number | null = null;
  if (hasProgress) {
    progress = Number(args.progress);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error("progress 必须是 0-100 的数字");
  }
  const cfg = await getDashboardConfig(env);
  const tableId = cfg?.tables.goals;
  if (!cfg || !tableId) {
    throw new Error("赛季目标表未配置：请先调用 config_dashboard（action=set）写入 tables.goals");
  }
  const token = await getTenantAccessToken(env);

  // goal 关键词定位记录：整条记录 JSON 不区分大小写包含匹配，或 record_id 精确命中；
  // 唯一匹配才写，多匹配返回候选列表让调用方用 record_id 精确指定
  if (!recordId) {
    const records = await listBitableRecords(token, cfg.base, tableId);
    const kw = goalKw.toLowerCase();
    const matched = records.filter(
      (r) => r.record_id === goalKw || JSON.stringify(r.fields).toLowerCase().includes(kw),
    );
    if (matched.length === 0) {
      throw new Error(`赛季目标表未找到匹配「${goalKw}」的记录（可用 query_bitable table=goals 核对目标名称）`);
    }
    if (matched.length > 1) {
      const titleKey = findFieldKey(matched, [/^目标/, /目标/, /title/i]);
      const progressKey = findFieldKey(matched, [/完成度/, /进度/, /progress/i]);
      const lines = matched.map((r) => {
        const title = (titleKey ? fieldText(r.fields[titleKey]) : "") || JSON.stringify(r.fields).slice(0, 60);
        const p = progressKey ? fieldNum(r.fields[progressKey]) : null;
        return `- record_id=${r.record_id} · ${title}${p !== null ? `（当前完成度 ${p}%）` : ""}`;
      });
      return {
        content: [
          {
            type: "text",
            text: `⚠️ 关键词「${goalKw}」匹配到 ${matched.length} 条赛季目标，未写入。请用 record_id 精确指定后重试：\n${lines.join("\n")}`,
          },
        ],
      };
    }
    recordId = matched[0].record_id;
  }

  const metas = await listBitableFields(token, cfg.base, tableId);
  const record: Record<string, unknown> = {};
  if (progress !== null) {
    const f =
      matchField(metas, [/完成度/, /进度/, /progress/i], /Number|Progress|Percent/i) ??
      matchField(metas, [/完成度/, /进度/, /progress/i]);
    if (!f) throw new Error("赛季目标表未匹配到「完成度」字段");
    // 飞书「进度」字段取值 0-1，普通数字字段按 0-100 写入
    record[f.field_name] = /Progress/i.test(f.ui_type) && progress > 1 ? progress / 100 : progress;
  }
  if (status) {
    const f = matchField(metas, [/^状态/, /状态/, /status/i]);
    if (!f) throw new Error("赛季目标表未匹配到「状态」字段");
    record[f.field_name] = status;
  }
  let noteSkipped = false;
  if (note) {
    const f = matchField(metas, [/备注/, /进展/, /说明/, /note/i, /remark/i], /Text/i);
    if (f) record[f.field_name] = note;
    else noteSkipped = true;
  }
  const updated = await updateBitableRecord(token, cfg.base, tableId, recordId, record);
  // 回写后清看板缓存，门户面板下一次请求即拉最新数据（≤1 分钟）
  await env.REGISTRY.delete("dashboard:cache:goals");
  const parts = [
    progress !== null ? `完成度=${progress}%` : "",
    status ? `状态=${status}` : "",
    note ? (noteSkipped ? "备注未写入（表内无备注/进展类文本字段）" : "备注已写入") : "",
  ].filter(Boolean);
  return {
    content: [
      {
        type: "text",
        text:
          `✅ 赛季目标已回写（record_id=${recordId}）：${parts.join("，")}。\n` +
          `updated=${JSON.stringify({ record_id: updated.record_id, fields: updated.fields })}\n` +
          `看板缓存已清，门户「数据看板 → 赛季目标」1 分钟内刷新。`,
      },
    ],
  };
}
