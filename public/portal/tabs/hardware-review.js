// 硬件评审/申购（ST-04，登录后可见，收进「更多」）：列表 + 详情 + 提交表单，模式对齐 tabs/drawing-review.js
// 与 main.js 循环 import（applyHashRoute/getPendingHashTab/refreshMoreTabs），仅函数体内运行时使用（ES Module 活绑定，安全）
import { esc, apiMod } from "../shared/api.js";
import { ME } from "../shared/session.js";
import { applyHashRoute, getPendingHashTab, refreshMoreTabs } from "../main.js";

const HW_API = "/api/hardware-review";
const HW_STATUS = {
  draft: { label: "待提交", cls: "bg-gray-100 text-gray-600" },
  pending_review: { label: "待评审", cls: "bg-blue-50 text-blue-700" },
  in_review: { label: "评审中", cls: "bg-amber-50 text-amber-700" },
  rectifying: { label: "待整改", cls: "bg-orange-50 text-orange-700" },
  report_generating: { label: "报告生成中", cls: "bg-purple-50 text-purple-700" },
  assessing: { label: "评估中", cls: "bg-indigo-50 text-indigo-700" },
  approved: { label: "已通过", cls: "bg-green-50 text-green-700" },
  archived: { label: "已归档", cls: "bg-gray-100 text-gray-500" },
};
const HW_TYPE = {
  controller: "控制器", sensor: "传感器", actuator: "执行器", motor: "电机/驱动",
  power: "电源/电池", communication: "通信模块", structure: "结构件", other: "其他",
};
let HW_FILTER = "";
let HW_DATA = {};

function hwApi(path, options) { return apiMod(HW_API, path, options); }

/** 登录门控：tab-more + gate-off 双标记，可见性 = 已登录 且「更多」已展开（setMoreTabs/refreshMoreTabs 联动） */
function updateHardwareReviewGate() {
  const btn = document.getElementById("tab-btn-hardware-review");
  const section = document.getElementById("tab-hardware-review");
  if (!btn || !section) return;
  const authed = !!(ME.authenticated && ME.user);
  btn.classList.toggle("gate-off", !authed);
  refreshMoreTabs();
  if (authed) {
    const dn = document.getElementById("hw-designer-name");
    if (dn) dn.value = `${ME.user.name}（${ME.user.open_id}）`;
    loadHardwareReviews();
  } else {
    if (!section.classList.contains("hidden")) document.querySelector('[data-tab="home"]').click();
    document.getElementById("hw-list").innerHTML =
      `<p class="text-sm text-gray-400 bg-white rounded-xl shadow p-8 text-center">登录后可使用硬件评审流程</p>`;
    document.getElementById("hw-stats").innerHTML = "";
    document.getElementById("hw-form-box").classList.add("hidden");
  }
  // 门控放开后重放暂存的深链（ST-02）
  if (authed && getPendingHashTab()) applyHashRoute();
}

function toggleHwForm() {
  document.getElementById("hw-form-box").classList.toggle("hidden");
}

function setHwConfigured(configured) {
  const btn = document.getElementById("hw-submit-toggle");
  if (btn) btn.classList.toggle("hidden", !configured);
}

/** 503 未配置引导态：不报错白屏，给出 config_hardware_review 配置 Prompt */
function renderHwGuide() {
  setHwConfigured(false);
  document.getElementById("hw-stats").innerHTML = "";
  document.getElementById("hw-form-box").classList.add("hidden");
  document.getElementById("hw-list").innerHTML = `
    <div class="bg-white rounded-xl shadow p-6">
      <p class="font-bold text-slate-800 mb-2">🔧 硬件评审流程尚未配置</p>
      <p class="text-sm text-gray-500 mb-3">后端已就绪，但还没有绑定飞书多维表格（网关返回 503）。把下面的 Prompt 发给已接入 NEC-MCP 的 Agent 完成配置：</p>
      <pre class="prompt text-xs bg-gray-900 text-green-300 rounded-lg p-4" id="hw-config-prompt">请配置 NEC-MCP 硬件评审流程：
调用 NEC-MCP 的 config_hardware_review 工具：
- action: set
- base: &lt;飞书多维表格 app_token&gt;
- tables: 映射 { reviews, minutes, rectifications, reports, events } 到各自的 table_id
完成后告诉我配置结果</pre>
      <button onclick="copyText('hw-config-prompt')" class="mt-3 text-xs text-white px-3 py-1.5 rounded" style="background:var(--nec-navy)">复制 Prompt</button>
      <p class="text-xs text-gray-400 mt-3">需要的表：reviews（评审单）/ minutes（纪要）/ rectifications（整改项）/ reports（评审报告）/ events（流程事件）。配置完成后点击「刷新」。</p>
    </div>`;
}

