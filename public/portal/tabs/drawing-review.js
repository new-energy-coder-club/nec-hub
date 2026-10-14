// 图纸评审（原生集成，登录后可见）：自 index.html 内嵌脚本抽出
// 与 main.js 循环 import（applyHashRoute/getPendingHashTab），仅函数体内运行时使用（ES Module 活绑定，安全）
import { esc, apiDr } from "../shared/api.js";
import { ME } from "../shared/session.js";
import { applyHashRoute, getPendingHashTab } from "../main.js";

// ---------- 图纸评审（原生集成，登录后可见） ----------
const DR_STATUS = {
  draft: { label: "待提交", cls: "bg-gray-100 text-gray-600" },
  pending_review: { label: "待评审", cls: "bg-blue-50 text-blue-700" },
  in_review: { label: "评审中", cls: "bg-amber-50 text-amber-700" },
  rectifying: { label: "待整改", cls: "bg-orange-50 text-orange-700" },
  bom_generating: { label: "BOM生成中", cls: "bg-purple-50 text-purple-700" },
  assessing: { label: "评估中", cls: "bg-indigo-50 text-indigo-700" },
  scheduling: { label: "排期中", cls: "bg-pink-50 text-pink-700" },
  procuring: { label: "采购中", cls: "bg-teal-50 text-teal-700" },
  archived: { label: "已归档", cls: "bg-green-50 text-green-700" },
};
let DR_FILTER = "";
let DR_DATA = {};
let DR_MODE = "board";

/** 看板 / 列表 切换（共用同一份数据与状态筛选） */
function setDrMode(mode) {
  DR_MODE = mode;
  document.getElementById("dr-board").classList.toggle("hidden", mode !== "board");
  document.getElementById("dr-list").classList.toggle("hidden", mode !== "list");
  for (const m of ["board", "list"]) {
    const btn = document.getElementById(`dr-mode-${m}`);
    const on = m === mode;
    btn.classList.toggle("text-white", on);
    btn.classList.toggle("text-gray-600", !on);
    btn.style.background = on ? "var(--nec-navy)" : "";
  }
}

