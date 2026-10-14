// FE-06/07 我的首页：白名单组件渲染引擎 + 团队动态窄条（自 index.html 内嵌脚本抽出）
import { esc } from "../shared/api.js";
import { ME } from "../shared/session.js";
import { dashStatusColor, fmtDashDate, goalBarColor } from "./dashboard.js";

// ===== FE-06/07 我的首页：白名单组件渲染引擎（布局来自 GET /api/home；未登录用内置默认布局） =====
const HOME_WIDGET_DEFS = {
  "my-apps": { title: "我的应用快捷区" },
  "my-tasks": { title: "我的任务" },
  "my-reimburse": { title: "我的报销状态" },
  "docs": { title: "常用资料" },
  "goals": { title: "赛季目标" },
  "inventory": { title: "物资查询" },
};
/** 与后端 DEFAULT_HOME_LAYOUT 保持一致（未登录访客与 /api/home 失败时的兜底） */
const HOME_DEFAULT_WIDGETS = ["my-tasks", "goals", "my-apps", "docs"];
const HOME_SOURCE_LABEL = { personal: "个人定制", group: "组默认", default: "全员默认" };
/** 当前生效布局（悬停「移除」按钮写个人布局时用） */
let HOME_CURRENT = [];

/** 赛季目标未配置时的空态引导 Prompt（与数据看板未配置引导同一模式） */
const GOALS_CONFIG_PROMPT = `请帮我配置 NEC 中台的赛季目标表（飞书多维表格）：
1. 打开飞书多维表格，从浏览器地址栏复制 app_token 与赛季目标表的 table_id：
   URL 形如 https://xxx.feishu.cn/base/<app_token>?table=<table_id>&view=...
2. 调用 NEC-MCP 的 config_dashboard（action=set），传入 base 与 tables.goals = 赛季目标表的 table_id
3. 配置完成后刷新门户「我的首页」确认赛季目标渲染`;

document.getElementById("home-prompt").textContent =
`请按我的要求调整 NEC 中台「我的首页」布局：
1. 用 lark-cli 拿我的飞书 user_access_token（user 身份）
2. 调用 NEC-MCP 的 set_home_layout 工具：
   - action=set，scope=user（绑定我本人；user_token 必填）
   - widgets 为白名单组件 id 数组，顺序即首页渲染顺序
   - 白名单组件：my-apps 我的应用快捷区 / my-tasks 我的任务 / my-reimburse 我的报销状态 / docs 常用资料 / goals 赛季目标 / inventory 物资查询
   - 例如我说「把物资查询放到最上面，加我的未完成任务」→ widgets: ["inventory", "my-tasks", ...其余保留项]
3. 可先 action=get 查看我当前布局再增量调整；我说「恢复默认」时用 action=reset
4. 完成后告诉我刷新门户「我的首页」Tab 查看效果`;

function toggleHomePrompt() {
  document.getElementById("home-prompt-box").classList.toggle("hidden");
}

async function loadHome() {
  const box = document.getElementById("home-widgets");
  if (!box) return;
  let widgets = HOME_DEFAULT_WIDGETS.map(id => ({ id }));
  let source = "default", group = "";
  if (ME.authenticated) {
    try {
      const resp = await fetch("/api/home");
      if (resp.ok) {
        const d = await resp.json();
        const list = (d.layout?.widgets ?? []).filter(w => HOME_WIDGET_DEFS[w.id]);
        if (list.length) widgets = list;
        source = d.source || "default";
        group = d.group || "";
      }
    } catch { /* 布局读取失败按默认渲染 */ }
  }
  const srcEl = document.getElementById("home-source");
  if (srcEl) {
    delete srcEl.dataset.fresh;
    srcEl.textContent = `（${HOME_SOURCE_LABEL[source] || source}${source === "group" && group ? " · " + group : ""}）`;
  }
  document.getElementById("home-reset-btn").classList.toggle("hidden", !ME.authenticated);
  HOME_CURRENT = widgets;
  renderHomeWidgets(box, widgets);
}