async function loadHardwareReviews() {
  const statsEl = document.getElementById("hw-stats");
  const listEl = document.getElementById("hw-list");
  try {
    const data = await hwApi("");
    setHwConfigured(true);
    const counts = {};
    data.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const chips = Object.entries(HW_STATUS)
      .filter(([k]) => counts[k])
      .map(([k, v]) => {
        const on = HW_FILTER === k;
        return `<button onclick="filterHw('${k}')" class="text-xs px-3 py-1.5 rounded-full border ${on ? "text-white border-transparent" : "border-gray-200 text-gray-600"}" ${on ? 'style="background:var(--nec-navy)"' : ""}>${v.label} · ${counts[k]}</button>`;
      });
    const allOn = !HW_FILTER;
    chips.push(`<button onclick="filterHw('')" class="text-xs px-3 py-1.5 rounded-full border ${allOn ? "text-white border-transparent" : "border-gray-200 text-gray-600"}" ${allOn ? 'style="background:var(--nec-navy)"' : ""}>全部 · ${data.length}</button>`);
    statsEl.innerHTML = chips.join("");
    HW_DATA = Object.fromEntries(data.map(r => [r.reviewId, r]));
    renderHwList(HW_FILTER ? data.filter(r => r.status === HW_FILTER) : data);
  } catch (err) {
    if (err.status === 503) { renderHwGuide(); return; }
    if (err.status === 401) {
      statsEl.innerHTML = "";
      listEl.innerHTML = `<p class="text-sm text-gray-400 bg-white rounded-xl shadow p-8 text-center">登录已过期，请重新登录</p>`;
      return;
    }
    statsEl.innerHTML = "";
    listEl.innerHTML = `<p class="text-sm text-red-500 bg-white rounded-xl shadow p-8 text-center">加载失败：${esc(err.message)}</p>`;
  }
}

function renderHwList(shown) {
  const listEl = document.getElementById("hw-list");
  if (!shown.length) {
    listEl.innerHTML = `<p class="text-sm text-gray-400 bg-white rounded-xl shadow p-8 text-center">暂无评审单，点击右上角「＋ 提交评审单」开始</p>`;
    return;
  }
  listEl.innerHTML = shown.map(r => `
      <div class="bg-white rounded-xl shadow p-4">
        <div class="flex items-start justify-between gap-3 cursor-pointer" onclick="toggleHwDetail('${r.reviewId}')">
          <div>
            <p class="font-bold text-slate-800">${esc(r.hardwareName)} <span class="text-xs font-normal text-gray-400">${esc(r.reviewId)}</span></p>
            <p class="text-xs text-gray-500 mt-0.5">项目 ${esc(r.projectId || "—")} · ${HW_TYPE[r.hardwareType] || esc(r.hardwareType || "其他")} · 版本 ${esc(r.hardwareVersion)} · 设计 ${esc(r.designerId)}</p>
          </div>
          <span class="text-xs px-2 py-1 rounded-full whitespace-nowrap ${HW_STATUS[r.status]?.cls || "bg-gray-100 text-gray-600"}">${HW_STATUS[r.status]?.label || r.status}</span>
        </div>
        <p class="text-sm text-gray-600 mt-2 line-clamp-2">${esc(r.designNotes)}</p>
        <p class="text-xs text-gray-400 mt-1">${r.createdAt ? new Date(r.createdAt).toLocaleString("zh-CN") : ""}</p>
        <div id="hw-detail-${r.reviewId}" class="hidden mt-3 pt-3 border-t border-gray-100 space-y-2 text-sm"></div>
      </div>
    `).join("");
}