/** 看板卡片点击 → 切到列表并展开该评审单详情 */
function drOpen(reviewId) {
  setDrMode("list");
  const box = document.getElementById(`dr-detail-${reviewId}`);
  if (box && box.classList.contains("hidden")) toggleDrDetail(reviewId);
  const card = box && box.closest(".bg-white");
  if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** 登录门控：显示/隐藏「图纸评审」Tab 并加载数据 */
function updateDrawingReviewGate() {
  const btn = document.getElementById("tab-btn-drawing-review");
  const section = document.getElementById("tab-drawing-review");
  const authed = ME.authenticated && ME.user;
  btn.classList.toggle("hidden", !authed);
  if (authed) {
    const dn = document.getElementById("dr-designer-name");
    if (dn) dn.value = `${ME.user.name}（${ME.user.open_id}）`;
    setDrMode(DR_MODE);
    loadDrawingReviews();
  } else {
    if (!section.classList.contains("hidden")) {
      document.querySelector('[data-tab="apps"]').click();
    }
    setDrMode("list");
    document.getElementById("dr-list").innerHTML =
      `<p class="text-sm text-gray-400 bg-white rounded-xl shadow p-8 text-center">登录后可使用图纸评审流程</p>`;
    document.getElementById("dr-board").innerHTML = "";
    document.getElementById("dr-stats").innerHTML = "";
    const fb = document.getElementById("dr-flow-board");
    if (fb) fb.innerHTML = "";
    document.getElementById("dr-form-box").classList.add("hidden");
  }
  // 门控放开后重放暂存的深链（ST-02）
  if (authed && getPendingHashTab()) applyHashRoute();
}

function toggleDrForm() {
  document.getElementById("dr-form-box").classList.toggle("hidden");
}

// 联想功能相关变量
let suggestionTimeout;
let currentSuggestions = {
  project: [],
  machine: []
};

// 加载表单默认值
async function loadFormDefaults() {
  try {
    const data = await apiDr("/start");
    if (data.ok && data.defaults) {
      const f = document.getElementById("dr-form");
      if (data.defaults.projectId) f.projectId.value = data.defaults.projectId;
      if (data.defaults.machineName) f.machineName.value = data.defaults.machineName;
      if (data.defaults.drawingVersion) f.drawingVersion.value = data.defaults.drawingVersion;
      if (data.defaults.designNotes) f.designNotes.value = data.defaults.designNotes;
      
      // 显示提示
      const resultEl = document.getElementById("dr-form-result");
      resultEl.className = "mt-2 text-sm text-blue-600";
      resultEl.textContent = "✅ 已加载智能默认值";
      setTimeout(() => { resultEl.textContent = ""; }, 3000);
    }
  } catch (err) {
    console.error("加载默认值失败:", err);
  }
}

// 项目编号输入处理
function handleProjectInput(input) {
  clearTimeout(suggestionTimeout);
  const query = input.value.trim();
  
  if (query.length < 2) {
    hideProjectSuggestions();
    return;
  }
  
  suggestionTimeout = setTimeout(() => {
    fetchSuggestions(query, 'project', input);
  }, 300);
}

// 机型名称输入处理
function handleMachineInput(input) {
  clearTimeout(suggestionTimeout);
  const query = input.value.trim();
  
  if (query.length < 2) {
    hideMachineSuggestions();
    return;
  }
  
  suggestionTimeout = setTimeout(() => {
    fetchSuggestions(query, 'machine', input);
  }, 300);
}

// 获取联想建议
async function fetchSuggestions(query, type, input) {
  try {
    const projectId = type === 'machine' ? document.getElementById('dr-form').projectId.value : undefined;
    const url = `/api/drawing-review/suggestions?q=${encodeURIComponent(query)}&type=${type}${projectId ? '&projectId=' + encodeURIComponent(projectId) : ''}`;
    
    const data = await apiDr(url);
    if (data.ok && data.suggestions) {
      currentSuggestions[type] = data.suggestions;
      showSuggestions(type, input, data.suggestions);
    }
  } catch (err) {
    console.error("获取联想建议失败:", err);
  }
}

// 显示项目建议
function showProjectSuggestions(input) {
  const query = input.value.trim();
  if (query.length >= 2) {
    fetchSuggestions(query, 'project', input);
  }
}

// 显示机型建议
function showMachineSuggestions(input) {
  const query = input.value.trim();
  if (query.length >= 2) {
    fetchSuggestions(query, 'machine', input);
  }
}

// 显示联想建议
function showSuggestions(type, input, suggestions) {
  const container = document.getElementById(`${type}-suggestions`);
  if (!container) return;
  
  if (suggestions.length === 0) {
    container.classList.add('hidden');
    return;
  }
  
  container.innerHTML = suggestions.map(s => `
    <div class="px-3 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-100 last:border-b-0"
         onclick="selectSuggestion('${type}', '${s.value}')">
      <div class="text-sm font-medium text-gray-800">${s.label}</div>
      ${s.count ? `<div class="text-xs text-gray-500">使用 ${s.count} 次</div>` : ''}
    </div>
  `).join('');
  
  container.classList.remove('hidden');
}

// 选择联想建议
function selectSuggestion(type, value) {
  const form = document.getElementById('dr-form');
  if (type === 'project') {
    form.projectId.value = value;
    hideProjectSuggestions();
    // 项目选择后自动触发机型联想
    setTimeout(() => {
      const machineInput = form.machineName;
      if (machineInput.value.length >= 2) {
        fetchSuggestions(machineInput.value, 'machine', machineInput);
      }
    }, 100);
  } else if (type === 'machine') {
    form.machineName.value = value;
    hideMachineSuggestions();
  }
}

// 隐藏项目建议
function hideProjectSuggestions() {
  const container = document.getElementById('project-suggestions');
  if (container) container.classList.add('hidden');
}

// 隐藏机型建议
function hideMachineSuggestions() {
  const container = document.getElementById('machine-suggestions');
  if (container) container.classList.add('hidden');
}

// 点击外部隐藏联想
document.addEventListener('click', function(e) {
  if (!e.target.closest('#project-suggestions') && !e.target.closest('input[name="projectId"]')) {
    hideProjectSuggestions();
  }
  if (!e.target.closest('#machine-suggestions') && !e.target.closest('input[name="machineName"]')) {
    hideMachineSuggestions();
  }
});

async function submitDr(e) {
  e.preventDefault();
  const f = e.target;
  const resultEl = document.getElementById("dr-form-result");
  const btn = document.getElementById("dr-submit-btn");
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = "提交中…";
  try {
    const data = await apiDr("/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: f.projectId.value.trim(),
        machineName: f.machineName.value.trim(),
        drawingVersion: f.drawingVersion.value.trim(),
        designerId: ME.user.open_id,
        drawingFiles: [],
        designNotes: f.designNotes.value.trim(),
      }),
    });
    resultEl.className = "mt-2 text-sm text-green-600";
    resultEl.textContent = `提交成功：${data.reviewId}，请在列表中点击「预约会议」`;
    f.reset();
    document.getElementById("dr-designer-name").value = `${ME.user.name}（${ME.user.open_id}）`;
    setTimeout(() => { document.getElementById("dr-form-box").classList.add("hidden"); resultEl.textContent = ""; }, 1500);
    loadDrawingReviews();
  } catch (err) {
    resultEl.className = "mt-2 text-sm text-red-600";
    resultEl.textContent = "提交失败：" + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "提交评审单";
  }
}

