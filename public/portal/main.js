// NEC 团队 AI 中台门户启动器：Tab 注册表 + 懒加载 + hash 路由 + 页面级杂项（自 index.html 内嵌 <script> 抽为原生 ES Module，无构建步骤）
import { ORIGIN, esc, injectScript, CDN_FASTLY, CDN_JSDELIVR } from "./shared/api.js";
import { ME, bootAuth } from "./shared/session.js";

document.getElementById("mcp-endpoint").textContent = ORIGIN + "/mcp";

document.getElementById("join-prompt").textContent =
`🚀 接入 NEC-MCP 智能协作中枢（v0.4.0）：

1. 安装 MCP 客户端（Claude Code / Kimi CLI / Codex）
2. 添加 NEC-MCP 服务器：
   • 地址：${ORIGIN}/mcp （streamable HTTP 协议）
   • 名称：NEC-MCP
   - Claude Code: claude mcp add --transport http NEC-MCP ${ORIGIN}/mcp
   - Kimi CLI / Codex: 在 MCP 配置中加入同一地址
3. 完成后调用 NEC-MCP 的 ping 工具验证连接，并告诉我结果

💡 提示：NEC-MCP 支持自然语言指令，可直接说"帮我部署一个应用"或"查询我的任务进度"`;

document.getElementById("publish-prompt").textContent =
`请把当前项目发布到 NEC 团队应用广场：
1. 收集本项目的静态文件（入口必须是 index.html，含引用的 CSS/JS/图片）
2. 调用 NEC-MCP 的 deploy_app 工具：
   - name 用小写连字符命名（如 inventory-check）
   - title 用中文展示名，author 填我的名字
3. 成功后把访问链接发给我`;

document.getElementById("doc-publish-prompt").textContent =
`请把这条资料发布/更新到 NEC 团队资料页：
1. 调用 NEC-MCP 的 publish_doc 工具
2. 参数：
   - id：小写连字符唯一标识，如 nec-vi、reimburse-sop
   - title：展示标题
   - description：一句话说明
   - category：brand（品牌规范）/ template（文档模板）/ sop（制度 SOP）/ training（培训材料）
   - url：链接（飞书文档、站内页面或本地下载）
   - visibility：all 或组名，默认 all
   - maintainer：维护人
3. 成功后告诉我已发布到资料页`;

// Tab 切换 + Hash 路由：/#/dashboard 等深链可直达对应面板，刷新/分享不丢位置（旧式 #tab-dashboard 自动升级）
const TAB_IDS = ["home","my-tasks","drawing-review","reimburse","task-schedule","season-goals","apps","skills","docs","repos","hardware-review","contract-approval","dashboard","prd","agent"];
// 目标 Tab 暂不可见（如未登录时的图纸评审）时暂存，登录门控放开后由 applyHashRoute 重放
// 跨模块可读写：ES Module 不允许给导入绑定赋值，故经 get/set 访问（session.js / drawing-review.js 使用）
let pendingHashTab = null;
export function getPendingHashTab() { return pendingHashTab; }
export function setPendingHashTab(v) { pendingHashTab = v; }

// 5 个重 Tab 拆为独立模块，切换时先加载再激活（home/dashboard 等因 bootAuth 的静态引用启动即已在模块表中，import 即时 resolve）
const TAB_LOADERS = {
  home: () => import("./tabs/home.js"),
  dashboard: () => import("./tabs/dashboard.js"),
  "drawing-review": () => import("./tabs/drawing-review.js"),
  "hardware-review": () => import("./tabs/hardware-review.js"),
  "contract-approval": () => import("./tabs/contract-approval.js"),
};
let switchSeq = 0; // 切换序号：连续快速切 Tab 时后到者胜，等待加载期间被超越的请求落地前丢弃
async function switchTab(tab, opts = {}) {
  const btn = document.querySelector('.tab-btn[data-tab="' + tab + '"]');
  const panel = document.getElementById("tab-" + tab);
  if (!btn || !panel) return false;
  // 目标在「更多」分组里时先展开，否则视为当前不可见（未登录门控：gate-off / 图纸评审）
  if (btn.classList.contains("hidden")) {
    if (btn.classList.contains("tab-more") && !btn.classList.contains("gate-off")) setMoreTabs(true);
    else return false;
  }
  const seq = ++switchSeq;
  if (TAB_LOADERS[tab]) {
    try { await TAB_LOADERS[tab](); } catch { return false; } // 加载失败/未就绪视为 false，由 pendingHashTab 机制接管
    if (seq !== switchSeq) return false;
  }
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("tab-active"));
  btn.classList.add("tab-active");
  const moreBtn = document.getElementById("nav-more-btn");
  if (moreBtn) moreBtn.classList.toggle("tab-active", btn.classList.contains("tab-more"));
  TAB_IDS.forEach(t => document.getElementById("tab-"+t).classList.toggle("hidden", t !== tab));
  // iframe 嵌入的独立应用：首次切换到该 Tab 才加载
  const lazyFrame = panel.querySelector("iframe[data-src]");
  if (lazyFrame && !lazyFrame.src) lazyFrame.src = lazyFrame.dataset.src;
  // 看板是表格密集型面板，单独放宽版心；其余 Tab 维持阅读宽度
  const main = document.querySelector("main");
  if (main) {
    main.classList.toggle("max-w-5xl", tab !== "dashboard");
    main.classList.toggle("max-w-7xl", tab === "dashboard");
  }
  if (!opts.silent) {
    const canonical = "#/" + tab;
    if (location.hash !== canonical) history.replaceState(null, "", location.pathname + location.search + canonical);
  }
  if (tab === "my-tasks") loadMyTasks();
  return true;
}
export function parseHashTab() {
  let m = location.hash.match(/^#\/([a-z-]+)$/);
  if (m) return m[1];
  m = location.hash.match(/^#tab-([a-z-]+)$/); // 旧式断链兼容
  return m ? m[1] : null;
}
let applySeq = 0; // 路由应用序号：并发的 applyHashRoute 只有最新一次允许回写 pendingHashTab，避免过期结果覆盖新路由
export async function applyHashRoute() {
  const seq = ++applySeq;
  const tab = parseHashTab() || pendingHashTab;
  if (!tab) return;
  const ok = await switchTab(tab, { silent: true });
  if (seq !== applySeq) return;
  if (ok) {
    pendingHashTab = null;
    const canonical = "#/" + tab;
    if (location.hash !== canonical) history.replaceState(null, "", location.pathname + location.search + canonical);
  } else if (TAB_IDS.includes(tab)) {
    // 目标 Tab 当前不可见（如未登录）：暂存待门控放开后重放，不再抹掉 hash
    pendingHashTab = tab;
  } else {
    // 未知 hash：落回首页
    pendingHashTab = null;
    switchTab("home", { silent: true });
    history.replaceState(null, "", location.pathname + location.search + "#/home");
  }
}
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});
window.addEventListener("hashchange", applyHashRoute);
applyHashRoute();

