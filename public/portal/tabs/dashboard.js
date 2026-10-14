// 数据看板 + 物资台账 + FE-04 赛季目标 + 报销提交/我的报销 + FE-05 数据健康（自 index.html 内嵌脚本抽出）
// 报销/OCR 与看板同驻一个模块：renderDashboard 内联挂载 reimburseCard/myReimburseCard，submitReimburse 回调 loadDashboard
import { esc, injectScript, CDN_FASTLY, CDN_JSDELIVR } from "../shared/api.js";
import { ME } from "../shared/session.js";

// 数据看板
const DASH_CONFIG_PROMPT = `请帮我配置 NEC 中台的数据看板（飞书多维表格）：
1. 打开飞书多维表格，从浏览器地址栏复制 app_token 与各表的 table_id：
   URL 形如 https://xxx.feishu.cn/base/<app_token>?table=<table_id>&view=...
2. 调用 NEC-MCP 的 config_dashboard（action=set），传入 base 与 tables（tasks / inventory / members / finance / goals → table_id；goals 为赛季目标表，可选）
3. 配置完成后打开门户「数据看板」Tab 确认数据渲染`;

// 状态匹配正则提升为常量：dashStatusColor 在每个任务行/图例渲染时调用，避免每次重建 4 个正则
const DASH_STATUS_RE = {
  doing: /进行|doing|progress/i,
  done: /完成|done|完结/i,
  todo: /未开始|待|todo|pending/i,
  cancel: /取消|cancel|关闭|close/i,
};
function dashStatusColor(name) {
  if (DASH_STATUS_RE.doing.test(name)) return "#1FA9E8";
  if (DASH_STATUS_RE.done.test(name)) return "#141B5E";
  if (DASH_STATUS_RE.todo.test(name)) return "#9CA3AF";
  if (DASH_STATUS_RE.cancel.test(name)) return "#D1D5DB";
  return "#4FC3F7";
}