async function loadDrawingReviews() {
  const statsEl = document.getElementById("dr-stats");
  try {
    const data = await apiDr("");
    const counts = {};
    data.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const chips = Object.entries(DR_STATUS)
      .filter(([k]) => counts[k])
      .map(([k, v]) => {
        const on = DR_FILTER === k;
        return `<button onclick="filterDr('${k}')" class="text-xs px-3 py-1.5 rounded-full border ${on ? "text-white border-transparent" : "border-gray-200 text-gray-600"}" ${on ? 'style="background:var(--nec-navy)"' : ""}>${v.label} · ${counts[k]}</button>`;
      });
    const allOn = !DR_FILTER;
    chips.push(`<button onclick="filterDr('')" class="text-xs px-3 py-1.5 rounded-full border ${allOn ? "text-white border-transparent" : "border-gray-200 text-gray-600"}" ${allOn ? 'style="background:var(--nec-navy)"' : ""}>全部 · ${data.length}</button>`);
    statsEl.innerHTML = chips.join("");
    DR_DATA = Object.fromEntries(data.map(r => [r.reviewId, r]));

    const shown = DR_FILTER ? data.filter(r => r.status === DR_FILTER) : data;
    renderDrList(shown);
    renderDrBoard(data, counts);
    loadDrFlowBoard();
  } catch (err) {
    const msg = `<p class="text-sm text-red-500 bg-white rounded-xl shadow p-8 text-center">加载失败：${esc(err.message)}</p>`;
    document.getElementById("dr-list").innerHTML = msg;
    document.getElementById("dr-board").innerHTML = `<p class="text-sm text-red-500 bg-white rounded-xl shadow p-8 text-center sm:col-span-2 lg:col-span-3">加载失败：${esc(err.message)}</p>`;
  }
}

/** 看板：按状态分列，列内为评审单卡片（点击切列表展开详情） */
function renderDrBoard(data, counts) {
  const boardEl = document.getElementById("dr-board");
  const cols = Object.entries(DR_STATUS)
    .filter(([k]) => counts[k] && (!DR_FILTER || DR_FILTER === k));
  if (!cols.length) {
    boardEl.innerHTML = `<p class="text-sm text-gray-400 bg-white rounded-xl shadow p-8 text-center sm:col-span-2 lg:col-span-3">暂无评审单，点击右上角「＋ 提交评审单」开始</p>`;
    return;
  }
  // 单次遍历分组，替代每列一次 data.filter 的 O(列数×行数) 重复扫描
  const groups = {};
  for (const r of data) (groups[r.status] ||= []).push(r);
  boardEl.innerHTML = cols.map(([k, v]) => {
    const items = groups[k];
    return `
      <div class="bg-gray-100/70 rounded-xl p-3">
        <div class="flex items-center justify-between mb-2 px-1">
          <span class="text-xs font-bold text-slate-700">${v.label}</span>
          <span class="text-xs text-gray-400">${items.length}</span>
        </div>
        <div class="space-y-2">
          ${items.map(r => `
            <div class="bg-white rounded-lg shadow-sm p-3 cursor-pointer hover:shadow-md transition" onclick="drOpen('${r.reviewId}')">
              <p class="text-sm font-bold text-slate-800 truncate">${esc(r.machineName)}</p>
              <p class="text-xs text-gray-400 mt-0.5">${esc(r.reviewId)} · ${esc(r.drawingVersion)}</p>
              <p class="text-xs text-gray-500 mt-1 line-clamp-2">${esc(r.designNotes)}</p>
            </div>`).join("")}
        </div>
      </div>`;
  }).join("");
}