// 低频 Tab（Skill 中心/资料页/开源仓库/硬件评审/合同审批）默认收进「更多」，保持导航 6 个高频入口
// gate-off（登录门控，ST-04 新 Tab 用）优先于「更多」折叠：未登录时始终隐藏，登录后随折叠状态显隐
let moreExpanded = false;
function setMoreTabs(expanded) {
  moreExpanded = expanded;
  document.querySelectorAll(".tab-more").forEach(b =>
    b.classList.toggle("hidden", b.classList.contains("gate-off") || !expanded));
  const btn = document.getElementById("nav-more-btn");
  if (btn) btn.textContent = expanded ? "收起 ▴" : "更多 ▾";
}
// 登录门控 Tab 的 gate 函数在登录态变化后调用，按当前折叠状态重算可见性
export function refreshMoreTabs() { setMoreTabs(moreExpanded); }
function toggleMoreTabs() {
  // 不能再用「是否存在 .tab-more.hidden」判断折叠态：gate-off（未登录门控）的 Tab 展开后仍隐藏
  setMoreTabs(!moreExpanded);
}

function showPublishPrompt() {
  document.getElementById("publish-box").classList.toggle("hidden");
}

function copyText(id) {
  navigator.clipboard.writeText(document.getElementById(id).textContent);
}