function fmtDashDate(v) {
  if (typeof v !== "number" || !isFinite(v)) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

/** 金额统一格式：千分位、最多两位小数；非数字原样转义输出 */
function fmtMoney(n) {
  if (typeof n === "number" && isFinite(n)) return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  const p = Number(n);
  return isFinite(p) && n !== "" && n !== null ? p.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "—";
}

// 物资台账：前端搜索（名称/库位）+ 缺货标红；数据随 renderDashboard 刷新，搜索只重渲染 tbody
let DASH_INV_ITEMS = [];
function invRowHtml(it) {
  const out = it.qty === 0;
  return `
    <tr class="border-t border-gray-100 ${out ? "bg-red-50" : ""}">
      <td class="py-2 pr-3">${esc(it.name)}</td>
      <td class="py-2 pr-3 mono text-xs whitespace-nowrap ${out ? "text-red-600 font-bold" : ""}">${it.qty ?? "—"}${out ? ' <span class="px-1 py-0.5 rounded text-[10px] text-white" style="background:#DC2626">缺货</span>' : ""}</td>
      <td class="py-2 text-gray-400 text-xs">${esc(it.location || "—")}</td>
    </tr>`;
}
function renderInvRows(q) {
  const tb = document.getElementById("inv-tbody");
  if (!tb) return;
  const kw = (q || "").trim().toLowerCase();
  const list = kw
    ? DASH_INV_ITEMS.filter(it => it.name.toLowerCase().includes(kw) || (it.location || "").toLowerCase().includes(kw))
    : DASH_INV_ITEMS;
  tb.innerHTML = list.length
    ? list.map(invRowHtml).join("")
    : `<tr><td colspan="3" class="py-3 text-sm text-gray-400">无匹配「${esc(kw)}」的物资</td></tr>`;
}

// ===== FE-04 赛季目标面板：里程碑时间线 + 各组完成度条形图 + 逾期红色告警 + T-7 顶部提醒条 =====
function goalBarColor(it) {
  if (it.overdue) return "#DC2626";
  if (it.done) return "#141B5E";
  return "#1FA9E8";
}

function goalStatusBadge(it) {
  if (it.overdue) return `<span class="px-2 py-0.5 rounded text-xs text-white" style="background:#DC2626">已逾期 ${Math.abs(it.daysLeft)} 天</span>`;
  if (it.done) return `<span class="px-2 py-0.5 rounded text-xs text-white" style="background:var(--nec-navy)">${esc(it.status || "已完成")}</span>`;
  if (it.daysLeft !== null && it.daysLeft <= 7) return `<span class="px-2 py-0.5 rounded text-xs text-white" style="background:#D97706">T-${it.daysLeft} 天</span>`;
  return `<span class="px-2 py-0.5 rounded text-xs text-white" style="background:var(--nec-cyan)">${esc(it.status || "进行中")}</span>`;
}

function goalsSection(g) {
  if (!g || !g.configured) return "";
  const items = g.items ?? [];
  const timeline = items.length ? items.map(it => `
    <a href="${esc(it.link)}" target="_blank" class="block border rounded-lg p-3 hover:shadow-md transition ${it.overdue ? "border-red-300 bg-red-50" : "border-gray-100"}">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="mono text-xs ${it.overdue ? "text-red-600 font-bold" : "text-gray-400"} whitespace-nowrap">${fmtDashDate(it.deadline)}</span>
        <span class="font-medium text-sm flex-1 min-w-0 truncate">${esc(it.title)}</span>
        ${goalStatusBadge(it)}
      </div>
      ${it.kr ? `<p class="text-xs text-gray-500 mt-1 truncate">关键结果：${esc(it.kr)}</p>` : ""}
      <div class="flex items-center gap-2 mt-2">
        <span class="text-xs text-gray-400 w-16 shrink-0">${esc(it.group)}</span>
        <div class="flex-1 h-2 rounded bg-gray-100 overflow-hidden">
          <div style="width:${(it.progress ?? 0).toFixed(0)}%;height:100%;background:${goalBarColor(it)}"></div>
        </div>
        <span class="mono text-xs text-gray-500 w-10 text-right shrink-0">${it.progress === null ? "—" : Math.round(it.progress) + "%"}</span>
      </div>
    </a>`).join("") : `<p class="text-sm text-gray-400">赛季目标表暂无数据</p>`;

  const byGroup = (g.byGroup ?? []).map(b => `
    <div class="flex items-center gap-2">
      <span class="text-xs text-gray-500 w-16 shrink-0 truncate">${esc(b.name)}</span>
      <div class="flex-1 h-3 rounded bg-gray-100 overflow-hidden">
        <div style="width:${b.avg}%;height:100%;background:${b.avg >= 100 ? "var(--nec-navy)" : "var(--nec-cyan)"}"></div>
      </div>
      <span class="mono text-xs text-gray-500 w-16 shrink-0">${b.avg}% · ${b.count} 项</span>
    </div>`).join("");

  return `
    <div class="bg-white rounded-xl shadow p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold">赛季目标</h3>
        <div class="text-xs">
          ${g.overdueCount ? `<span class="px-2 py-0.5 rounded text-white font-bold" style="background:#DC2626">⚠ ${g.overdueCount} 项逾期未达标</span>` : ""}
          <span class="text-gray-400 ml-2">${g.total ?? 0} 项目标</span>
        </div>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <p class="text-xs text-gray-400 mb-2">里程碑时间线（按截止升序，点击跳转多维表格原始行）</p>
          <div class="space-y-2 max-h-96 overflow-y-auto pr-1">${timeline}</div>
        </div>
        <div>
          <p class="text-xs text-gray-400 mb-2">各组平均完成度</p>
          <div class="space-y-2">${byGroup || '<p class="text-sm text-gray-400">暂无分组数据</p>'}</div>
        </div>
      </div>
    </div>`;
}

/** T-7 关键节点顶部提醒条：未达标且 0 ≤ 剩余天数 ≤ 7 的目标；逾期目标一并红色置顶。
 *  ✕ 关闭后记住当前内容签名，内容不变时不再弹出；但有目标进入 T-3 以内时强制重弹，避免关键节点被误关丢失 */
const GOAL_BANNER_DISMISS_KEY = "nec_goal_banner_dismiss";
let GOAL_BANNER_ITEMS = [];
function goalBannerSig(items) {
  return items.map(it => `${it.title}@${it.daysLeft}`).join("|");
}
function dismissGoalBanner() {
  try { localStorage.setItem(GOAL_BANNER_DISMISS_KEY, goalBannerSig(GOAL_BANNER_ITEMS)); } catch {}
  document.getElementById("goal-banner")?.classList.add("hidden");
}
function renderGoalBanner(g) {
  const banner = document.getElementById("goal-banner");
  if (!banner) return;
  const items = (g && g.configured ? g.items ?? [] : []).filter(it => !it.done && it.daysLeft !== null && it.daysLeft <= 7);
  if (!items.length) { banner.classList.add("hidden"); return; }
  GOAL_BANNER_ITEMS = items;
  let dismissed = "";
  try { dismissed = localStorage.getItem(GOAL_BANNER_DISMISS_KEY) || ""; } catch {}
  const hasCritical = items.some(it => it.daysLeft <= 3);
  if (!hasCritical && dismissed && dismissed === goalBannerSig(items)) return; // 已关闭且内容未变，保持隐藏
  const text = document.getElementById("goal-banner-text");
  text.innerHTML = items.map(it => {
    const label = it.overdue
      ? `<b style="color:#FCA5A5">已逾期 ${Math.abs(it.daysLeft)} 天</b>`
      : `<b>T-${it.daysLeft} 天</b>`;
    return `<a href="${esc(it.link)}" target="_blank" class="hover:underline">${label} · ${esc(it.title)}（${esc(it.group)} ${it.progress === null ? "" : Math.round(it.progress) + "%"}）</a>`;
  }).join('<span class="mx-2 text-white/30">｜</span>');
  banner.classList.remove("hidden");
}

function renderDashboard(d) {
  const box = document.getElementById("dash-body");
  const status = document.getElementById("dash-status");
  if (!d.configured) {
    renderGoalBanner(null);
    status.textContent = "数据源未配置";
    box.innerHTML = `
      <div class="bg-white rounded-xl shadow p-6 text-sm text-gray-600 space-y-3">
        <p>📊 数据源为飞书多维表格（队员名单 / 任务进度 / 物资台账 / 财务报销），尚未接入。</p>
        <p>把下面的 Prompt 发给你已接入 nec-hub MCP 的 Agent，即可完成配置：</p>
        <pre class="prompt text-sm bg-gray-900 text-green-300 rounded-lg p-4" id="dash-prompt"></pre>
        <button onclick="copyText('dash-prompt')" class="text-sm text-white px-3 py-1.5 rounded" style="background:var(--nec-navy)">复制配置 Prompt</button>
      </div>`;
    document.getElementById("dash-prompt").textContent = DASH_CONFIG_PROMPT;
    return;
  }

  const stat = (label, value, extra) => `
    <div class="bg-white rounded-xl shadow p-5">
      <div class="text-xs text-gray-400">${label}</div>
      <div class="text-3xl font-black mt-1" style="color:var(--nec-navy)">${esc(value ?? "—")}</div>
      ${extra ? `<div class="text-xs text-gray-400 mt-1">${extra}</div>` : ""}
    </div>`;
  const errNote = (e) => e ? `<div class="text-xs text-amber-600 mt-2">⚠ ${esc(e)}</div>` : "";

  const finVis = d.finance?.visibility ?? "full"; // 旧版后端无该字段时按 full 处理
  // 任务完成率：按状态名归类（取消/关闭也算已终结），逾期数来自后端全量统计
  const doneStates = (d.tasks?.byStatus ?? []).filter(s => DASH_STATUS_RE.done.test(s.name) || DASH_STATUS_RE.cancel.test(s.name));
  const doneCount = doneStates.reduce((a, s) => a + s.count, 0);
  const taskTotal = d.tasks?.total ?? 0;
  const taskExtra = [
    taskTotal ? `完成率 ${Math.round(doneCount / taskTotal * 100)}%` : "",
    d.tasks?.overdueCount ? `<span class="text-red-500 font-bold">逾期 ${d.tasks.overdueCount} 项</span>` : "",
  ].filter(Boolean).join(" · ");
  // 报销卡：full 显示合计 + 本月环比；summary（队员）只显示笔数，不公开金额
  const fin = d.finance ?? {};
  const mom = fin.prevMonthAmount > 0
    ? ` · 环比 ${fin.monthAmount >= fin.prevMonthAmount ? "+" : ""}${Math.round((fin.monthAmount - fin.prevMonthAmount) / fin.prevMonthAmount * 100)}%`
    : "";
  const cards = [
    stat("在队队员", d.members?.total, d.members?.byGroup?.slice(0, 3).map(g => `${esc(g.name)} ${g.count}`).join(" · ")),
    stat("任务总数", d.tasks?.total, taskExtra || d.tasks?.byStatus?.map(s => `${esc(s.name)} ${s.count}`).join(" · ")),
    stat("物资种类", d.inventory?.kinds, d.inventory?.totalQty != null ? `共 ${esc(String(d.inventory.totalQty))} 件` : ""),
    finVis === "hidden"
      ? stat("报销合计", "登录可见", "队员可见笔数 · 金额仅队长/财务")
      : finVis === "summary"
        ? stat("本月报销", `${fin.monthCount ?? fin.records ?? 0} 笔`, "金额合计仅队长/财务可见")
        : stat("报销合计（元）", fmtMoney(fin.totalAmount), `${fin.records ?? 0} 笔 · 本月 ¥${fmtMoney(fin.monthAmount ?? 0)}${mom}`),
  ].join("");

  const total = d.tasks?.total ?? 0;
  const st = d.tasks?.byStatus ?? [];
  const statusBar = total && st.length ? `
    <div class="flex h-3 rounded overflow-hidden bg-gray-100">
      ${st.map(s => `<div style="width:${(s.count / total * 100).toFixed(1)}%;background:${dashStatusColor(s.name)}" title="${esc(s.name)} ${s.count}"></div>`).join("")}
    </div>
    <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
      ${st.map(s => `<span class="inline-flex items-center"><i class="not-italic inline-block w-2.5 h-2.5 rounded-sm mr-1" style="background:${dashStatusColor(s.name)}"></i>${esc(s.name)} ${s.count}</span>`).join("")}
    </div>` : `<p class="text-sm text-gray-400">暂无任务数据</p>`;

  // 逾期判定在前端做：用本地时区的今日零点，避免服务器时区漂移
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayStartTs = dayStart.getTime();
  const upcomingRows = (d.tasks?.upcoming ?? []).map(t => {
    const overdue = typeof t.deadline === "number" && t.deadline < dayStartTs;
    const title = t.link
      ? `<a href="${esc(t.link)}" target="_blank" class="hover:underline" style="color:var(--nec-cyan)">${esc(t.title || "—")}</a>`
      : esc(t.title || "—");
    return `
    <tr class="border-t border-gray-100 ${overdue ? "bg-red-50" : ""}">
      <td class="py-2 pr-3">${title}${overdue ? ' <span class="px-1.5 py-0.5 rounded text-[10px] text-white font-bold" style="background:#DC2626">已逾期</span>' : ""}</td>
      <td class="py-2 pr-3 text-gray-500 whitespace-nowrap">${esc(t.owner || "—")}</td>
      <td class="py-2 pr-3 whitespace-nowrap"><span class="px-2 py-0.5 rounded text-xs text-white" style="background:${dashStatusColor(t.status)}">${esc(t.status || "未标注")}</span></td>
      <td class="py-2 mono text-xs whitespace-nowrap ${overdue ? "text-red-600 font-bold" : "text-gray-400"}">${fmtDashDate(t.deadline)}</td>
    </tr>`;
  }).join("");
  const upcomingTable = upcomingRows ? `
    <p class="text-xs text-gray-400 mt-3">即将到期（点击任务名跳转飞书原始记录）</p>
    <div class="overflow-x-auto">
    <table class="w-full text-sm mt-1">
      <thead><tr class="text-left text-xs text-gray-400">
        <th class="pb-1 font-medium">任务</th><th class="pb-1 font-medium">负责人</th><th class="pb-1 font-medium">状态</th><th class="pb-1 font-medium">截止</th>
      </tr></thead>
      <tbody>${upcomingRows}</tbody>
    </table></div>` : "";

  DASH_INV_ITEMS = d.inventory?.items ?? [];
  const invTable = DASH_INV_ITEMS.length ? `
    <input id="inv-search" oninput="renderInvRows(this.value)" placeholder="搜索物料 / 库位…" class="w-full border rounded px-2 py-1.5 text-sm mb-2" />
    <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead><tr class="text-left text-xs text-gray-400">
        <th class="pb-1 font-medium">物料</th><th class="pb-1 font-medium">数量</th><th class="pb-1 font-medium">位置</th>
      </tr></thead>
      <tbody id="inv-tbody">${DASH_INV_ITEMS.map(invRowHtml).join("")}</tbody>
    </table></div>` : `<p class="text-sm text-gray-400">暂无物资数据</p>`;

  const finList = (d.finance?.recent ?? []).map(f => `
    <li class="flex items-baseline gap-2 py-1.5 border-t border-gray-100 text-sm">
      <span class="text-gray-400 mono text-xs whitespace-nowrap">${fmtDashDate(f.date)}</span>
      <span class="flex-1 truncate">${esc(f.name)}${f.applicant ? `<i class="not-italic text-xs text-gray-400 ml-1">${esc(f.applicant)}</i>` : ""}</span>
      <span class="mono text-xs whitespace-nowrap text-right">${f.amount != null ? "¥" + fmtMoney(f.amount) : "—"}</span>
    </li>`).join("");
  const finBody = finVis === "full"
    ? (finList ? `<ul>${finList}</ul>` : `<p class="text-sm text-gray-400">暂无报销数据</p>`)
    : finVis === "summary"
      ? `<p class="text-sm text-gray-400">本月已报销 <b style="color:var(--nec-navy)">${d.finance?.monthCount ?? d.finance?.records ?? 0}</b> 笔 · 金额明细仅队长/财务角色可见。</p>`
      : `<p class="text-sm text-gray-400">报销数据登录后可见：队员可见笔数，金额明细仅队长/财务。</p>`;

  status.textContent = `更新于 ${new Date(d.generatedAt).toLocaleTimeString("zh-CN")}${d.stale ? "（缓存快照）" : ""} · 缓存 5 分钟`;

  box.innerHTML = `
    ${goalsSection(d.goals)}
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">${cards}</div>
    ${d.members?.error ? `<div class="text-xs text-amber-600">⚠ 队员名单：${esc(d.members.error)}</div>` : ""}
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="bg-white rounded-xl shadow p-5">
        <h3 class="font-bold mb-3">任务进度</h3>
        ${statusBar}
        ${upcomingTable}
        ${errNote(d.tasks?.error)}
      </div>
      <div class="bg-white rounded-xl shadow p-5">
        <h3 class="font-bold mb-3">物资台账</h3>
        ${invTable}
        ${(d.inventory?.kinds ?? 0) > (d.inventory?.items?.length ?? 0) ? `<p class="text-xs text-gray-400 mt-2">仅展示前 50 条</p>` : ""}
        ${errNote(d.inventory?.error)}
      </div>
    </div>
    <div class="bg-white rounded-xl shadow p-5">
      <h3 class="font-bold mb-2">最近报销</h3>
      ${finBody}
      ${errNote(d.finance?.error)}
    </div>
    ${reimburseCard()}
    ${myReimburseCard()}
    <p class="text-xs text-gray-400">数据源：飞书多维表格（base ${esc(d.base)}）· 队员名单 / 任务进度 / 物资台账 / 财务报销${d.goals?.configured ? " / 赛季目标" : ""} · 5 分钟缓存 · 财务区按登录角色脱敏</p>
  `;
  mountReimburse();
  mountMyReimburse();
  renderGoalBanner(d.goals);
}


// ===== 报销提交：报销时间 + 单据/付款凭证 OCR 识别（Tesseract.js 本地识别，不上传第三方） =====
// 表单挂在持久节点上：看板每次刷新都会 innerHTML 重建 dash-body，这里把表单节点"移动"进新插槽，
// 避免用户填到一半被重渲染清空（dataset.authed 记录登录态，登录/登出时才重建节点）
let REIMBURSE_NODE = null;
function reimburseCard() {
  // 低频写操作折叠为可展开卡，默认收起；展开状态存 localStorage，刷新后保持
  const open = (() => { try { return localStorage.getItem("nec_reimburse_open") === "1"; } catch { return false; } })();
  return `<details class="bg-white rounded-xl shadow" ${open ? "open" : ""}>
    <summary class="cursor-pointer select-none p-5 font-bold flex items-center justify-between" style="list-style:none" onclick="try{localStorage.setItem('nec_reimburse_open',this.parentElement.open?'0':'1')}catch(e){}">
      <span>🧾 提交报销</span>
      <span class="text-xs text-gray-400 font-normal">点击展开 · 发票/凭证 OCR 自动识别回填</span>
    </summary>
    <div id="reimburse-slot" class="px-5 pb-5"></div>
  </details>`;
}
function mountReimburse() {
  const slot = document.getElementById('reimburse-slot');
  if (!slot) return;
  const authed = !!(ME && ME.authenticated);
  if (REIMBURSE_NODE && REIMBURSE_NODE.dataset.authed === String(authed)) {
    slot.appendChild(REIMBURSE_NODE);
    return;
  }
  const wrap = document.createElement('div');
  wrap.innerHTML = authed ? reimburseFormHtml() :
    '<div class="text-sm text-gray-500">🔐 登录后可在线提交报销：上传发票图片/PDF 自动识别金额、日期与发票号，识别均在本地完成。</div>';
  REIMBURSE_NODE = wrap.firstElementChild;
  REIMBURSE_NODE.dataset.authed = String(authed);
  slot.appendChild(REIMBURSE_NODE);
  const form = REIMBURSE_NODE.querySelector('#reimburse-form');
  if (form) {
    form.addEventListener('input', queueReimburseDraft);
    restoreReimburseDraft();
  }
}

// 草稿持久化：文本字段防抖写入 localStorage，刷新/误关页面后可恢复（文件选择无法持久化，需重传）
const REIMBURSE_DRAFT_KEY = 'nec_reimburse_draft';
let _reimburseDraftTimer = null;
function queueReimburseDraft() {
  clearTimeout(_reimburseDraftTimer);
  _reimburseDraftTimer = setTimeout(() => {
    const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    const draft = { item: g('r-item'), amount: g('r-amount'), date: g('r-date'), invno: g('r-invno'), note: g('r-note'), savedAt: Date.now() };
    try {
      if (draft.item || draft.amount || draft.invno || draft.note) {
        localStorage.setItem(REIMBURSE_DRAFT_KEY, JSON.stringify(draft));
      } else {
        localStorage.removeItem(REIMBURSE_DRAFT_KEY);
      }
    } catch { /* 隐私模式等场景写不进就跳过 */ }
  }, 400);
}
function restoreReimburseDraft() {
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(REIMBURSE_DRAFT_KEY) || 'null'); } catch { return; }
  if (!draft) return;
  const put = (id, v) => {
    const el = document.getElementById(id);
    if (el && v) { el.value = v; el.dataset.ocr = ''; }
  };
  put('r-item', draft.item); put('r-amount', draft.amount);
  put('r-date', draft.date); put('r-invno', draft.invno); put('r-note', draft.note);
  const st = document.getElementById('r-submit-status');
  if (st && (draft.item || draft.amount || draft.invno || draft.note)) {
    st.textContent = '📝 已恢复 ' + new Date(draft.savedAt).toLocaleString('zh-CN') + ' 的未提交草稿（凭证文件需重新上传）';
  }
}
function clearReimburseDraft() {
  clearTimeout(_reimburseDraftTimer);
  try { localStorage.removeItem(REIMBURSE_DRAFT_KEY); } catch {}
}
function reimburseFormHtml() {
  const today = new Date().toLocaleDateString('sv-SE'); // 本地时区 YYYY-MM-DD
  const rows = [
  '<div>',
    '<form id="reimburse-form" class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm" onsubmit="return submitReimburse(event)">',
    F('事项', '<input id="r-item" required class="mt-1 w-full border rounded px-2 py-1.5" placeholder="如：元器件采购" />'),
    F('金额（元）', '<input id="r-amount" required inputmode="decimal" class="mt-1 w-full border rounded px-2 py-1.5" placeholder="上传凭证后自动识别，可修改" oninput="this.dataset.ocr=\'\';this.classList.remove(\'ocr-filled\')" />'),
    // data-ocr="1" 表示当前值是自动生成的（默认可被 OCR 覆盖），用户一旦手动编辑即清除该标记与高亮
    F('报销时间', '<input id="r-date" type="date" required class="mt-1 w-full border rounded px-2 py-1.5" data-ocr="1" value=' + today + ' oninput="this.dataset.ocr=\'\';this.classList.remove(\'ocr-filled\')" />'),
    F('发票号（选填）', '<input id="r-invno" class="mt-1 w-full border rounded px-2 py-1.5" placeholder="上传发票后自动识别，可修改" oninput="this.dataset.ocr=\'\';this.classList.remove(\'ocr-filled\')" />'),
    F('备注（选填）', '<input id="r-note" class="mt-1 w-full border rounded px-2 py-1.5" />'),
    F('上传单据', '<input id="r-receipt" type="file" class="mt-1 w-full text-xs" accept="image/*,application/pdf" onchange="recognizeFile(this, 1)">' + '<div id=r-receipt-status aria-live="polite" class="text-xs text-gray-400 mt-1">发票/收据图片或 PDF 自动识别金额、日期与发票号（≤10MB）</div>'),
    F('付款凭证', '<input id="r-payment" type="file" class="mt-1 w-full text-xs" accept="image/*,application/pdf" onchange="recognizeFile(this, 2)">' + '<div id=r-payment-status aria-live="polite" class="text-xs text-gray-400 mt-1">微信/支付宝付款截图可识别金额（≤10MB）</div>'),
    '<div class="md:col-span-2" style="display:flex;gap:12px;align-items:center">',
      '<button id="r-submit-btn" class="hover:opacity-90 disabled:opacity-50 transition-opacity" style="background:var(--nec-navy);color:#fff;padding:8px 16px;border-radius:6px">提交报销</button>',
      '<span id=r-submit-status aria-live="polite" class="text-xs text-gray-400"></span>',
    '</div>',
    '</form>',
  '</div>'];
  return rows.join('');
}
function F(label, inner) {
  return '<label class="block" style="font-size:14px">' + label + '<div style="margin-top:4px">' + inner + '</div></label>';
}