function renderDrList(shown) {
  const listEl = document.getElementById("dr-list");
  if (!shown.length) {
    listEl.innerHTML = `<p class="text-sm text-gray-400 bg-white rounded-xl shadow p-8 text-center">暂无评审单，点击右上角「＋ 提交评审单」开始</p>`;
    return;
  }
  listEl.innerHTML = shown.map(r => `
      <div class="bg-white rounded-xl shadow p-4">
        <div class="flex items-start justify-between gap-3 cursor-pointer" onclick="toggleDrDetail('${r.reviewId}')">
          <div>
            <p class="font-bold text-slate-800">${esc(r.machineName)} <span class="text-xs font-normal text-gray-400">${esc(r.reviewId)}</span></p>
            <p class="text-xs text-gray-500 mt-0.5">项目 ${esc(r.projectId)} · 版本 ${esc(r.drawingVersion)} · 设计 ${esc(r.designerId)}</p>
          </div>
          <span class="text-xs px-2 py-1 rounded-full whitespace-nowrap ${DR_STATUS[r.status]?.cls || "bg-gray-100 text-gray-600"}">${DR_STATUS[r.status]?.label || r.status}</span>
        </div>
        <p class="text-sm text-gray-600 mt-2 line-clamp-2">${esc(r.designNotes)}</p>
        <div id="dr-detail-${r.reviewId}" class="hidden mt-3 pt-3 border-t border-gray-100 space-y-2 text-sm"></div>
      </div>
    `).join("");
}

function filterDr(status) { DR_FILTER = status; loadDrawingReviews(); }

async function toggleDrDetail(reviewId) {
  const box = document.getElementById(`dr-detail-${reviewId}`);
  if (!box.classList.contains("hidden")) { box.classList.add("hidden"); return; }
  const r = DR_DATA[reviewId];
  if (!r) return;
  const actions = [];
  if (r.status === "pending_review") actions.push(`<button onclick="drMeeting('${reviewId}')" class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:var(--nec-cyan)">预约会议</button>`);
  if (r.status === "in_review") actions.push(`<button onclick="drConclude('${reviewId}')" class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:var(--nec-navy)">提交评审结论</button>`);
  if (r.status === "rectifying") actions.push(`<button onclick="drRectify('${reviewId}')" class="text-xs px-3 py-1.5 rounded-lg text-white bg-orange-500">整改完成</button>`);
  if (r.status === "bom_generating") actions.push(`<button onclick="drBom('${reviewId}')" class="text-xs px-3 py-1.5 rounded-lg text-white bg-purple-600">生成 BOM</button>`);
  box.innerHTML = `
    ${r.meetingId ? (r.meetingLink
      ? `<p>会议：<a href="${esc(r.meetingLink)}" target="_blank" class="underline" style="color:var(--nec-cyan)">${esc(r.meetingId)}</a>${r.meetingStartTime ? " · " + esc(new Date(r.meetingStartTime).toLocaleString()) : ""}</p>`
      : `<p>会议：<span class="mono">${esc(r.meetingId)}</span> <span class="text-amber-600">（占位会议号，会议 API 未打通，请人工建会后补录链接）</span>${r.meetingStartTime ? " · " + esc(new Date(r.meetingStartTime).toLocaleString()) : ""}</p>`) : ""}
    ${r.conclusion ? `<p>评审结论：${esc(r.conclusion)}${r.conclusionNotes ? " · " + esc(r.conclusionNotes) : ""}</p>` : ""}
    ${actions.length ? `<div class="flex flex-wrap gap-2 pt-1">${actions.join("")}</div>` : `<p class="text-xs text-gray-400">当前状态暂无可执行操作</p>`}
    <div class="pt-2 mt-2 border-t border-gray-100">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <p class="text-xs font-bold text-slate-700">询价（外购 / 标准件）</p>
        <div class="flex gap-2">
          <button onclick="drGenerateInquiries('${reviewId}')" class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:var(--nec-cyan)">生成询价单</button>
          <button onclick="drCompare('${reviewId}')" class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:var(--nec-navy)">比价建议</button>
        </div>
      </div>
      <div id="dr-inq-compare-${reviewId}" class="mt-2"></div>
      <div id="dr-inq-${reviewId}" class="mt-2 space-y-2"></div>
    </div>
    <p id="dr-act-${reviewId}" class="text-xs"></p>
  `;
  box.classList.remove("hidden");
  loadDrInquiries(reviewId);
}