// NEC-MCP 连通性测试：直接对 /mcp 发 JSON-RPC ping
async function testConnection() {
  const btns = document.querySelectorAll('#tab-agent button');
  const btn = [...btns].find(b => b.textContent.includes('测试连接'));
  const orig = btn ? btn.innerHTML : '';
  if (btn) btn.innerHTML = '⏳ 连接中…';
  try {
    const resp = await fetch(ORIGIN + '/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    const data = await resp.json();
    if (resp.ok && data.jsonrpc === '2.0' && !data.error) {
      if (btn) btn.innerHTML = '✅ 连接正常';
    } else if (resp.status === 401) {
      if (btn) btn.innerHTML = '🔑 需配置 MCP_TOKEN';
    } else {
      throw new Error(data.error?.message || ('HTTP ' + resp.status));
    }
  } catch (e) {
    if (btn) btn.innerHTML = '❌ 连接失败';
    alert('NEC-MCP 连接测试失败：' + (e.message || e));
  }
  if (btn) setTimeout(() => { btn.innerHTML = orig; }, 3000);
}

// 健康检查：结果存 HEALTH_DATA，徽标点击展开全站健康面板（API / MCP 延迟 / FE-05 数据健康）
let HEALTH_DATA = null;
fetch("/api/health").then(r => r.json()).then(d => {
  HEALTH_DATA = d;
  const el = document.getElementById("health");
  el.textContent = "● 服务正常";
  el.className = "text-xs px-2 py-1 rounded bg-green-100 text-green-700 cursor-pointer";
}).catch(() => {
  const el = document.getElementById("health");
  el.textContent = "● 连接失败";
  el.className = "text-xs px-2 py-1 rounded bg-red-100 text-red-600 cursor-pointer";
});

async function toggleHealthPanel() {
  const panel = document.getElementById("health-panel");
  if (!panel) return;
  if (!panel.classList.contains("hidden")) { panel.classList.add("hidden"); return; }
  panel.classList.remove("hidden");
  panel.innerHTML = `<p class="text-xs text-gray-400">检测中…</p>`;
  // MCP 端点延迟：401 也算端点存活（仅说明需要鉴权）
  const t0 = performance.now();
  let mcpLine;
  try {
    const resp = await fetch(ORIGIN + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    const ms = Math.round(performance.now() - t0);
    mcpLine = resp.ok
      ? `<span class="text-green-600">● 正常</span> · ${ms}ms`
      : resp.status === 401
        ? `<span class="text-green-600">● 正常</span>（需鉴权）· ${ms}ms`
        : `<span class="text-amber-600">● HTTP ${resp.status}</span>`;
  } catch {
    mcpLine = `<span class="text-red-500">● 不可达</span>`;
  }
  let validateLine = `<span class="text-gray-400">登录后可见</span>`;
  if (ME.authenticated) {
    try {
      const r = await fetch("/api/validate/report");
      if (r.ok) {
        const rep = await r.json();
        validateLine = rep && !rep.empty
          ? `${rep.total ? `<span class="text-red-600">● ${rep.total} 条异常</span>` : `<span class="text-green-600">● 无异常</span>`} · 上次校验 ${rep.generatedAt ? new Date(rep.generatedAt).toLocaleString("zh-CN") : "—"}`
          : `<span class="text-gray-400">暂无校验报告</span>`;
      }
    } catch { /* 保持默认提示 */ }
  }
  panel.innerHTML = `
    <p class="text-xs font-bold mb-2" style="color:var(--nec-navy)">全站健康</p>
    <ul class="text-xs text-gray-600 space-y-1.5">
      <li class="flex justify-between gap-2"><span>API 服务</span><span>${HEALTH_DATA ? `<span class="text-green-600">● 正常</span> · ${esc(HEALTH_DATA.service || "nec-hub")}` : `<span class="text-red-500">● 异常</span>`}</span></li>
      <li class="flex justify-between gap-2"><span>最近心跳</span><span class="text-gray-400">${HEALTH_DATA && HEALTH_DATA.time ? new Date(HEALTH_DATA.time).toLocaleString("zh-CN") : "—"}</span></li>
      <li class="flex justify-between gap-2"><span>NEC-MCP 端点</span><span>${mcpLine}</span></li>
      <li class="flex justify-between gap-2"><span>数据健康（FE-05）</span><span>${validateLine}</span></li>
    </ul>
    <button onclick="document.getElementById('health-panel').classList.add('hidden');switchTab('dashboard')" class="mt-3 text-xs hover:underline" style="color:var(--nec-cyan)">数据健康详情 →</button>`;
}

// ===== 我的任务：绑定飞书任务并同步（GET /api/my-tasks，KV 5 分钟缓存） =====
let MY_TASKS_AUTH_URL = null;
function bindMyTasks() {
  if (MY_TASKS_AUTH_URL) location.href = MY_TASKS_AUTH_URL;
}

async function loadMyTasks(force) {
  const body = document.getElementById("my-tasks-body");
  const actions = document.getElementById("my-tasks-actions");
  const meta = document.getElementById("my-tasks-meta");
  if (!body) return;
  if (!ME.authenticated) {
    actions.innerHTML = ""; meta.textContent = "";
    body.innerHTML = `<div class="bg-white rounded-xl shadow p-8 text-center text-sm text-gray-400">请先点击右上角「飞书登录」，登录后可绑定并同步你的飞书任务</div>`;
    return;
  }
  let data;
  try {
    const resp = await fetch("/api/my-tasks" + (force ? "?refresh=1" : ""));
    if (resp.status === 401) {
      body.innerHTML = `<div class="bg-white rounded-xl shadow p-8 text-center text-sm text-gray-400">登录已过期，请重新登录</div>`;
      return;
    }
    data = await resp.json();
  } catch (e) {
    body.innerHTML = `<div class="bg-white rounded-xl shadow p-8 text-center text-sm text-red-500">任务加载失败：${esc(e.message || String(e))}</div>`;
    return;
  }
  if (!data.bound) {
    meta.textContent = ""; actions.innerHTML = "";
    MY_TASKS_AUTH_URL = data.authorizeUrl || null;
    body.innerHTML = `
      <div class="bg-white rounded-xl shadow p-8 text-center">
        <p class="text-sm text-gray-500 mb-1">尚未绑定飞书任务${data.rebind ? "（原授权已失效）" : ""}</p>
        <p class="text-xs text-gray-400 mb-4">授权后中台将代你同步拉取飞书任务（Task v2，只读）</p>
        ${MY_TASKS_AUTH_URL
          ? `<button onclick="bindMyTasks()" class="text-sm text-white px-4 py-2 rounded-lg" style="background:var(--nec-cyan)">🔗 绑定飞书任务</button>`
          : `<p class="text-xs text-red-500">飞书应用未配置，无法发起授权</p>`}
      </div>`;
    return;
  }
  meta.textContent = "同步于 " + new Date(data.syncedAt).toLocaleString("zh-CN") + (data.cached ? "（缓存）" : "");
  actions.innerHTML = `
    <button onclick="loadMyTasks(true)" class="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600">同步</button>
    <button onclick="unbindMyTasks()" class="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600">解绑</button>`;
  if (!data.tasks || !data.tasks.length) {
    body.innerHTML = `<div class="bg-white rounded-xl shadow p-8 text-center text-sm text-gray-400">🎉 没有未完成的飞书任务</div>`;
    return;
  }
  const now = Date.now();
  body.innerHTML = data.tasks.map(t => {
    const done = !!t.completedAt;
    const overdue = !done && t.dueTimestamp && t.dueTimestamp < now;
    const due = t.dueTimestamp
      ? new Date(t.dueTimestamp).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      : "无截止时间";
    return `
    <div class="bg-white rounded-xl shadow p-4 flex items-center gap-3 ${done ? "opacity-50" : ""}">
      <div class="flex-1 min-w-0">
        ${t.url
          ? `<a href="${esc(t.url)}" target="_blank" class="font-medium hover:underline ${done ? "line-through text-gray-400" : ""}" style="color:var(--nec-navy)">${esc(t.summary)}</a>`
          : `<span class="font-medium ${done ? "line-through text-gray-400" : ""}" style="color:var(--nec-navy)">${esc(t.summary)}</span>`}
        <p class="text-xs mt-1 ${overdue ? "text-red-600 font-medium" : "text-gray-400"}">${overdue ? "已逾期 · " : ""}截止：${due}</p>
      </div>
      ${done
        ? `<span class="text-xs text-gray-400 shrink-0">已完成</span>`
        : overdue ? `<span class="text-xs text-white px-2 py-0.5 rounded bg-red-500 shrink-0">逾期</span>` : ""}
    </div>`;
  }).join("");
}

async function unbindMyTasks() {
  if (!confirm("解绑后将停止同步你的飞书任务，确定解绑？")) return;
  await fetch("/api/my-tasks/unbind", { method: "POST" }).catch(() => {});
  loadMyTasks();
}

// ===== FE-09 待办条：聚合逾期任务 / 待确认报销 / 飞书审批 / 本地审批单（GET /api/todos，5 分钟缓存） =====
// G-04：本地审批单（approvals_local）中 urgent=true 的合规单红色高亮 + 「T-1」徽标置顶；有 deadline 的非 urgent 条目显示倒计时
const TODO_TYPE_LABELS = { reimburse: "报销", drawing: "图纸", hardware: "硬件", compliance: "合规" };
let TODO_DATA = null;
async function loadTodos() {
  const bar = document.getElementById("todo-bar");
  if (!bar) return;
  if (!ME.authenticated) { bar.classList.add("hidden"); return; }
  try {
    const resp = await fetch("/api/todos");
    if (!resp.ok) { bar.classList.add("hidden"); return; }
    TODO_DATA = await resp.json();
  } catch { bar.classList.add("hidden"); return; }
  if (!TODO_DATA || !TODO_DATA.total) { bar.classList.add("hidden"); return; }
  const t = TODO_DATA.tasks?.length ?? 0;
  const f = TODO_DATA.finance?.count ?? 0;
  const a = TODO_DATA.approvals?.count ?? 0;
  const al = TODO_DATA.approvals_local?.count ?? 0;
  const parts = [];
  if (t) parts.push(`逾期任务 ${t}`);
  if (f) parts.push(`待确认报销 ${f}`);
  if (a) parts.push(`飞书审批 ${a}`);
  if (al) parts.push(`审批中 ${al}`);
  document.getElementById("todo-bar-text").textContent =
    `你有 ${TODO_DATA.total} 项待办（${parts.join(" · ")}），点击展开处理`;
  const taskRows = (TODO_DATA.tasks ?? []).map(x => `
    <li class="py-1.5 flex items-baseline gap-2 flex-wrap">
      <span class="text-xs px-1.5 py-0.5 rounded bg-white/15 shrink-0">任务</span>
      <a href="${esc(x.link)}" target="_blank" class="hover:underline font-medium">${esc(x.title)}</a>
      <span class="text-xs text-white/70">逾期 ${x.daysOverdue ?? "?"} 天 · ${esc(x.status)}</span>
    </li>`).join("");
  const finRows = (TODO_DATA.finance?.items ?? []).map(x => `
    <li class="py-1.5 flex items-baseline gap-2 flex-wrap">
      <span class="text-xs px-1.5 py-0.5 rounded bg-white/15 shrink-0">报销</span>
      <a href="${esc(x.link)}" target="_blank" class="hover:underline font-medium">${esc(x.name)}</a>
      <span class="text-xs text-white/70">${x.amount ?? "—"} 元 · ${esc(x.applicant || "—")} · ${esc(x.status)}</span>
    </li>`).join("");
  const apRows = (TODO_DATA.approvals?.items ?? []).map(x => `
    <li class="py-1.5 flex items-baseline gap-2 flex-wrap">
      <span class="text-xs px-1.5 py-0.5 rounded bg-white/15 shrink-0">审批</span>
      <a href="${esc(x.link)}" target="_blank" class="hover:underline font-medium">${esc(x.title)}</a>
    </li>`).join("");
  const alRows = (TODO_DATA.approvals_local?.items ?? []).map(x => {
    const typeLabel = TODO_TYPE_LABELS[x.type] ?? "审批";
    const badge = x.urgent
      ? `<span class="text-xs px-1.5 py-0.5 rounded bg-red-500 text-white font-bold shrink-0">T-1</span>`
      : "";
    let meta = "";
    if (x.urgent && x.deadline) {
      meta = `<span class="text-xs text-red-200 font-medium">距计划发布不足 24h</span>`;
    } else if (x.deadline) {
      const days = Math.ceil((x.deadline - Date.now()) / 86400000);
      meta = `<span class="text-xs text-white/70">${days > 0 ? `距计划发布还有 ${days} 天` : "已过计划发布时间"}</span>`;
    }
    return `
    <li class="py-1.5 flex items-baseline gap-2 flex-wrap${x.urgent ? " -mx-2 px-2 rounded bg-red-500/25" : ""}">
      <span class="text-xs px-1.5 py-0.5 rounded ${x.urgent ? "bg-red-500/60" : "bg-white/15"} shrink-0">${typeLabel}</span>
      ${badge}
      <a href="${esc(x.url)}" target="_blank" class="hover:underline font-medium">${esc(x.title)}</a>
      ${meta}
    </li>`;
  }).join("");
  const warnRows = (TODO_DATA.warnings ?? []).map(w => `<p class="text-xs text-white/60 mt-1">⚠ ${esc(w)}</p>`).join("");
  document.getElementById("todo-list").innerHTML =
    `<ul class="divide-y divide-white/10">${alRows}${taskRows}${finRows}${apRows}</ul>${warnRows}`;
  bar.classList.remove("hidden");
}
function toggleTodoList() {
  document.getElementById("todo-list")?.classList.toggle("hidden");
}

// 应用广场
fetch("/api/apps").then(r => r.json()).then(apps => {
  const box = document.getElementById("apps-list");
  if (!apps.length) {
    box.innerHTML = `<div class="col-span-full bg-white rounded-xl shadow p-8 text-center text-gray-400 text-sm">
      还没有应用上架。<br/>点击右上角「发布我的应用」，把 Prompt 发给你的 Agent 即可上架第一个应用。</div>`;
    return;
  }
  box.innerHTML = apps.map(a => `
    <a href="${a.url}" target="_blank" class="block bg-white rounded-xl shadow hover:shadow-md transition p-5">
      <div class="flex items-center justify-between">
        <h3 class="font-bold">${esc(a.title)}</h3>
        <span class="text-xs text-gray-400">v${esc(a.version)}${a.external ? ' · 外链' : ''}</span>
      </div>
      <p class="text-xs text-gray-500 mt-1">${esc(a.name)} · ${esc(a.author)}</p>
      <p class="text-xs text-gray-400 mt-2">更新于 ${new Date(a.updatedAt).toLocaleString("zh-CN")}</p>
    </a>`).join("");
});

// Skill 中心：分类 + 检索
let skillsData = [];
let skillCat = "all";
let skillKw = "";
let skillSort = "updated";
// 与后端 src/hosting.ts 的 SKILL_CATEGORY_LABELS / 推断规则保持一致（静态页无法 import worker 代码）
const SKILL_CAT_LABEL = { dev: "开发工具", docs: "文档办公", design: "设计创意", media: "音视频", data: "数据分析", lark: "飞书协同", agent: "Agent 基建", life: "生活效率", other: "其他" };
const SKILL_CAT_ORDER = ["dev", "docs", "design", "media", "data", "lark", "agent", "life", "other"];
const SKILL_CAT_RULES = [
  ["lark", /^lark-|飞书|多维表格|妙记/i],
  ["media", /video|audio|music|剪辑|视频|音频|音乐|字幕|ffmpeg|whisper|gif|混剪/i],
  ["design", /design|canvas|poster|brand|海报|视觉|排版|theme|插画/i],
  ["data", /data|analy|chart|sql|financial|数据|可视化|财报|股票|评分/i],
  ["docs", /docx|xlsx|excel|word|pdf|markdown|ppt|slide|文档|论文|thesis|paper|写作|手册/i],
  ["dev", /code|debug|git|review|test|deploy|refactor|代码|调试|commit|cli/i],
  ["agent", /mcp|skill|agent|persona|memory|claude|kimi|gemini|browser|prompt/i],
  ["life", /weather|travel|news|mail|todo|日程|天气|新闻|旅行|提醒|邮件/i],
];

function skillCategoryOf(s) {
  const c = (s.category || "").toLowerCase();
  if (SKILL_CAT_LABEL[c]) return c;
  const text = `${s.name} ${s.description || ""}`;
  for (const [cat, re] of SKILL_CAT_RULES) if (re.test(text)) return cat;
  return "other";
}

function renderSkillCatBar() {
  const counts = {};
  skillsData.forEach(s => { const c = skillCategoryOf(s); counts[c] = (counts[c] || 0) + 1; });
  document.getElementById("skill-cat-btns").innerHTML =
    [`<button data-skill-cat="all" class="skill-cat-btn ${skillCat === "all" ? "on" : ""} px-3 py-1 rounded-full">全部 ${skillsData.length}</button>`]
      .concat(SKILL_CAT_ORDER.filter(c => counts[c]).map(c =>
        `<button data-skill-cat="${c}" class="skill-cat-btn ${skillCat === c ? "on" : ""} px-3 py-1 rounded-full">${SKILL_CAT_LABEL[c]} ${counts[c]}</button>`))
      .join("");
}

function skillCard(s) {
  const cat = skillCategoryOf(s);
  const tags = (s.tags || []).slice(0, 5).map(t =>
    `<span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">#${esc(t)}</span>`).join(" ");
  return `
    <div class="bg-white rounded-xl shadow p-5 flex items-center gap-4">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <h3 class="font-bold">${esc(s.name)}</h3>
          <span class="text-[10px] px-1.5 py-0.5 rounded" style="background:var(--nec-paper);color:var(--nec-gray);border:1px solid var(--nec-line)">${SKILL_CAT_LABEL[cat]}</span>
          ${s.source === "gitee" ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-500">Gitee</span>' : ""}
          ${s.source === "hub" ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-[#E8ECFB] text-[#1A2FA0]">中台自托管</span>' : ""}
        </div>
        <p class="text-sm text-gray-500 mt-1">${esc(s.description || "")}</p>
        ${tags ? `<div class="flex gap-1 mt-1.5 flex-wrap">${tags}</div>` : ""}
        <p class="text-xs text-gray-400 mt-1.5">更新于 ${new Date(s.updatedAt).toLocaleString("zh-CN")}</p>
      </div>
      <a href="${s.url || (ORIGIN + '/skills/' + encodeURIComponent(s.name) + '/SKILL.md')}" target="_blank"
         class="text-sm hover:underline whitespace-nowrap" style="color:var(--nec-cyan)">查看 SKILL.md${s.source === 'gitee' ? ' ⤤' : ''}</a>
    </div>`;
}

function renderSkills() {
  const box = document.getElementById("skills-list");
  let list = skillsData.filter(s =>
    (skillCat === "all" || skillCategoryOf(s) === skillCat) &&
    (!skillKw || s.name.toLowerCase().includes(skillKw) ||
      (s.description || "").toLowerCase().includes(skillKw) ||
      (s.tags || []).some(t => t.toLowerCase().includes(skillKw))));
  list = [...list].sort(skillSort === "name"
    ? (a, b) => a.name.localeCompare(b.name)
    : (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  document.getElementById("skills-count").textContent = skillsData.length ? `共 ${list.length} / ${skillsData.length} 个` : "";
  if (!list.length) {
    box.innerHTML = `<div class="bg-white rounded-xl shadow p-8 text-center text-gray-400 text-sm">${skillsData.length ? "没有匹配的 Skill，换个关键字或分类试试。" : "还没有 Skill 上架。"}</div>`;
    return;
  }
  // 全部 + 无搜索词时按分类分组展示；筛选状态下用平铺结果列表
  if (skillCat === "all" && !skillKw) {
    const groups = SKILL_CAT_ORDER.map(cat => ({ cat, items: list.filter(s => skillCategoryOf(s) === cat) })).filter(g => g.items.length);
    box.innerHTML = groups.map(g => `
      <div>
        <h3 class="text-sm font-bold text-slate-700 mb-3">${SKILL_CAT_LABEL[g.cat]}<span class="text-xs font-normal text-gray-400 ml-2">${g.items.length}</span></h3>
        <div class="space-y-3">${g.items.map(skillCard).join("")}</div>
      </div>`).join("");
    return;
  }
  box.innerHTML = list.map(skillCard).join("");
}

document.getElementById("skill-q").addEventListener("input", e => {
  skillKw = e.target.value.trim().toLowerCase();
  renderSkills();
});
document.getElementById("skill-sort").addEventListener("change", e => {
  skillSort = e.target.value;
  renderSkills();
});
document.getElementById("skill-cat-btns").addEventListener("click", e => {
  const b = e.target.closest(".skill-cat-btn");
  if (!b) return;
  skillCat = b.dataset.skillCat;
  renderSkillCatBar();
  renderSkills();
});

fetch("/api/skills").then(r => r.json()).then(skills => {
  skillsData = skills || [];
  renderSkillCatBar();
  renderSkills();
});

// 资料页
let docsData = [];
let docsCat = "all";
const DOC_CAT_LABEL = { brand: "品牌规范", template: "文档模板", sop: "制度 SOP", training: "培训材料" };
const DOC_CAT_ORDER = ["brand", "template", "sop", "training"];

function showDocPublishPrompt() {
  document.getElementById("doc-publish-box").classList.toggle("hidden");
}

function renderDocs() {
  const box = document.getElementById("docs-list");
  const list = docsData.filter(d => docsCat === "all" || d.category === docsCat);
  if (!list.length) {
    box.innerHTML = `<p class="text-sm text-gray-400 bg-white rounded-xl shadow p-8 text-center">当前分类暂无资料。</p>`;
    return;
  }
  const groups = DOC_CAT_ORDER.map(cat => ({ cat, items: list.filter(d => d.category === cat) })).filter(g => g.items.length);
  box.innerHTML = groups.map(g => `
    <div>
      <h3 class="text-sm font-bold text-slate-700 mb-3">${DOC_CAT_LABEL[g.cat]}</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        ${g.items.map(d => {
          const inner = `
            <div class="flex items-center justify-between">
              <h4 class="font-bold">${esc(d.title)}</h4>
              <span class="shrink-0">
                ${d.url ? "" : `<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 mr-1">即将上线</span>`}
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">${d.category}</span>
              </span>
            </div>
            <p class="text-sm text-gray-500 mt-1 line-clamp-2">${esc(d.description || "")}</p>
            <p class="text-xs text-gray-400 mt-3">维护：${esc(d.maintainer || "—")} · ${new Date(d.updatedAt).toLocaleString("zh-CN")}</p>`;
          return d.url
            ? `<a href="${d.url}" target="_blank" class="block bg-white rounded-xl shadow hover:shadow-md transition p-5">${inner}</a>`
            : `<div class="block bg-white rounded-xl shadow p-5 opacity-75 cursor-default">${inner}</div>`;
        }).join("")}
      </div>
    </div>`).join("");
}

document.querySelectorAll(".doc-cat-btn").forEach(b => b.addEventListener("click", () => {
  docsCat = b.dataset.docCat;
  document.querySelectorAll(".doc-cat-btn").forEach(x => x.classList.toggle("on", x === b));
  renderDocs();
}));

fetch("/api/docs").then(r => r.json()).then(docs => {
  docsData = docs || [];
  renderDocs();
});

// NEC 开源仓库（GitHub org + Gitee 账号合并，点击表头按 Star/Fork/Commit 等排序）
let reposData = [];
let reposSort = { key: "stars", dir: -1 };
let reposHost = "all";

const REPO_COLS = [
  { key: "name",     label: "仓库" },
  { key: "host",     label: "来源" },
  { key: "language", label: "语言" },
  { key: "stars",    label: "★ Star" },
  { key: "forks",    label: "⑂ Fork" },
  { key: "commits",  label: "Commit" },
  { key: "pushedAt", label: "最近提交" },
];

document.querySelectorAll(".host-btn").forEach(b => b.addEventListener("click", () => {
  reposHost = b.dataset.host;
  document.querySelectorAll(".host-btn").forEach(x => x.classList.toggle("on", x === b));
  renderRepos();
}));

fetch("/api/repos").then(r => r.json()).then(d => {
  reposData = d.repos || [];
  const box = document.getElementById("repos-box");
  if (!reposData.length) {
    box.innerHTML = `<p class="p-8 text-center text-gray-400 text-sm">${esc(d.error || "暂无公开仓库。")}</p>`;
    return;
  }
  const time = d.cachedAt ? new Date(d.cachedAt).toLocaleString("zh-CN") : "";
  document.getElementById("repos-meta").textContent =
    `共 ${reposData.length} 个开源仓库（GitHub ${d.github || ""} + Gitee ${d.gitee || ""}） · 数据更新于 ${time}${d.stale ? "（上游暂不可用，展示缓存快照）" : ""}`;
  renderRepos();
}).catch(() => {
  document.getElementById("repos-box").innerHTML =
    `<p class="p-8 text-center text-red-500 text-sm">仓库列表加载失败，请稍后刷新重试。</p>`;
});

function sortRepos(key) {
  if (reposSort.key === key) reposSort.dir *= -1;
  else reposSort = { key, dir: key === "name" || key === "host" ? 1 : -1 };
  renderRepos();
}

function renderRepos() {
  const box = document.getElementById("repos-box");
  const { key, dir } = reposSort;
  const data = reposData.filter(r => reposHost === "all" || r.host === reposHost);
  if (!data.length) {
    box.innerHTML = `<p class="p-8 text-center text-gray-400 text-sm">该来源下暂无仓库。</p>`;
    return;
  }
  const val = r => key === "name" ? r.name : key === "host" ? r.host : key === "pushedAt" ? (Date.parse(r.pushedAt) || 0) : (r[key] || 0);
  // 先取排序键再排序（装饰-排序-去装饰）：避免比较器里 O(n log n) 次重复取值/Date.parse
  const rows = data
    .map(r => ({ v: val(r), r }))
    .sort((a, b) => (typeof a.v === "string" ? a.v.localeCompare(b.v) : a.v - b.v) * dir)
    .map(x => x.r);
  const arrow = k => reposSort.key === k ? (reposSort.dir > 0 ? " ↑" : " ↓") : "";
  const hostBadge = h => h === "gitee"
    ? ' <span class="text-[10px] text-red-500 border border-red-200 rounded px-1 ml-1">Gitee</span>'
    : ' <span class="text-[10px] text-gray-400 border border-gray-200 rounded px-1 ml-1">GitHub</span>';
  box.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-gray-400 border-b">
            ${REPO_COLS.map(c => `<th class="px-4 py-3 font-medium whitespace-nowrap"><button onclick="sortRepos('${c.key}')" class="hover:underline">${c.label}${arrow(c.key)}</button></th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr class="border-b last:border-0 hover:bg-gray-50">
              <td class="px-4 py-3">
                <a href="${r.url}" target="_blank" class="font-bold hover:underline" style="color:var(--nec-navy)">${esc(r.name)}</a>${hostBadge(r.host)}${r.isFork ? ' <span class="text-[10px] text-gray-400 border border-gray-200 rounded px-1">fork</span>' : ""}
                <p class="text-xs text-gray-400 mt-0.5">${esc(r.description || "")}</p>
              </td>
              <td class="px-4 py-3 whitespace-nowrap text-gray-500">${r.host === "gitee" ? "Gitee" : "GitHub"}</td>
              <td class="px-4 py-3 whitespace-nowrap text-gray-500">${esc(r.language || "—")}</td>
              <td class="px-4 py-3 mono whitespace-nowrap">${r.stars}</td>
              <td class="px-4 py-3 mono whitespace-nowrap">${r.forks}</td>
              <td class="px-4 py-3 mono whitespace-nowrap">${r.commits ?? "—"}</td>
              <td class="px-4 py-3 mono whitespace-nowrap text-gray-500">${r.pushedAt ? new Date(r.pushedAt).toLocaleDateString("zh-CN") : "—"}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

// ===== PRD 看板（动态）：里程碑三列卡片 + 总进度 + 最近提交（GET /api/prd） =====
const PRD_STATUS_META = {
  done:     { label: "已完成", color: "#16A34A", bg: "#ECFDF5" },
  partial:  { label: "进行中", color: "#1FA9E8", bg: "#EFF8FF" },
  pending:  { label: "待验收", color: "#D97706", bg: "#FFFBEB" },
  todo:     { label: "未开始", color: "#9CA3AF", bg: "#F9FAFB" },
};
function renderPrd(board) {
  const status = document.getElementById("prd-status");
  const total = board.progress?.total ?? 0;
  const done = board.progress?.done ?? 0;
  const pct = total ? Math.round(done / total * 100) : 0;
  status.textContent = `更新于 ${new Date(board.updatedAt).toLocaleString("zh-CN")}`;
  document.getElementById("prd-progress").innerHTML = `
    <div class="bg-white rounded-xl shadow p-5">
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm font-bold">总进度</span>
        <span class="text-sm font-black" style="color:var(--nec-navy)">${done} / ${total}（${pct}%）</span>
      </div>
      <div class="h-3 rounded overflow-hidden bg-gray-100">
        <div class="h-3 rounded" style="width:${pct}%;background:linear-gradient(90deg,var(--nec-cyan),var(--nec-sky))"></div>
      </div>
    </div>`;
  document.getElementById("prd-last-commit").innerHTML = board.lastCommit ? `
    <div class="bg-white rounded-xl shadow p-4 flex items-center gap-3 text-sm">
      <span class="px-2 py-0.5 rounded text-xs text-white" style="background:var(--nec-navy)">最近提交</span>
      <a href="${esc(board.lastCommit.url)}" target="_blank" class="hover:underline truncate" style="color:var(--nec-cyan)">${esc(board.lastCommit.message)}</a>
      <span class="text-xs text-gray-400 whitespace-nowrap">${esc(board.lastCommit.branch)} · ${esc(board.lastCommit.author)} · ${new Date(board.lastCommit.at).toLocaleString("zh-CN")}</span>
    </div>` : "";
  document.getElementById("prd-board").innerHTML = (board.milestones ?? []).map((m) => `
    <div class="bg-white rounded-xl shadow p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold">${esc(m.id)} · ${esc(m.title)}</h3>
        <span class="text-xs text-gray-400">${m.done}/${m.total}</span>
      </div>
      <div class="h-1.5 rounded bg-gray-100 mb-4"><div class="h-1.5 rounded" style="width:${m.total ? m.done / m.total * 100 : 0}%;background:var(--nec-cyan)"></div></div>
      <div class="space-y-2">
        ${m.cards.map((c) => {
          const meta = PRD_STATUS_META[c.status] ?? PRD_STATUS_META.todo;
          return `
          <div class="rounded-lg p-3 border border-gray-100" style="background:${meta.bg}">
            <div class="flex items-center justify-between gap-2">
              <span class="font-bold text-sm" style="color:var(--nec-navy)">${esc(c.id)}</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded text-white" style="background:${meta.color}">${meta.label}</span>
            </div>
            <p class="text-xs mt-1" style="color:var(--nec-ink)">${esc(c.title)}</p>
            <p class="text-[10px] text-gray-400 mt-0.5">${esc(c.priority)}${c.note ? " · " + esc(c.note) : ""}</p>
          </div>`;
        }).join("")}
      </div>
    </div>`).join("");
}
fetch("/api/prd").then(r => r.json()).then(renderPrd).catch(() => {
  document.getElementById("prd-board").innerHTML =
    `<div class="bg-white rounded-xl shadow p-6 text-sm text-red-500">PRD 看板加载失败，请稍后重试。</div>`;
});

// ===== PRD 文档库：docs/ 下全部 PRD 在线阅读（原文同步自 docs/*.md → public/docs/prd/） =====
const PRD_DOCS = [
  { slug: "team-ai-platform-v2.0",       title: "团队 AI 中台 PRD",              version: "V2.0", date: "2026-10-14", desc: "中台总纲：M1 地基 / M2 资产与智能 / M3 个性化与自动化，FE-01 ~ FE-14 需求全景（上方看板的数据来源）" },
  { slug: "approval-notification-v1.1",  title: "审批与通知中心 PRD",            version: "V1.1", date: "2026-10-12", desc: "报销 / 机械图纸 / 硬件采购领用 / 合规四条流程，流程即配置的 Plan B 审批引擎" },
  { slug: "approval-notification-v1.2",  title: "审批与通知中心 PRD（缺口补齐）", version: "V1.2", date: "2026-10-14", desc: "台账联动、合规申请页、审批时效治理、待办 T-1 标红、邮件通道（飞书邮箱）" },
  { slug: "contract-signing-oa-v1.0",    title: "协议签署 OA 审批 PRD",          version: "V1.0", date: "2026-10-14", desc: "合作协议 / 保密协议（NDA）走飞书原生 OA 审批：法务 → 运营 → 合规三级串行审核，全部通过方可签署用章" },
  { slug: "drawing-review-process-v1.0", title: "新增机图纸评审流程 PRD",         version: "v1.0", date: "2026-10-14", desc: "图纸评审数字化工作流：在线提交、会议自动预约、BOM/电控/布线评估、询价与发货清单" },
];
function renderPrdDocs() {
  const box = document.getElementById("prd-docs");
  if (!box) return;
  box.innerHTML = PRD_DOCS.map((d) => `
    <div class="bg-white rounded-xl shadow p-5 flex flex-col">
      <div class="flex items-center gap-2 mb-1.5">
        <span class="text-[10px] px-1.5 py-0.5 rounded text-white" style="background:var(--nec-navy)">${esc(d.version)}</span>
        <span class="text-[10px] text-gray-400">更新于 ${esc(d.date)}</span>
      </div>
      <h4 class="font-bold text-sm" style="color:var(--nec-navy)">${esc(d.title)}</h4>
      <p class="text-xs text-gray-500 mt-1 flex-1">${esc(d.desc)}</p>
      <button onclick="openPrdDoc('${d.slug}')" class="mt-3 self-start text-xs px-3 py-1.5 rounded-lg text-white" style="background:var(--nec-cyan)">在线阅读</button>
    </div>`).join("");
}
let _markedLoading = null;
function loadMarked() {
  if (window.marked) return Promise.resolve();
  if (!_markedLoading) {
    _markedLoading = injectScript(CDN_FASTLY + "/marked@12.0.2/lib/marked.umd.js")
      .catch(() => injectScript(CDN_JSDELIVR + "/marked@12.0.2/lib/marked.umd.js"));
  }
  return _markedLoading;
}
async function openPrdDoc(slug) {
  const doc = PRD_DOCS.find((d) => d.slug === slug);
  const reader = document.getElementById("prd-reader");
  const body = document.getElementById("prd-reader-body");
  if (!doc || !reader || !body) return;
  if (reader.dataset.open === slug) { closePrdDoc(); return; }
  reader.dataset.open = slug;
  reader.classList.remove("hidden");
  document.getElementById("prd-reader-title").textContent = `${doc.title} ${doc.version}`;
  body.innerHTML = '<p class="text-gray-400">加载中…</p>';
  reader.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const [md] = await Promise.all([
      fetch("/docs/prd/" + slug + ".md").then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); }),
      loadMarked(),
    ]);
    if (reader.dataset.open !== slug) return;
    body.innerHTML = window.marked.parse(md);
  } catch (e) {
    body.innerHTML = '<p class="text-red-500">文档加载失败，请稍后重试。</p>';
  }
}
function closePrdDoc() {
  const reader = document.getElementById("prd-reader");
  if (!reader) return;
  reader.dataset.open = "";
  reader.classList.add("hidden");
}
renderPrdDocs();

export { loadTodos, loadMyTasks };

// 内联事件处理器（HTML 及动态生成 markup 的 onclick）需要全局可见
Object.assign(window, {
  switchTab, toggleMoreTabs, showPublishPrompt, showDocPublishPrompt,
  copyText, testConnection, toggleHealthPanel,
  bindMyTasks, loadMyTasks, unbindMyTasks, toggleTodoList,
  sortRepos, openPrdDoc, closePrdDoc,
});

bootAuth();