// OCR 引擎配置（CDN 常量与 injectScript 见 shared/api.js）
const TESS_OPTS = {
  workerPath: CDN_FASTLY + '/tesseract.js@5/dist/worker.min.js',
  corePath: CDN_FASTLY + '/tesseract.js-core@5',
  langPath: 'https://tessdata.projectnaptha.com/4.0.0',
};

let _tessLoading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!_tessLoading) {
    _tessLoading = injectScript(CDN_FASTLY + '/tesseract.js@5/dist/tesseract.min.js')
      .catch(() => injectScript(CDN_JSDELIVR + '/tesseract.js@5/dist/tesseract.min.js'))
      .then(() => window.Tesseract)
      .catch(() => { _tessLoading = null; throw new Error('识别引擎加载失败（网络）'); });
  }
  return _tessLoading;
}

let _pdfLoading = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!_pdfLoading) {
    _pdfLoading = injectScript(CDN_FASTLY + '/pdfjs-dist@3.11.174/build/pdf.min.js')
      .catch(() => injectScript(CDN_JSDELIVR + '/pdfjs-dist@3.11.174/build/pdf.min.js'))
      .then(() => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN_FASTLY + '/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        return window.pdfjsLib;
      })
      .catch(() => { _pdfLoading = null; throw new Error('PDF 解析组件加载失败（网络）'); });
  }
  return _pdfLoading;
}