async function drAct(reviewId, path, body, okMsg) {
  const tip = document.getElementById(`dr-act-${reviewId}`);
  try {
    await apiDr(`/${reviewId}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (tip) { tip.className = "text-xs text-green-600"; tip.textContent = okMsg; }
    setTimeout(loadDrawingReviews, 600);
  } catch (err) {
    if (tip) { tip.className = "text-xs text-red-500"; tip.textContent = "失败：" + err.message; }
  }
}
async function drMeeting(id) {
  const tip = document.getElementById(`dr-act-${id}`);
  try {
    const data = await apiDr(`/${id}/meeting`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (tip) {
      if (data.meeting?.mock) {
        tip.className = "text-xs text-amber-600";
        tip.textContent = `会议 API 未打通（${data.meeting.mockReason || "权限/网络"}），已生成占位会议号 ${data.meeting.meetingId}，请人工建会后补录链接`;
      } else {
        tip.className = "text-xs text-green-600";
        tip.textContent = "会议已预约";
      }
    }
    setTimeout(loadDrawingReviews, 600);
  } catch (err) {
    if (tip) { tip.className = "text-xs text-red-500"; tip.textContent = "失败：" + err.message; }
  }
}
function drRectify(id) { drAct(id, "/rectify", {}, "整改已完成，进入 BOM 生成"); }
function drConclude(id) {
  const c = prompt("评审结论：passed（通过）/ conditional（有条件通过）/ rejected（不通过）", "passed");
  if (c === null) return;
  if (!["passed", "conditional", "rejected"].includes(c)) { alert("无效结论"); return; }
  drAct(id, "/conclusion", { conclusion: c }, "评审结论已提交");
}
function drBom(id) {
  const sample = JSON.stringify([
    { materialName: "伺服电机", materialCode: "M-001", specification: "AK10-9", quantity: 2, unit: "台", source: "purchased" },
    { materialName: "联轴器", materialCode: "M-002", specification: "LK-20", quantity: 4, unit: "个", source: "standard" },
    { materialName: "安装支架", quantity: 1, unit: "件", source: "self-made", process: "machining" },
  ], null, 2);
  const raw = prompt('粘贴或修改 BOM JSON 数组（source: purchased 外购 / standard 标准件 / self-made 自制）：', sample);
  if (raw === null) return;
  let items;
  try { items = JSON.parse(raw); } catch { alert("JSON 格式错误"); return; }
  if (!Array.isArray(items) || items.length === 0) { alert("必须是非空数组"); return; }
  drAct(id, "/bom/generate", { items }, "BOM 已生成，可继续生成询价单");
}

// ---------- 图纸评审 · 询价流转与比价 ----------
const DR_INQ_STATUS = {
  sent: { label: "已发出", cls: "bg-blue-50 text-blue-700" },
  quoted: { label: "已报价", cls: "bg-amber-50 text-amber-700" },
  selected: { label: "已选定", cls: "bg-green-50 text-green-700" },
  rejected: { label: "未中选", cls: "bg-gray-100 text-gray-400" },
};

async function drGenerateInquiries(reviewId) {
  const tip = document.getElementById(`dr-act-${reviewId}`);
  const requiredDate = prompt("需求日期（YYYY-MM-DD，可留空）：", "");
  if (requiredDate === null) return;
  try {
    const data = await apiDr(`/${reviewId}/inquiries/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requiredDate: requiredDate.trim() || undefined }),
    });
    if (tip) {
      tip.className = "text-xs text-green-600";
      tip.textContent = `已生成 ${data.created.length} 张询价单` + (data.skipped.length ? `，跳过已存在 ${data.skipped.length} 项` : "");
    }
    loadDrInquiries(reviewId);
  } catch (err) {
    if (tip) {
      tip.className = "text-xs text-red-500";
      if (/尚无 BOM/.test(err.message)) {
        tip.innerHTML = `生成失败：${esc(err.message)} <button onclick="drBom('${reviewId}')" class="ml-1 px-2 py-0.5 rounded text-white bg-purple-600">去生成 BOM</button>`;
      } else {
        tip.textContent = "生成失败：" + err.message;
      }
    }
  }
}

