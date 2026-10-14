// 合同审批（ST-04，登录后可见，收进「更多」）：列表 + 详情（会签审批人/评论）+ 提交表单，模式对齐 tabs/drawing-review.js
// 与 main.js 循环 import（applyHashRoute/getPendingHashTab/refreshMoreTabs），仅函数体内运行时使用（ES Module 活绑定，安全）
import { esc, apiMod } from "../shared/api.js";
import { ME } from "../shared/session.js";
import { applyHashRoute, getPendingHashTab, refreshMoreTabs } from "../main.js";

const CA_API = "/api/contract-approval";
const CA_STATUS = {
  draft: { label: "草稿", cls: "bg-gray-100 text-gray-600" },
  pending_approval: { label: "待审批", cls: "bg-blue-50 text-blue-700" },
  in_review: { label: "审批中", cls: "bg-amber-50 text-amber-700" },
  approved: { label: "已批准", cls: "bg-green-50 text-green-700" },
  rejected: { label: "已拒绝", cls: "bg-red-50 text-red-600" },
  revised: { label: "待修改", cls: "bg-orange-50 text-orange-700" },
  archived: { label: "已归档", cls: "bg-gray-100 text-gray-500" },
};
const CA_TYPE = { purchase: "采购合同", sales: "销售合同", service: "服务合同", partnership: "合作协议", nda: "保密协议" };
const CA_LEVEL = { team_lead: "组长", department_head: "部门负责人", finance: "财务", legal: "法务" };
const CA_DECISION = {
  pending: { label: "待审批", cls: "bg-amber-50 text-amber-700" },
  approved: { label: "已通过", cls: "bg-green-50 text-green-700" },
  rejected: { label: "已拒绝", cls: "bg-red-50 text-red-600" },
  not_required: { label: "无需审批", cls: "bg-gray-100 text-gray-400" },
};
let CA_FILTER = "";
let CA_DATA = {};

function caApi(path, options) { return apiMod(CA_API, path, options); }

/** 登录门控：tab-more + gate-off 双标记，可见性 = 已登录 且「更多」已展开（setMoreTabs/refreshMoreTabs 联动） */
function updateContractApprovalGate() {
  const btn = document.getElementById("tab-btn-contract-approval");
  const section = document.getElementById("tab-contract-approval");
  if (!btn || !section) return;
  const authed = !!(ME.authenticated && ME.user);
  btn.classList.toggle("gate-off", !authed);
  refreshMoreTabs();
  if (authed) {
    loadContractApprovals();
  } else {
    if (!section.classList.contains("hidden")) document.querySelector('[data-tab="home"]').click();
    document.getElementById("ca-list").innerHTML =
      `<p class="text-sm text-gray-400 bg-white rounded-xl shadow p-8 text-center">登录后可使用合同审批流程</p>`;
    document.getElementById("ca-stats").innerHTML = "";
    document.getElementById("ca-form-box").classList.add("hidden");
  }
  // 门控放开后重放暂存的深链（ST-02）
  if (authed && getPendingHashTab()) applyHashRoute();
}

function toggleCaForm() {
  document.getElementById("ca-form-box").classList.toggle("hidden");
}

function setCaConfigured(configured) {
  const btn = document.getElementById("ca-submit-toggle");
  if (btn) btn.classList.toggle("hidden", !configured);
}

/** 503 未配置引导态：不报错白屏，给出 config_contract_approval 配置 Prompt */
function renderCaGuide() {
  setCaConfigured(false);
  document.getElementById("ca-stats").innerHTML = "";
  document.getElementById("ca-form-box").classList.add("hidden");
  document.getElementById("ca-list").innerHTML = `
    <div class="bg-white rounded-xl shadow p-6">
      <p class="font-bold text-slate-800 mb-2">📝 合同审批流程尚未配置</p>
      <p class="text-sm text-gray-500 mb-3">后端已就绪，但还没有绑定飞书多维表格（网关返回 503）。把下面的 Prompt 发给已接入 NEC-MCP 的 Agent 完成配置：</p>
      <pre class="prompt text-xs bg-gray-900 text-green-300 rounded-lg p-4" id="ca-config-prompt">请配置 NEC-MCP 合同审批流程：
调用 NEC-MCP 的 config_contract_approval 工具：
- action: set
- base: &lt;飞书多维表格 app_token&gt;
- tables: 映射 { approvals, comments, events } 到各自的 table_id
完成后告诉我配置结果</pre>
      <button onclick="copyText('ca-config-prompt')" class="mt-3 text-xs text-white px-3 py-1.5 rounded" style="background:var(--nec-navy)">复制 Prompt</button>
      <p class="text-xs text-gray-400 mt-3">需要的表：approvals（审批单）/ comments（审批评论）/ events（流程事件）。配置完成后点击「刷新」。</p>
    </div>`;
}