/** PDF → 逐页渲染成 canvas → Tesseract 识别（最多前 3 页，全电发票通常 1 页） */
async function ocrPdfText(file, Tesseract, st) {
  const pdfjsLib = await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = Math.min(pdf.numPages, 3);
  let text = '';
  for (let p = 1; p <= pages; p++) {
    st.textContent = '🔍 PDF 识别中（第 ' + p + '/' + pages + ' 页，首次需加载识别引擎）…';
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const res = await Tesseract.recognize(canvas, 'chi_sim+eng', TESS_OPTS);
    text += '\n' + ((res && res.data && res.data.text) || '');
  }
  return text;
}

/** 从 OCR 文本里提取金额、日期与发票号（发票/收据/付款截图的常见版式） */
function parseFinanceText(text) {
  const t = String(text || '').replace(/[，\s]/g, '');
  const out = {};
  const amtPatterns = [
    /[（(]小写[)）][^0-9]{0,8}(\d{1,7}(?:\.\d{1,2})?)/,
    /价税合计[^0-9]{0,25}(\d{1,7}(?:\.\d{1,2})?)/,
    /(?:合计|总计|实付|金额|付款|支付)\D{0,6}(\d{1,7}(?:\.\d{1,2})?)/,
    /[¥￥]\s*(\d{1,7}(?:\.\d{1,2})?)/
  ];
  for (const re of amtPatterns) { const m = t.match(re); if (m) { out.amount = m[1]; break; } }
  const di = t.match(/开票日期\D{0,4}(20\d{2})[-\/年.]?(\d{1,2})[-\/月.]?(\d{1,2})/);
  const d = di || t.match(/(20\d{2})[-\/年.](\d{1,2})[-\/月.](\d{1,2})/);
  if (d) out.date = d[1] + '-' + String(d[2]).padStart(2, '0') + '-' + String(d[3]).padStart(2, '0');
  const inv = t.match(/发票号码\D{0,4}(\d{20}|\d{8})/) || t.match(/\b(\d{20})\b/);
  if (inv) out.invno = inv[1];
  return out;
}