async function loadDrInquiries(reviewId) {
  const box = document.getElementById(`dr-inq-${reviewId}`);
  if (!box) return;
  try {
    const list = await apiDr(`/${reviewId}/inquiries`);
    box.innerHTML = renderDrInquiries(reviewId, list);
  } catch (err) {
    box.innerHTML = `<p class="text-xs text-red-500">询价单加载失败：${esc(err.message)}</p>`;
  }
}

function renderDrInquiries(reviewId, list) {
  if (!list.length) return `<p class="text-xs text-gray-400">暂无询价单，点击「生成询价单」从 BOM 外购/标准件物料生成</p>`;
  return list.map(q => {
    const st = DR_INQ_STATUS[q.status] || DR_INQ_STATUS.sent;
    const quoteForm = q.status === "sent" ? `
      <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
        <input id="dr-q-s-${q.inquiryId}" placeholder="供应商" value="${esc(q.supplierName === "待定" ? "" : q.supplierName)}" class="text-xs border border-gray-200 rounded px-2 py-1 w-24">
        <input id="dr-q-p-${q.inquiryId}" placeholder="报价(元)" type="number" min="0" step="0.01" class="text-xs border border-gray-200 rounded px-2 py-1 w-20">
        <input id="dr-q-d-${q.inquiryId}" placeholder="交期" type="date" class="text-xs border border-gray-200 rounded px-2 py-1">
        <button onclick="drQuoteSubmit('${reviewId}','${q.inquiryId}')" class="text-xs px-2 py-1 rounded text-white" style="background:var(--nec-cyan)">回填报价</button>
      </div>` : "";
    const selectBtn = q.status === "quoted" ? `
      <button onclick="drSelectSupplier('${reviewId}','${esc(q.materialCode || q.bomItemId)}','${q.inquiryId}')" class="text-xs px-2 py-1 rounded text-white bg-green-600">选定</button>` : "";
    return `
      <div class="border border-gray-100 rounded-lg p-2.5 bg-gray-50/50">
        <div class="flex items-start justify-between gap-2 flex-wrap">
          <p class="text-xs">
            <span class="font-bold text-slate-700">${esc(q.inquiryId)}</span>
            <span class="text-gray-500"> ${esc(q.materialName || q.bomItemId)}${q.materialCode ? `（${esc(q.materialCode)}）` : ""}${q.specification ? " · " + esc(q.specification) : ""}</span>
          </p>
          <span class="text-[10px] px-2 py-0.5 rounded-full ${st.cls}">${st.label}</span>
        </div>
        <p class="text-xs text-gray-500 mt-1">
          供应商 ${esc(q.supplierName)} · 数量 ${q.quantity}${q.requiredDate ? " · 需求 " + esc(q.requiredDate) : ""}
          ${q.price != null ? ` · <span class="font-bold text-slate-700">¥${q.price}</span>` : ""}${q.deliveryDate ? " · 交期 " + esc(q.deliveryDate) : ""}
        </p>
        ${quoteForm}${selectBtn}
      </div>`;
  }).join("");
}