async function loadContractApprovals() {
  const statsEl = document.getElementById("ca-stats");
  const listEl = document.getElementById("ca-list");
  try {
    const data = await caApi("");
    setCaConfigured(true);
    const counts = {};
    data.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const chips = Object.entries(CA_STATUS)
      .filter(([k]) => counts[k])
      .map(([k, v]) => {
        const on = CA_FILTER === k;
        return `<button onclick="filterCa('${k}')" class="text-xs px-3 py-1.5 rounded-full border ${on ? "text-white border-transparent" : "border-gray-200 text-gray-600"}" ${on ? 'style="background:var(--nec-navy)"' : ""}>${v.label} · ${counts[k]}</button>`;
      });
    const allOn = !CA_FILTER;
    chips.push(`<button onclick="filterCa('')" class="text-xs px-3 py-1.5 rounded-full border ${allOn ? "text-white border-transparent" : "border-gray-200 text-gray-600"}" ${allOn ? 'style="background:var(--nec-navy)"' : ""}>全部 · ${data.length}</button>`);
    statsEl.innerHTML = chips.join("");
    CA_DATA = Object.fromEntries(data.map(r => [r.approvalId, r]));
    renderCaList(CA_FILTER ? data.filter(r => r.status === CA_FILTER) : data);
  } catch (err) {
    if (err.status === 503) { renderCaGuide(); return; }
    if (err.status === 401) {
      statsEl.innerHTML = "";
      listEl.innerHTML = `<p class="text-sm text-gray-400 bg-white rounded-xl shadow p-8 text-center">登录已过期，请重新登录</p>`;
      return;
    }
    statsEl.innerHTML = "";
    listEl.innerHTML = `<p class="text-sm text-red-500 bg-white rounded-xl shadow p-8 text-center">加载失败：${esc(err.message)}</p>`;
  }
}

function renderCaList(shown) {
  const listEl = document.getElementById("ca-list");
  if (!shown.length) {
    listEl.innerHTML = `<p class="text-sm text-gray-400 bg-white rounded-xl shadow p-8 text-center">暂无审批单，点击右上角「＋ 提交审批单」开始</p>`;
    return;
  }
  listEl.innerHTML = shown.map(r => `
      <div class="bg-white rounded-xl shadow p-4">
        <div class="flex items-start justify-between gap-3 cursor-pointer" onclick="toggleCaDetail('${r.approvalId}')">
          <div>
            <p class="font-bold text-slate-800">${esc(r.contractName)} <span class="text-xs font-normal text-gray-400">${esc(r.approvalId)}</span></p>
            <p class="text-xs text-gray-500 mt-0.5">${CA_TYPE[r.contractType] || esc(r.contractType || "—")}${r.contractNumber ? " · 编号 " + esc(r.contractNumber) : ""} · 提交人 ${esc(r.submittedBy)}</p>
          </div>
          <span class="text-xs px-2 py-1 rounded-full whitespace-nowrap ${CA_STATUS[r.status]?.cls || "bg-gray-100 text-gray-600"}">${CA_STATUS[r.status]?.label || r.status}</span>
        </div>
        <p class="text-sm text-gray-600 mt-2 line-clamp-2">${esc(r.summary)}</p>
        <p class="text-xs text-gray-400 mt-1">${r.createdAt ? new Date(r.createdAt).toLocaleString("zh-CN") : ""}</p>
        <div id="ca-detail-${r.approvalId}" class="hidden mt-3 pt-3 border-t border-gray-100 space-y-2 text-sm"></div>
      </div>
    `).join("");
}

function filterCa(status) { CA_FILTER = status; loadContractApprovals(); }