function filterHw(status) { HW_FILTER = status; loadHardwareReviews(); }

async function toggleHwDetail(reviewId) {
  const box = document.getElementById(`hw-detail-${reviewId}`);
  if (!box.classList.contains("hidden")) { box.classList.add("hidden"); return; }
  const r = HW_DATA[reviewId];
  if (!r) return;
  const actions = [];
  if (r.status === "pending_review") actions.push(`<button onclick="hwMeeting('${reviewId}')" class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:var(--nec-cyan)">预约会议</button>`);
  if (r.status === "in_review") actions.push(`<button onclick="hwConclude('${reviewId}')" class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:var(--nec-navy)">提交评审结论</button>`);
  if (r.status === "rectifying") actions.push(`<button onclick="hwRectify('${reviewId}')" class="text-xs px-3 py-1.5 rounded-lg text-white bg-orange-500">整改完成</button>`);
  if (r.status === "report_generating") actions.push(`<button onclick="hwReport('${reviewId}')" class="text-xs px-3 py-1.5 rounded-lg text-white bg-purple-600">生成评审报告</button>`);
  if (r.status === "assessing") {
    actions.push(`<button onclick="hwAssess('${reviewId}','pass')" class="text-xs px-3 py-1.5 rounded-lg text-white bg-green-600">评估通过</button>`);
    actions.push(`<button onclick="hwAssess('${reviewId}','fail')" class="text-xs px-3 py-1.5 rounded-lg text-white bg-red-500">评估不通过</button>`);
  }
  if (r.status === "approved") actions.push(`<button onclick="hwArchive('${reviewId}')" class="text-xs px-3 py-1.5 rounded-lg text-white bg-gray-600">归档</button>`);
  const canViewReport = ["assessing", "approved", "archived"].includes(r.status);
  box.innerHTML = `
    ${r.specification ? `<p>规格参数：${esc(r.specification)}</p>` : ""}
    ${r.meetingId ? (r.meetingLink
      ? `<p>会议：<a href="${esc(r.meetingLink)}" target="_blank" class="underline" style="color:var(--nec-cyan)">${esc(r.meetingId)}</a>${r.meetingStartTime ? " · " + esc(new Date(r.meetingStartTime).toLocaleString("zh-CN")) : ""}</p>`
      : `<p>会议：<span class="mono">${esc(r.meetingId)}</span>${r.meetingStartTime ? " · " + esc(new Date(r.meetingStartTime).toLocaleString("zh-CN")) : ""}</p>`) : ""}
    ${r.conclusion ? `<p>评审结论：${esc(r.conclusion)}${r.conclusionNotes ? " · " + esc(r.conclusionNotes) : ""}</p>` : ""}
    ${actions.length ? `<div class="flex flex-wrap gap-2 pt-1">${actions.join("")}</div>` : `<p class="text-xs text-gray-400">当前状态暂无可执行操作</p>`}
    ${canViewReport ? `<div class="pt-1"><button onclick="hwShowReport('${reviewId}')" class="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600">查看评审报告</button></div>` : ""}
    <div id="hw-report-${reviewId}"></div>
    <p id="hw-act-${reviewId}" class="text-xs"></p>
  `;
  box.classList.remove("hidden");
}