async function drQuoteSubmit(reviewId, inquiryId) {
  const tip = document.getElementById(`dr-act-${reviewId}`);
  const supplier = document.getElementById(`dr-q-s-${inquiryId}`).value.trim();
  const price = parseFloat(document.getElementById(`dr-q-p-${inquiryId}`).value);
  const deliveryDate = document.getElementById(`dr-q-d-${inquiryId}`).value || undefined;
  if (!supplier || !(price > 0)) {
    if (tip) { tip.className = "text-xs text-red-500"; tip.textContent = "请填写供应商与大于 0 的报价"; }
    return;
  }
  try {
    await apiDr(`/inquiries/${inquiryId}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ supplier, price, deliveryDate }),
    });
    if (tip) { tip.className = "text-xs text-green-600"; tip.textContent = `询价单 ${inquiryId} 报价已回填`; }
    loadDrInquiries(reviewId);
  } catch (err) {
    if (tip) { tip.className = "text-xs text-red-500"; tip.textContent = "报价失败：" + err.message; }
  }
}

async function drCompare(reviewId) {
  const box = document.getElementById(`dr-inq-compare-${reviewId}`);
  const tip = document.getElementById(`dr-act-${reviewId}`);
  try {
    const data = await apiDr(`/${reviewId}/inquiries/compare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (box) box.innerHTML = renderDrCompare(data);
  } catch (err) {
    if (tip) { tip.className = "text-xs text-red-500"; tip.textContent = "比价失败：" + err.message; }
  }
}

function renderDrCompare(data) {
  if (!data.materials || !data.materials.length) return `<p class="text-xs text-gray-400">暂无询价数据可比价</p>`;
  return `
    <div class="border border-indigo-100 rounded-lg bg-indigo-50/40 p-3 space-y-2">
      <p class="text-xs font-bold text-indigo-800">比价建议书（价格优先，交期超需求日期按 1.2 倍折算）</p>
      ${data.materials.map(m => `
        <div class="text-xs border-t border-indigo-100 pt-1.5">
          <p class="font-bold text-slate-700">${esc(m.materialName || m.bomItemId)}${m.materialCode ? `（${esc(m.materialCode)}）` : ""}</p>
          ${m.quotes.map(q => `
            <p class="text-gray-600 pl-2">
              ${esc(q.supplierName)}：${q.price != null ? "¥" + q.price : "未报价"}${q.deliveryDate ? " · 交期 " + esc(q.deliveryDate) : ""}${q.late ? ' <span class="text-red-500">超期</span>' : ""}
              ${q.inquiryId === m.recommendedInquiryId ? ' <span class="text-green-600 font-bold">★ 推荐</span>' : ""}
              ${q.inquiryId === m.lowestPriceInquiryId && q.inquiryId !== m.recommendedInquiryId ? ' <span class="text-blue-600">最低价</span>' : ""}
              ${q.inquiryId === m.shortestDeliveryInquiryId ? ' <span class="text-teal-600">最短交期</span>' : ""}
            </p>`).join("")}
          ${m.reason ? `<p class="text-indigo-700 pl-2 mt-0.5">建议：${esc(m.reason)}</p>` : ""}
        </div>`).join("")}
    </div>`;
}

async function drSelectSupplier(reviewId, materialKey, inquiryId) {
  const tip = document.getElementById(`dr-act-${reviewId}`);
  if (!confirm(`确认选定询价单 ${inquiryId} 的供应商？同物料其他报价将置为未中选`)) return;
  try {
    await apiDr(`/${reviewId}/inquiries/compare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selections: { [materialKey]: inquiryId } }),
    });
    if (tip) { tip.className = "text-xs text-green-600"; tip.textContent = `已选定 ${inquiryId}`; }
    loadDrInquiries(reviewId);
    drCompare(reviewId);
  } catch (err) {
    if (tip) { tip.className = "text-xs text-red-500"; tip.textContent = "选定失败：" + err.message; }
  }
}

// ---------- 图纸评审 · 流程看板（阻塞预警 + 甘特图） ----------
const DR_GANTT_MS = { submit: "提交", meeting: "会议", conclusion: "结论", bom: "BOM", archived: "归档" };

async function loadDrFlowBoard() {
  let el = document.getElementById("dr-flow-board");
  if (!el) {
    const stats = document.getElementById("dr-stats");
    if (!stats) return;
    stats.insertAdjacentHTML("beforebegin", '<div id="dr-flow-board" class="mb-4 space-y-3"></div>');
    el = document.getElementById("dr-flow-board");
  }
  try {
    const data = await apiDr("/board");
    renderDrFlowBoard(el, data);
  } catch (err) {
    el.innerHTML = `<div class="bg-white rounded-xl shadow p-4 text-xs text-gray-400">流程看板加载失败：${esc(err.message)}</div>`;
  }
}

function renderDrFlowBoard(el, data) {
  const parts = [];

  // 状态计数条
  const counts = Object.entries(DR_STATUS)
    .filter(([k]) => data.statusCounts && data.statusCounts[k])
    .map(([k, v]) => `<span class="text-[10px] px-2 py-0.5 rounded-full ${v.cls}">${v.label} ${data.statusCounts[k]}</span>`)
    .join("");
  parts.push(`
    <div class="bg-white rounded-xl shadow p-4">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-2">
        <p class="text-sm font-bold text-slate-800">流程看板</p>
        <div class="flex flex-wrap gap-1.5">${counts || '<span class="text-xs text-gray-400">暂无数据</span>'}</div>
      </div>
      ${(data.warnings || []).map(w => `<p class="text-[10px] text-amber-600">⚠ ${esc(w)}</p>`).join("")}
      ${renderDrBlockers(data.blockers || [])}
    </div>`);

  // 甘特图
  parts.push(renderDrGantt(data.gantt || []));

  el.innerHTML = parts.join("");
}

function renderDrBlockers(blockers) {
  if (!blockers.length) return `<p class="text-xs text-gray-400 mt-1">暂无阻塞预警</p>`;
  return `
    <div class="mt-2 space-y-1.5">
      <p class="text-xs font-bold text-red-600">阻塞预警（${blockers.length}）</p>
      ${blockers.map(b => `
        <div class="flex items-center justify-between gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2 cursor-pointer hover:bg-red-100/60" onclick="drOpen('${esc(b.reviewId)}')">
          <p class="text-xs text-red-700"><span class="font-bold">${esc(b.machineName || b.reviewId)}</span> · ${esc(b.message)}</p>
          ${b.hoursBlocked ? `<span class="text-[10px] text-red-400 whitespace-nowrap">${b.hoursBlocked}h</span>` : ""}
        </div>`).join("")}
    </div>`;
}

function renderDrGantt(rows) {
  const entries = rows
    .map(r => {
      const pts = Object.entries(DR_GANTT_MS)
        .map(([k, label]) => ({ key: k, label, ts: Date.parse(r.milestones[k] || "") }))
        .filter(p => !Number.isNaN(p.ts));
      return { ...r, pts };
    })
    .filter(r => r.pts.length);
  if (!entries.length) {
    return `<div class="bg-white rounded-xl shadow p-4"><p class="text-sm font-bold text-slate-800 mb-2">进度甘特图</p><p class="text-xs text-gray-400">暂无进行中的评审单节点数据</p></div>`;
  }
  const minT = Math.min(...entries.flatMap(r => r.pts.map(p => p.ts)));
  const maxT = Math.max(...entries.flatMap(r => r.pts.map(p => p.ts)));
  const span = Math.max(maxT - minT, 86400000);
  const fmt = ts => new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  const rowsHtml = entries.map(r => {
    const start = r.pts[0].ts, end = r.pts[r.pts.length - 1].ts;
    const left = ((start - minT) / span * 100).toFixed(1);
    const width = Math.max((end - start) / span * 100, 1.5).toFixed(1);
    const dots = r.pts.map(p => {
      const x = ((p.ts - minT) / span * 100).toFixed(1);
      return `<span title="${p.label} ${esc(new Date(p.ts).toLocaleString("zh-CN"))}" style="position:absolute;left:${x}%;top:50%;transform:translate(-50%,-50%);width:8px;height:8px;border-radius:50%;background:var(--nec-navy);border:1.5px solid #fff"></span>`;
    }).join("");
    return `
      <div class="flex items-center gap-2">
        <p class="text-xs text-gray-600 w-28 truncate shrink-0 cursor-pointer hover:underline" onclick="drOpen('${esc(r.reviewId)}')">${esc(r.machineName || r.reviewId)}</p>
        <div style="position:relative;flex:1;height:18px;background:#f1f5f9;border-radius:6px">
          <div style="position:absolute;left:${left}%;width:${width}%;top:5px;height:8px;border-radius:4px;background:var(--nec-cyan);opacity:.45"></div>
          ${dots}
        </div>
      </div>`;
  }).join("");
  return `
    <div class="bg-white rounded-xl shadow p-4">
      <div class="flex items-center justify-between mb-2">
        <p class="text-sm font-bold text-slate-800">进度甘特图</p>
        <p class="text-[10px] text-gray-400">${fmt(minT)} → ${fmt(maxT)}</p>
      </div>
      <div class="space-y-1.5">${rowsHtml}</div>
      <p class="text-[10px] text-gray-400 mt-2">节点：${Object.values(DR_GANTT_MS).join(" / ")}（悬停圆点查看时间，点击行名跳详情）</p>
    </div>`;
}

export { updateDrawingReviewGate };

// 内联事件处理器（HTML 及动态生成 markup 的 onclick/oninput/onfocus/onsubmit）需要全局可见
Object.assign(window, {
  setDrMode, loadDrawingReviews, toggleDrForm, submitDr,
  handleProjectInput, handleMachineInput, showProjectSuggestions, showMachineSuggestions, selectSuggestion,
  filterDr, drOpen, toggleDrDetail, drMeeting, drConclude, drRectify, drBom,
  drGenerateInquiries, drCompare, drQuoteSubmit, drSelectSupplier,
});