async function resetHome() {
  if (!confirm("恢复默认首页？你的个人布局将被删除（回落到组默认/全员默认）。")) return;
  try {
    const resp = await fetch("/api/home/reset", { method: "POST" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    await loadHome();
  } catch (e) {
    alert("恢复默认失败：" + (e.message || e));
  }
}

function renderHomeWidgets(box, widgets) {
  // 同一次渲染内共享数据请求，避免多组件重复拉同一接口
  const shared = {
    _p: {},
    load(name) {
      if (!this._p[name]) this._p[name] = fetch("/api/" + name).then(r => r.ok ? r.json() : null).catch(() => null);
      return this._p[name];
    },
  };
  box.innerHTML = widgets.map((w, i) => {
    const def = HOME_WIDGET_DEFS[w.id];
    return def ? `
      <div class="bg-white rounded-xl shadow p-5 group relative">
        ${ME.authenticated ? `<button onclick="removeHomeWidget(${i})" title="从我的首页移除该组件（写入个人布局）" class="absolute top-3 right-3 hidden group-hover:block text-xs text-gray-300 hover:text-red-500">✕ 移除</button>` : ""}
        <h3 class="font-bold mb-3">${esc(w.title || def.title)}</h3>
        <div id="home-w-${i}" class="text-sm text-gray-400">加载中…</div>
      </div>` : "";
  }).join("");
  widgets.forEach((w, i) => {
    const slot = document.getElementById(`home-w-${i}`);
    const fn = HOME_RENDERERS[w.id];
    if (slot && fn) fn(slot, shared).catch(() => { slot.innerHTML = `<p class="text-sm text-gray-400">加载失败，请刷新重试。</p>`; });
  });
}

/** 悬停「移除」：从当前布局去掉该组件并写入个人布局（POST /api/home） */
async function removeHomeWidget(i) {
  const w = HOME_CURRENT[i];
  if (!w) return;
  const rest = HOME_CURRENT.filter((_, j) => j !== i);
  if (!rest.length) { alert("至少保留一个组件。"); return; }
  try {
    const resp = await fetch("/api/home", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ widgets: rest.map(x => ({ id: x.id })) }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error) throw new Error(data.error || ("HTTP " + resp.status));
    await loadHome();
  } catch (e) {
    alert("移除失败：" + (e.message || e));
  }
}

/** 副标题补充数据新鲜度：「全员默认 · 任务同步于 x 分钟前」（dashboard 各表带 cachedAt） */
function noteHomeFreshness(d) {
  const srcEl = document.getElementById("home-source");
  const at = d?.tasks?.cachedAt;
  if (!srcEl || !at || srcEl.dataset.fresh) return;
  const t = new Date(at).getTime();
  if (!isFinite(t)) return;
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  srcEl.dataset.fresh = "1";
  srcEl.textContent = srcEl.textContent.replace(/）$/, ` · 任务同步于 ${mins < 1 ? "刚刚" : mins + " 分钟前"}）`);
}

/** 团队动态窄条：最近 git 提交（来自 GitHub webhook 落 KV，GET /api/prd 的 recentCommits） */
async function loadHomeActivity() {
  const box = document.getElementById("home-activity");
  if (!box) return;
  try {
    const resp = await fetch("/api/prd");
    if (!resp.ok) return;
    const board = await resp.json();
    const commits = (Array.isArray(board.recentCommits) && board.recentCommits.length
      ? board.recentCommits
      : board.lastCommit ? [board.lastCommit] : []).slice(0, 3);
    if (!commits.length) { box.innerHTML = ""; return; }
    const fmtAt = (v) => {
      const t = new Date(v);
      return isNaN(t.getTime()) ? "" : t.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    };
    box.innerHTML = `
      <div class="bg-white rounded-xl shadow px-4 py-3">
        <div class="flex items-center gap-2 text-xs mb-1">
          <span class="font-bold" style="color:var(--nec-navy)">团队动态</span>
          <span class="text-gray-400">· 最近 git 提交</span>
          <button onclick="switchTab('prd')" class="ml-auto hover:underline" style="color:var(--nec-cyan)">PRD 看板 →</button>
        </div>
        <ul class="divide-y divide-gray-50">${commits.map(c => `
          <li class="py-1.5 flex items-baseline gap-2 text-sm">
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 mono shrink-0">${esc(c.branch || "main")}</span>
            ${c.url
              ? `<a href="${esc(c.url)}" target="_blank" class="flex-1 min-w-0 truncate hover:underline" style="color:var(--nec-ink)">${esc(c.message || "")}</a>`
              : `<span class="flex-1 min-w-0 truncate">${esc(c.message || "")}</span>`}
            <span class="text-xs text-gray-400 shrink-0">${esc(c.author || "")}${c.at ? " · " + fmtAt(c.at) : ""}</span>
          </li>`).join("")}</ul>
      </div>`;
  } catch { /* 动态条加载失败不阻塞首页 */ }
}

/** 名字字段按多人分隔符拆分后精确比对（与后端 splitNames 同口径） */
function nameHits(raw, name) {
  if (!raw || !name) return false;
  return String(raw).split(/[、,，;；\/\s]+/).map(s => s.trim()).includes(name);
}

const HOME_RENDERERS = {
  "my-apps": async (slot, shared) => {
    const apps = (await shared.load("apps")) || [];
    if (!apps.length) { slot.innerHTML = `<p class="text-sm text-gray-400">还没有应用上架，去「应用广场」发布第一个。</p>`; return; }
    // 类型角标：本中台托管=应用 / external+Vercel=网站 / 其他外链=外链；按类型分组排序
    const APP_KIND_STYLE = {
      app:  { label: "应用", style: "background:#EAF7FD;color:#1FA9E8" },
      site: { label: "网站", style: "background:#FFFBEB;color:#D97706" },
      ext:  { label: "外链", style: "background:#F3F4F6;color:#6B7280" },
    };
    const kindOf = (a) => {
      if (!a.external) return "app";
      try { if (new URL(a.url).hostname.endsWith("vercel.app")) return "site"; } catch { /* url 异常按外链 */ }
      return "ext";
    };
    const KIND_ORDER = { app: 0, site: 1, ext: 2 };
    const sorted = apps.slice().sort((x, y) => KIND_ORDER[kindOf(x)] - KIND_ORDER[kindOf(y)]).slice(0, 6);
    slot.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">` + sorted.map(a => {
      const k = APP_KIND_STYLE[kindOf(a)];
      // 命名规范：标题里的「中文名 // 英文名」拆成主标题 + 副标题两行
      const parts = String(a.title || "").split(/\s*\/\/\s*/);
      return `
      <a href="${esc(a.url)}" target="_blank" class="relative block border border-gray-100 rounded-lg p-3 hover:shadow-md transition">
        <span class="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded" style="${k.style}">${k.label}</span>
        <p class="font-bold text-slate-800 text-sm truncate pr-8">${esc(parts[0])}</p>
        ${parts[1] ? `<p class="text-[10px] mono text-gray-400 truncate">${esc(parts.slice(1).join(" // "))}</p>` : ""}
        <p class="text-xs text-gray-400 mt-0.5">${esc(a.name)} · ${esc(a.author)}</p>
      </a>`;
    }).join("") + `</div>`;
  },
  "my-tasks": async (slot, shared) => {
    const d = await shared.load("dashboard");
    noteHomeFreshness(d);
    const all = d?.tasks?.upcoming ?? [];
    const myName = ME.authenticated ? ME.user?.name : "";
    const list = myName ? all.filter(t => nameHits(t.owner, myName)) : all;
    if (!list.length) {
      slot.innerHTML = `<p class="text-sm text-gray-400">${myName ? "暂无与你相关的未完成任务 🎉" : "登录后只看你的任务"}</p>`
        + (myName ? `<p class="text-xs text-gray-400 mt-1.5">去「我的任务」Tab 查看全部；在飞书任务中把自己加为负责人，任务就会出现在这里。</p>` : "");
      return;
    }
    slot.innerHTML = `<ul class="divide-y divide-gray-100">` + list.slice(0, 8).map(t => `
      <li class="py-1.5 flex items-baseline gap-2 flex-wrap">
        <span class="flex-1 min-w-0 truncate">${esc(t.title || "—")}</span>
        <span class="text-xs px-1.5 py-0.5 rounded text-white shrink-0" style="background:${dashStatusColor(t.status)}">${esc(t.status || "未标注")}</span>
        <span class="text-xs text-gray-400 mono shrink-0">${fmtDashDate(t.deadline)}</span>
      </li>`).join("") + `</ul>`
      + (myName ? "" : `<p class="text-xs text-gray-400 mt-2">当前为全队视角，登录后只看你的任务</p>`);
  },
  "my-reimburse": async (slot, shared) => {
    const d = await shared.load("dashboard");
    const fin = d?.finance;
    if (!fin || fin.visibility === "hidden") {
      slot.innerHTML = `<p class="text-sm text-gray-400">登录后可见报销汇总；明细仅队长/财务角色可见。</p>`;
      return;
    }
    const mine = (fin.recent ?? []).filter(f => ME.user?.name && f.applicant === ME.user.name);
    slot.innerHTML = `
      <p class="text-sm text-gray-600">全队报销 ${fin.records ?? 0} 笔 · 合计 <b style="color:var(--nec-navy)">¥${fin.totalAmount ?? "—"}</b></p>
      ${fin.recent
        ? (mine.length
          ? `<ul class="divide-y divide-gray-100 mt-2">` + mine.slice(0, 6).map(f => `
              <li class="py-1.5 flex items-baseline gap-2">
                <span class="text-xs text-gray-400 mono shrink-0">${fmtDashDate(f.date)}</span>
                <span class="flex-1 min-w-0 truncate">${esc(f.name)}</span>
                <span class="text-xs mono shrink-0">¥${f.amount ?? "—"}</span>
              </li>`).join("") + `</ul>`
          : `<p class="text-xs text-gray-400 mt-2">最近报销里没有你的记录</p>`)
        : `<p class="text-xs text-gray-400 mt-2">报销明细仅队长/财务角色可见</p>`}`;
  },
  "docs": async (slot, shared) => {
    const docs = (await shared.load("docs")) || [];
    if (!docs.length) { slot.innerHTML = `<p class="text-sm text-gray-400">资料页暂无条目。</p>`; return; }
    slot.innerHTML = `<ul class="divide-y divide-gray-100">` + docs.slice(0, 6).map(d => `
      <li class="py-1.5">
        ${d.url
          ? `<a href="${esc(d.url)}" target="_blank" class="hover:underline font-medium" style="color:var(--nec-navy)">${esc(d.title)}</a>`
          : `<span class="font-medium text-gray-400">${esc(d.title)}</span> <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-600">即将上线</span>`}
        <p class="text-xs text-gray-400 truncate">${esc(d.description || "")}</p>
      </li>`).join("") + `</ul>`;
  },
  "goals": async (slot, shared) => {
    const d = await shared.load("dashboard");
    noteHomeFreshness(d);
    const g = d?.goals;
    if (!g || !g.configured) {
      // 配置缺口不是用户的问题：给出可复制的接入 Prompt（与数据看板未配置引导同一模式）
      slot.innerHTML = `
        <p class="text-sm text-gray-500 mb-2">赛季目标未配置：把下面的 Prompt 发给已接入 NEC-MCP 的 Agent 完成接入。</p>
        <pre class="prompt text-xs bg-gray-900 text-green-300 rounded-lg p-3" id="home-goals-prompt">${esc(GOALS_CONFIG_PROMPT)}</pre>
        <button onclick="copyText('home-goals-prompt')" class="mt-2 text-xs text-white px-3 py-1.5 rounded" style="background:var(--nec-navy)">复制 Prompt</button>`;
      return;
    }
    const items = (g.items ?? []).slice(0, 5);
    if (!items.length) { slot.innerHTML = `<p class="text-sm text-gray-400">赛季目标表已配置但暂无数据：在飞书赛季目标表中添加第一条目标（含截止日期）后即可显示在这里。</p>`; return; }
    slot.innerHTML = items.map(it => `
      <a href="${esc(it.link)}" target="_blank" class="block py-1.5 border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-400 mono shrink-0">${fmtDashDate(it.deadline)}</span>
          <span class="flex-1 min-w-0 truncate">${esc(it.title)}</span>
          ${it.overdue ? `<span class="text-xs text-red-600 font-bold shrink-0">已逾期</span>` : ""}
          <span class="text-xs text-gray-500 mono shrink-0">${it.progress === null ? "—" : Math.round(it.progress) + "%"}</span>
        </div>
        <div class="h-1.5 rounded bg-gray-100 overflow-hidden mt-1">
          <div style="width:${(it.progress ?? 0).toFixed(0)}%;height:100%;background:${goalBarColor(it)}"></div>
        </div>
      </a>`).join("");
  },
  "inventory": async (slot, shared) => {
    const d = await shared.load("dashboard");
    const items = d?.inventory?.items ?? [];
    if (!items.length) { slot.innerHTML = `<p class="text-sm text-gray-400">暂无物资数据。</p>`; return; }
    const uid = "home-inv-q";
    slot.innerHTML = `
      <input id="${uid}" placeholder="🔍 输入关键字筛选物资…" class="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm mb-2"
             oninput="filterHomeInventory(this.value)">
      <div id="home-inv-list" class="max-h-64 overflow-y-auto"></div>`;
    window._homeInvItems = items;
    filterHomeInventory("");
  },
};

function filterHomeInventory(q) {
  const kw = (q || "").trim().toLowerCase(); // 关键字规范化一次，不在每项上重复 trim/toLowerCase
  const items = (window._homeInvItems || []).filter(it => !kw || it.name.toLowerCase().includes(kw));
  const box = document.getElementById("home-inv-list");
  if (!box) return;
  box.innerHTML = items.length
    ? items.slice(0, 30).map(it => `
      <div class="py-1.5 border-b border-gray-100 last:border-0 flex items-baseline gap-2 text-sm">
        <span class="flex-1 min-w-0 truncate">${esc(it.name)}</span>
        <span class="text-xs mono text-gray-500 shrink-0">× ${it.qty ?? "—"}</span>
        <span class="text-xs text-gray-400 shrink-0">${esc(it.location || "—")}</span>
      </div>`).join("")
    : `<p class="text-sm text-gray-400 py-2">没有匹配的物资。</p>`;
}

export { loadHome, loadHomeActivity };

// 内联事件处理器（HTML 及动态生成 markup 的 onclick/oninput）需要全局可见
Object.assign(window, { resetHome, toggleHomePrompt, removeHomeWidget, filterHomeInventory });