async function hwAct(reviewId, path, body, okMsg) {
  const tip = document.getElementById(`hw-act-${reviewId}`);
  try {
    await hwApi(`/${reviewId}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (tip) { tip.className = "text-xs text-green-600"; tip.textContent = okMsg; }
    setTimeout(loadHardwareReviews, 600);
  } catch (err) {
    if (tip) { tip.className = "text-xs text-red-500"; tip.textContent = "失败：" + err.message; }
  }
}
async function hwMeeting(id) {
  const tip = document.getElementById(`hw-act-${id}`);
  try {
    const data = await hwApi(`/${id}/meeting`, {
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
    setTimeout(loadHardwareReviews, 600);
  } catch (err) {
    if (tip) { tip.className = "text-xs text-red-500"; tip.textContent = "失败：" + err.message; }
  }
}
function hwRectify(id) { hwAct(id, "/rectify", {}, "整改已完成，进入报告生成"); }
function hwArchive(id) { hwAct(id, "/archive", {}, "已归档"); }
function hwAssess(id, result) { hwAct(id, "/assess", { result }, result === "pass" ? "评估通过，可归档" : "评估不通过，退回待提交"); }
function hwConclude(id) {
  const c = prompt("评审结论：passed（通过）/ conditional（有条件通过）/ rejected（不通过）", "passed");
  if (c === null) return;
  if (!["passed", "conditional", "rejected"].includes(c)) { alert("无效结论"); return; }
  const notes = prompt("结论说明（可留空）：", "") ?? "";
  hwAct(id, "/conclusion", { conclusion: c, notes }, "评审结论已提交");
}
function hwReport(id) {
  const summary = prompt("评审报告摘要（可留空）：", "");
  if (summary === null) return;
  hwAct(id, "/report/generate", { summary }, "评审报告已生成，进入评估");
}

async function hwShowReport(reviewId) {
  const box = document.getElementById(`hw-report-${reviewId}`);
  if (!box) return;
  box.innerHTML = `<p class="text-xs text-gray-400">报告加载中…</p>`;
  try {
    const data = await hwApi(`/${reviewId}/report`);
    const r = data.report || data;
    const checklist = (r.checklist || []).map(it =>
      `<li>${esc(it.item)}：${it.result === "pass" ? "✅" : it.result === "fail" ? "❌" : "—"}${it.note ? "（" + esc(it.note) + "）" : ""}</li>`).join("");
    box.innerHTML = `
      <div class="border border-indigo-100 rounded-lg bg-indigo-50/40 p-3 text-xs space-y-1">
        <p class="font-bold text-indigo-800">评审报告 ${esc(r.reportId || "")} · 结果：${r.result === "pass" ? "通过" : "不通过"}</p>
        ${r.summary ? `<p class="text-gray-600">${esc(r.summary)}</p>` : ""}
        ${checklist ? `<ul class="list-disc pl-4 text-gray-600">${checklist}</ul>` : ""}
      </div>`;
  } catch (err) {
    box.innerHTML = `<p class="text-xs text-red-500">报告加载失败：${esc(err.message)}</p>`;
  }
}

async function submitHw(e) {
  e.preventDefault();
  const f = e.target;
  const resultEl = document.getElementById("hw-form-result");
  const btn = document.getElementById("hw-submit-btn");
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = "提交中…";
  try {
    const data = await hwApi("/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: f.projectId.value.trim(),
        hardwareName: f.hardwareName.value.trim(),
        hardwareType: f.hardwareType.value,
        hardwareVersion: f.hardwareVersion.value.trim(),
        designerId: ME.user.open_id,
        hardwareFiles: [],
        designNotes: f.designNotes.value.trim(),
        specification: f.specification.value.trim(),
      }),
    });
    resultEl.className = "mt-2 text-sm text-green-600";
    resultEl.textContent = `提交成功：${data.reviewId}，请在列表中点击「预约会议」`;
    f.reset();
    document.getElementById("hw-designer-name").value = `${ME.user.name}（${ME.user.open_id}）`;
    setTimeout(() => { document.getElementById("hw-form-box").classList.add("hidden"); resultEl.textContent = ""; }, 1500);
    loadHardwareReviews();
  } catch (err) {
    resultEl.className = "mt-2 text-sm text-red-600";
    resultEl.textContent = "提交失败：" + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "提交评审单";
  }
}

export { updateHardwareReviewGate };

// 内联事件处理器（HTML 及动态生成 markup 的 onclick/onsubmit）需要全局可见
Object.assign(window, {
  loadHardwareReviews, toggleHwForm, submitHw,
  filterHw, toggleHwDetail, hwMeeting, hwConclude, hwRectify, hwReport, hwAssess, hwArchive, hwShowReport,
});