async function toggleCaDetail(approvalId) {
  const box = document.getElementById(`ca-detail-${approvalId}`);
  if (!box.classList.contains("hidden")) { box.classList.add("hidden"); return; }
  const r = CA_DATA[approvalId];
  if (!r) return;
  const me = ME.user?.open_id;
  const actions = [];
  if (r.status === "pending_approval") actions.push(`<button onclick="caStart('${approvalId}')" class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:var(--nec-cyan)">开始审批</button>`);
  const myApprover = (r.approvers || []).find(a => a.approverId === me);
  if (r.status === "in_review" && myApprover && myApprover.status === "pending") {
    actions.push(`<button onclick="caAct('${approvalId}','approve')" class="text-xs px-3 py-1.5 rounded-lg text-white bg-green-600">通过</button>`);
    actions.push(`<button onclick="caAct('${approvalId}','revise')" class="text-xs px-3 py-1.5 rounded-lg text-white bg-orange-500">要求修改</button>`);
    actions.push(`<button onclick="caAct('${approvalId}','reject')" class="text-xs px-3 py-1.5 rounded-lg text-white bg-red-500">拒绝</button>`);
  }
  if (r.status === "revised" && r.submittedBy === me) actions.push(`<button onclick="caResubmit('${approvalId}')" class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:var(--nec-navy)">重新提交</button>`);
  if (["approved", "rejected"].includes(r.status)) actions.push(`<button onclick="caArchive('${approvalId}')" class="text-xs px-3 py-1.5 rounded-lg text-white bg-gray-600">归档</button>`);
  const approverRows = (r.approvers || []).map(a => {
    const d = CA_DECISION[a.status] || CA_DECISION.pending;
    return `<li class="flex items-center gap-2 flex-wrap">
      <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">${CA_LEVEL[a.level] || esc(a.level)}</span>
      <span>${esc(a.name || a.approverId)}</span>
      <span class="text-[10px] px-1.5 py-0.5 rounded-full ${d.cls}">${d.label}</span>
      ${a.comment ? `<span class="text-xs text-gray-400">${esc(a.comment)}</span>` : ""}
    </li>`;
  }).join("");
  const files = (r.contractFiles || []).map(f =>
    f.url
      ? `<li><a href="${esc(f.url)}" target="_blank" class="underline" style="color:var(--nec-cyan)">${esc(f.name)}</a></li>`
      : `<li>${esc(f.name)} <span class="mono text-gray-400">${esc(f.token)}</span></li>`).join("");
  box.innerHTML = `
    ${(r.parties || []).length ? `<p>合同各方：${r.parties.map(esc).join("、")}</p>` : ""}
    ${r.effectiveDate || r.expirationDate ? `<p>有效期：${esc(r.effectiveDate || "—")} ~ ${esc(r.expirationDate || "—")}</p>` : ""}
    ${files ? `<p class="text-xs font-bold text-slate-700 pt-1">合同文件</p><ul class="list-disc pl-4 text-xs text-gray-600 space-y-0.5">${files}</ul>` : ""}
    <p class="text-xs font-bold text-slate-700 pt-1">会签审批人（全部通过方生效）</p>
    <ul class="space-y-1">${approverRows || '<li class="text-xs text-gray-400">未指定</li>'}</ul>
    ${actions.length ? `<div class="flex flex-wrap gap-2 pt-1">${actions.join("")}</div>` : `<p class="text-xs text-gray-400">当前状态暂无可执行操作</p>`}
    <div id="ca-comments-${approvalId}" class="pt-2 mt-1 border-t border-gray-100"></div>
    <p id="ca-act-${approvalId}" class="text-xs"></p>
  `;
  box.classList.remove("hidden");
  loadCaComments(approvalId);
}

async function loadCaComments(approvalId) {
  const box = document.getElementById(`ca-comments-${approvalId}`);
  if (!box) return;
  try {
    const list = await caApi(`/${approvalId}/comments`);
    if (!list.length) {
      box.innerHTML = `<p class="text-xs text-gray-400">暂无审批评论</p>`;
      return;
    }
    box.innerHTML = `
      <p class="text-xs font-bold text-slate-700">审批评论（${list.length}）</p>
      ${list.map(c => `<p class="text-xs text-gray-600 mt-1"><span class="mono text-gray-400">${esc(c.reviewerId)}</span> · ${new Date(c.timestamp).toLocaleString("zh-CN")}：${esc(c.content)}</p>`).join("")}
    `;
  } catch (err) {
    box.innerHTML = `<p class="text-xs text-red-500">评论加载失败：${esc(err.message)}</p>`;
  }
}