/** OCR 回填守卫：字段为空、或当前值来自上一次 OCR/默认值（data-ocr=1）时才写入，不覆盖用户手改 */
function ocrFill(id, value) {
  const el = document.getElementById(id);
  if (!el || !value) return false;
  if (el.value && el.dataset.ocr !== '1') return false;
  el.value = value;
  el.dataset.ocr = '1';
  el.classList.add('ocr-filled');
  return true;
}

let _ocrRunning = 0; // 进行中的 OCR 任务数，提交时用于拦截
async function recognizeFile(input, kind) {
  const st = document.getElementById(kind === 1 ? 'r-receipt-status' : 'r-payment-status');
  const f = input.files && input.files[0];
  if (!f) return;
  if (f.size > 10 * 1024 * 1024) {
    st.textContent = '⚠ 文件超过 10MB 上限，请压缩后再上传';
    input.value = '';
    return;
  }
  _ocrRunning++;
  st.textContent = '🔍 识别中（首次需加载识别引擎，约十几秒）…';
  try {
    const Tesseract = await loadTesseract();
    let text;
    if (f.type === 'application/pdf') {
      text = await ocrPdfText(f, Tesseract, st);
    } else {
      const res = await Tesseract.recognize(f, 'chi_sim+eng', Object.assign({}, TESS_OPTS, {
        logger: m => { if (m.status === 'recognizing text') st.textContent = '🔍 识别中 ' + Math.round(m.progress * 100) + '%…'; }
      }));
      text = res && res.data && res.data.text;
    }
    const found = parseFinanceText(text);
    const hints = [];
    const skipped = [];
    if (found.amount) (ocrFill('r-amount', found.amount) ? hints : skipped).push('金额 ¥' + found.amount);
    if (found.date) (ocrFill('r-date', found.date) ? hints : skipped).push('日期 ' + found.date);
    if (found.invno && kind === 1) (ocrFill('r-invno', found.invno) ? hints : skipped).push('发票号 ' + found.invno);
    st.textContent = (hints.length ? '✅ 已识别回填：' + hints.join(' · ') : '')
      + (skipped.length ? (hints.length ? '；' : '') + '识别到 ' + skipped.join(' · ') + '，因已手动填写未覆盖' : '')
      + (hints.length || skipped.length ? '（可手动修改）' : '⚠ 未识别到有效信息，请手动填写');
  } catch (e) {
    st.textContent = '⚠ 识别失败：' + (e.message || e) + '，请手动填写';
  } finally {
    _ocrRunning--;
  }
}