async function caAct(approvalId, action) {
  const labels = { approve: "通过", reject: "拒绝", revise: "要求修改" };
  const comment = prompt(`${labels[action]}意见（可留空）：`, "");
  if (comment === null) return;
  const tip = document.getElementById(`ca-act-${approvalId}`);
  try {
    await caApi(`/${approvalId}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, comment: comment.trim() || undefined }),
    });
    if (tip) { tip.className = "text-xs text-green-600"; tip.textContent = `已${labels[action]}`; }
    setTimeout(loadContractApprovals, 600);
  } catch (err) {
    if (tip) { tip.className = "text-xs text-red-500"; tip.textContent = "失败：" + err.message; }
  }
}

async function caPost(approvalId, path, body, okMsg) {
  const tip = document.getElementById(`ca-act-${approvalId}`);
  try {
    await caApi(`/${approvalId}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (tip) { tip.className = "text-xs text-green-600"; tip.textContent = okMsg; }
    setTimeout(loadContractApprovals, 600);
  } catch (err) {
    if (tip) { tip.className = "text-xs text-red-500"; tip.textContent = "失败：" + err.message; }
  }
}
function caStart(id) { caPost(id, "/start-review", {}, "已开始审批"); }
function caArchive(id) { caPost(id, "/archive", {}, "已归档"); }
function caResubmit(id) {
  const summary = prompt("修改说明（可留空，将更新摘要并重新进入待审批）：", "");
  if (summary === null) return;
  caPost(id, "/resubmit", { summary: summary.trim() || undefined }, "已重新提交");
}

/** 解析审批人行：每行 `level open_id [姓名]`，level ∈ team_lead/department_head/finance/legal */
function parseCaApprovers(text) {
  return text.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
    const [level, approverId, ...rest] = l.split(/\s+/);
    return { level, approverId, name: rest.join(" ") || undefined };
  });
}

/** 解析附件行：每行 `名称|token或URL`；单列时同名作 token */
function parseCaFiles(text) {
  return text.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
    const parts = l.split("|").map(s => s.trim());
    return parts.length > 1 ? { name: parts[0], token: parts[1] } : { name: parts[0], token: parts[0] };
  });
}

async function submitCa(e) {
  e.preventDefault();
  const f = e.target;
  const resultEl = document.getElementById("ca-form-result");
  const btn = document.getElementById("ca-submit-btn");
  if (btn.disabled) return;
  const contractFiles = parseCaFiles(f.contractFiles.value);
  const approvers = parseCaApprovers(f.approvers.value);
  if (!contractFiles.length) {
    resultEl.className = "mt-2 text-sm text-red-600";
    resultEl.textContent = "请至少填写一个合同文件（名称|token或URL）";
    return;
  }
  if (!approvers.length || approvers.some(a => !CA_LEVEL[a.level] || !a.approverId)) {
    resultEl.className = "mt-2 text-sm text-red-600";
    resultEl.textContent = "审批人格式：每行 `team_lead|department_head|finance|legal open_id [姓名]`，至少一名";
    return;
  }
  if (approvers.some(a => a.approverId === ME.user.open_id)) {
    resultEl.className = "mt-2 text-sm text-red-600";
    resultEl.textContent = "提交人不能兼任审批人";
    return;
  }
  btn.disabled = true;
  btn.textContent = "提交中…";
  try {
    const data = await caApi("/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contractName: f.contractName.value.trim(),
        contractNumber: f.contractNumber.value.trim() || undefined,
        contractType: f.contractType.value,
        parties: f.parties.value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
        effectiveDate: f.effectiveDate.value || undefined,
        expirationDate: f.expirationDate.value || undefined,
        contractFiles,
        summary: f.summary.value.trim(),
        approvers,
      }),
    });
    resultEl.className = "mt-2 text-sm text-green-600";
    resultEl.textContent = `提交成功：${data.approvalId}，等待审批人处理`;
    f.reset();
    setTimeout(() => { document.getElementById("ca-form-box").classList.add("hidden"); resultEl.textContent = ""; }, 1500);
    loadContractApprovals();
  } catch (err) {
    resultEl.className = "mt-2 text-sm text-red-600";
    resultEl.textContent = "提交失败：" + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "提交审批单";
  }
}

export { updateContractApprovalGate };

// 内联事件处理器（HTML 及动态生成 markup 的 onclick/onsubmit）需要全局可见
Object.assign(window, {
  loadContractApprovals, toggleCaForm, submitCa,
  filterCa, toggleCaDetail, caStart, caAct, caResubmit, caArchive,
});