async function submitReimburse(ev) {
  ev.preventDefault();
  const st = document.getElementById('r-submit-status');
  const btn = document.getElementById('r-submit-btn');
  if (btn.disabled) return;
  if (_ocrRunning > 0) {
    st.textContent = '⏳ 凭证识别仍在进行，请稍候几秒再提交';
    return false;
  }
  const amountStr = document.getElementById('r-amount').value.trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(amountStr)) {
    st.textContent = '⚠ 金额格式不正确：应为数字，最多两位小数';
    document.getElementById('r-amount').focus();
    return false;
  }
  const fd = new FormData();
  fd.set('item', document.getElementById('r-item').value.trim());
  fd.set('amount', amountStr);
  fd.set('date', document.getElementById('r-date').value);
  fd.set('note', document.getElementById('r-note').value.trim());
  fd.set('invno', document.getElementById('r-invno').value.trim());
  const r1 = document.getElementById('r-receipt').files[0];
  const r2 = document.getElementById('r-payment').files[0];
  if (r1) fd.set('receipt', r1);
  if (r2) fd.set('payment', r2);
  btn.disabled = true;
  btn.textContent = '提交中…';
  st.textContent = '提交中…';
  try {
    const resp = await fetch('/api/reimburse', { method: 'POST', body: fd });
    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || ('HTTP ' + resp.status));
    st.textContent = '✅ 已提交' + (data.recordId ? '，已写入财务报销表' : '') + (data.warning ? '；⚠ ' + data.warning : '');
    clearReimburseDraft();
    document.getElementById('reimburse-form').reset();
    ['r-amount', 'r-invno'].forEach(id => {
      const el = document.getElementById(id);
      el.dataset.ocr = '';
      el.classList.remove('ocr-filled');
    });
    const dateEl = document.getElementById('r-date');
    dateEl.value = new Date().toLocaleDateString('sv-SE');
    dateEl.dataset.ocr = '1';
    dateEl.classList.remove('ocr-filled');
    document.getElementById('r-receipt-status').textContent = '发票/收据图片或 PDF 自动识别金额、日期与发票号（≤10MB）';
    document.getElementById('r-payment-status').textContent = '微信/支付宝付款截图可识别金额（≤10MB）';
    loadDashboard();
  } catch (e) {
    st.textContent = '❌ 提交失败：' + (e.message || e);
  } finally {
    btn.disabled = false;
    btn.textContent = '提交报销';
  }
  return false;
}

function loadDashboard(fresh) {
  const btn = document.getElementById("dash-refresh");
  if (fresh && btn) { btn.disabled = true; btn.textContent = "刷新中…"; }
  const done = () => { if (btn) { btn.disabled = false; btn.textContent = "⟳ 刷新"; } };
  fetch("/api/dashboard" + (fresh ? "?fresh=1" : "")).then(r => r.json()).then(d => { renderDashboard(d); done(); }).catch(() => {
    document.getElementById("dash-body").innerHTML =
      `<div class="bg-white rounded-xl shadow p-6 text-sm text-red-500">看板加载失败，请稍后重试。</div>`;
    done();
  });
}

// ===== 我的报销（R-01）：GET /api/approvals/mine?type=reimburse（Plan B 审批引擎；登录后可见） =====
// 与报销表单同为持久节点：看板每次刷新都会重建 dash-body，避免渲染抖动清空列表
let MY_REIMBURSE_NODE = null;
function myReimburseCard() {
  return '<div id="my-reimburse-slot"></div>';
}
function mountMyReimburse() {
  const slot = document.getElementById('my-reimburse-slot');
  if (!slot) return;
  if (!MY_REIMBURSE_NODE) {
    const wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="bg-white rounded-xl shadow p-5">' +
        '<h3 class="font-bold mb-3">我的报销</h3>' +
        '<div id="my-rb-list" class="text-sm text-gray-400">加载中…</div>' +
        '<p class="text-xs text-gray-400 mt-2">审批由财务/队长在飞书处理，结果在群里通知；流程未配置时此列表为空。</p>' +
      '</div>';
    MY_REIMBURSE_NODE = wrap.firstElementChild;
  }
  slot.appendChild(MY_REIMBURSE_NODE);
  renderMyReimburseList();
}
function renderMyReimburseList() {
  const box = document.getElementById('my-rb-list');
  if (!box) return;
  if (!(ME && ME.authenticated)) { box.innerHTML = '<p class="text-gray-400">登录后可见。</p>'; return; }
  box.innerHTML = '加载中…';
  fetch('/api/approvals/mine?type=reimburse').then(r => {
    if (r.status === 401) return { __unauthorized: true };
    return r.json();
  }).then(d => {
    if (d.__unauthorized) { box.innerHTML = '<p class="text-gray-400">登录后可见。</p>'; return; }
    if (d.hint && !(d.records ?? []).length) { box.innerHTML = `<p class="text-gray-400">${esc(d.hint)}</p>`; return; }
    const rows = d.records ?? [];
    if (!rows.length) { box.innerHTML = '<p class="text-gray-400">暂无记录</p>'; return; }
    box.innerHTML = `
      <div class="overflow-x-auto">
      <table class="w-full">
        <thead><tr class="text-left text-xs text-gray-400">
          <th class="pb-2 font-medium">单号</th><th class="pb-2 font-medium">事项</th>
          <th class="pb-2 font-medium">金额</th><th class="pb-2 font-medium">状态</th><th class="pb-2 font-medium">提交时间</th>
        </tr></thead>
        <tbody>${rows.map(r => {
          const f = r.fields ?? {};
          const badge = `<span class="px-2 py-0.5 rounded text-xs text-white" style="background:${dashStatusColor(r.status)}">${esc(r.status || "—")}</span>`;
          const note = r.status === "审批中" ? `<span class="text-xs text-gray-400 ml-1">通过后可在群里收到通知</span>` : "";
          return `<tr class="border-t border-gray-100">
            <td class="py-2 pr-3 mono text-xs whitespace-nowrap">${esc(f.申请单号 || r.application_id || "—")}</td>
            <td class="py-2 pr-3">${esc(f.事项 || "—")}</td>
            <td class="py-2 pr-3 mono whitespace-nowrap text-right">${f.金额 != null ? "¥" + fmtMoney(f.金额) : "—"}</td>
            <td class="py-2 pr-3 whitespace-nowrap">${badge}${note}</td>
            <td class="py-2 text-gray-400 text-xs whitespace-nowrap">${f.提交时间 ? new Date(f.提交时间).toLocaleDateString("zh-CN") : "—"}</td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>`;
  }).catch(() => { box.innerHTML = '<p class="text-red-500">加载失败，请稍后重试。</p>'; });
}

// ===== FE-05 数据健康：最新校验报告展示 + 手动触发（mine 所有登录用户 / all 仅队长·组长） =====
function isLeader() {
  return !!(ME.authenticated && ME.user && /队长|组长/.test(ME.user.role || ""));
}

async function loadValidateHealth() {
  const box = document.getElementById("dash-health");
  if (!box) return;
  if (!ME.authenticated) {
    box.innerHTML = `<div class="bg-white rounded-xl shadow p-5 text-sm text-gray-500">🩺 数据健康：登录后可查看校验报告并触发校验（队员校验自己的数据，队长/组长可全量校验）。</div>`;
    return;
  }
  let report = null;
  try {
    const resp = await fetch("/api/validate/report");
    if (resp.ok) report = await resp.json();
  } catch { /* 报告读取失败按空处理 */ }
  renderValidateHealth(report && !report.empty ? report : null);
}

function renderValidateHealth(report) {
  const box = document.getElementById("dash-health");
  if (!box) return;
  const btns = `
    <button onclick="runValidate('mine')" id="vh-btn-mine" class="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600">校验我的数据</button>
    ${isLeader() ? `<button onclick="runValidate('all')" id="vh-btn-all" class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:var(--nec-navy)">全量校验</button>` : ""}`;
  if (!report) {
    box.innerHTML = `
      <div class="bg-white rounded-xl shadow p-5">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-bold">数据健康</h3>
          <div class="flex gap-2">${btns}</div>
        </div>
        <p class="text-sm text-gray-400">暂无校验报告：点「校验我的数据」立即跑一次，或等每周一 08:00 自动巡检（摘要推送飞书群）。</p>
      </div>`;
    return;
  }
  const groups = (report.byType ?? []).map(t => {
    const items = report.violations.filter(v => v.type === t.type).slice(0, 20).map(v => `
      <li class="py-1.5 border-t border-gray-100 text-sm">
        <div class="flex items-baseline gap-2 flex-wrap">
          <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">${esc(v.table)}</span>
          <span class="text-gray-600">字段「${esc(v.field)}」${v.value ? `=${esc(v.value)}` : "为空"}</span>
          <a href="${esc(v.link)}" target="_blank" class="text-xs hover:underline" style="color:var(--nec-cyan)">打开记录 →</a>
        </div>
        <p class="text-xs text-gray-400 mt-0.5">建议：${esc(v.suggestion)}</p>
      </li>`).join("");
    return `
      <div class="mt-3">
        <p class="text-sm font-medium text-slate-700">${esc(t.type)} <span class="text-xs text-gray-400">× ${t.count}</span></p>
        <ul>${items}</ul>
      </div>`;
  }).join("");
  box.innerHTML = `
    <div class="bg-white rounded-xl shadow p-5">
      <div class="flex items-center justify-between mb-2">
        <h3 class="font-bold">数据健康</h3>
        <div class="flex gap-2">${btns}</div>
      </div>
      <p class="text-xs text-gray-400 mb-1">${report.scopeNote ? esc(report.scopeNote) : `上次全量校验：${report.generatedAt ? new Date(report.generatedAt).toLocaleString("zh-CN") : "—"} · 每周一 08:00 自动巡检`} · 共 <b class="${report.total ? "text-red-600" : ""}" style="${report.total ? "" : "color:var(--nec-cyan)"}">${report.total}</b> 条异常</p>
      ${groups || '<p class="text-sm text-gray-400 mt-2">🎉 未发现异常，4 张底表数据全绿。</p>'}
      ${report.errors ? `<p class="text-xs text-amber-600 mt-2">⚠ ${Object.entries(report.errors).map(([t, e]) => `${esc(t)}：${esc(e)}`).join("；")}</p>` : ""}
    </div>`;
}

async function runValidate(scope) {
  const btn = document.getElementById(scope === "all" ? "vh-btn-all" : "vh-btn-mine");
  if (btn) { btn.disabled = true; btn.textContent = "校验中…"; }
  try {
    const resp = await fetch("/api/validate/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope }),
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || ("HTTP " + resp.status));
    if (scope === "all") {
      renderValidateHealth(data);
    } else {
      // mine：页内渲染结果（复用全量报告的条目样式，异常可直接点「打开记录」去改），不再用 alert
      const byType = {};
      (data.violations ?? []).forEach(v => { byType[v.type] = (byType[v.type] ?? 0) + 1; });
      renderValidateHealth({
        generatedAt: new Date().toISOString(),
        total: data.total ?? 0,
        violations: data.violations ?? [],
        byType: Object.entries(byType).map(([type, count]) => ({ type, count })),
        scopeNote: `本次校验范围：与你相关的数据（${new Date().toLocaleTimeString("zh-CN")}）`,
      });
    }
  } catch (e) {
    const box = document.getElementById("dash-health");
    if (box) box.innerHTML = `<div class="bg-white rounded-xl shadow p-5 text-sm text-red-500">校验失败：${esc(e.message || e)}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = scope === "all" ? "全量校验" : "校验我的数据"; }
  }
}

export { loadDashboard, loadValidateHealth, dashStatusColor, fmtDashDate, goalBarColor };

// 内联事件处理器（HTML 及动态生成 markup 的 onclick/oninput/onsubmit/onchange）需要全局可见
Object.assign(window, { loadDashboard, dismissGoalBanner, renderInvRows, submitReimburse, recognizeFile, runValidate });
