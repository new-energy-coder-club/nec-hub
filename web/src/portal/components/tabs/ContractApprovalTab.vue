<script setup lang="ts">
// 合同审批（ST-04，登录后可见，收进「更多」）：列表 + 详情（会签审批人/评论）+ 提交表单，模式对齐 HardwareReviewTab
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { auth } from '@shared/auth'
import { apiMod } from '@shared/api'
import { tabs, switchTab } from '@portal/composables/useTabs'
import StatusBadge from '@shared/ui/StatusBadge.vue'
import EmptyState from '@shared/ui/EmptyState.vue'
import FilterChips from '@shared/ui/FilterChips.vue'
import ConfigGuide from '@shared/ui/ConfigGuide.vue'

const CA_API = '/api/contract-approval'
const CA_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-gray-100 text-gray-600' },
  pending_approval: { label: '待审批', cls: 'bg-blue-50 text-blue-700' },
  in_review: { label: '审批中', cls: 'bg-amber-50 text-amber-700' },
  approved: { label: '已批准', cls: 'bg-green-50 text-green-700' },
  rejected: { label: '已拒绝', cls: 'bg-red-50 text-red-600' },
  revised: { label: '待修改', cls: 'bg-orange-50 text-orange-700' },
  archived: { label: '已归档', cls: 'bg-gray-100 text-gray-500' },
}
const CA_TYPE: Record<string, string> = { purchase: '采购合同', sales: '销售合同', service: '服务合同', partnership: '合作协议', nda: '保密协议' }
const CA_LEVEL: Record<string, string> = { team_lead: '组长', department_head: '部门负责人', finance: '财务', legal: '法务' }
const CA_DECISION: Record<string, { label: string; cls: string }> = {
  pending: { label: '待审批', cls: 'bg-amber-50 text-amber-700' },
  approved: { label: '已通过', cls: 'bg-green-50 text-green-700' },
  rejected: { label: '已拒绝', cls: 'bg-red-50 text-red-600' },
  not_required: { label: '无需审批', cls: 'bg-gray-100 text-gray-400' },
}
const CA_GUIDE_PROMPT = `请配置 NEC-MCP 合同审批流程：
调用 NEC-MCP 的 config_contract_approval 工具：
- action: set
- base: <飞书多维表格 app_token>
- tables: 映射 { approvals, comments, events } 到各自的 table_id
完成后告诉我配置结果`

const authed = computed(() => !!(auth.me.authenticated && auth.me.user))

const filter = ref('')
const list = ref<any[]>([])
const counts = ref<Record<string, number>>({})
const byId = ref<Record<string, any>>({})
const configured = ref(true)
// loadState：loading / ok / guide(503 未配置) / unauthorized(401) / error
const loadState = ref<'loading' | 'ok' | 'guide' | 'unauthorized' | 'error'>('loading')
const errorMsg = ref('')
const expanded = reactive<Record<string, boolean>>({})
const comments = reactive<Record<string, { loading: boolean; list?: any[]; error?: string }>>({})
const actTips = reactive<Record<string, { tone: 'ok' | 'err'; msg: string }>>({})

// ---- 提交表单 ----
const formOpen = ref(false)
const form = reactive({
  contractName: '', contractNumber: '', contractType: 'service', parties: '',
  effectiveDate: '', expirationDate: '', contractFiles: '', approvers: '', summary: '',
})
const formResult = ref('')
const formResultOk = ref(true)
const submitting = ref(false)

function toggleCaForm() { formOpen.value = !formOpen.value }

function caApi(path: string, options?: RequestInit) { return apiMod(CA_API, path, options) }

async function loadContractApprovals() {
  if (!authed.value) return
  try {
    const data: any[] = await caApi('')
    configured.value = true
    const c: Record<string, number> = {}
    data.forEach(r => { c[r.status] = (c[r.status] || 0) + 1 })
    counts.value = c
    list.value = data
    byId.value = Object.fromEntries(data.map(r => [r.approvalId, r]))
    loadState.value = 'ok'
  } catch (err: any) {
    if (err.status === 503) { configured.value = false; loadState.value = 'guide'; return }
    if (err.status === 401) { loadState.value = 'unauthorized'; return }
    errorMsg.value = err.message
    loadState.value = 'error'
  }
}

const shown = computed(() => filter.value ? list.value.filter(r => r.status === filter.value) : list.value)

const chips = computed(() => {
  const arr = Object.entries(CA_STATUS)
    .filter(([k]) => counts.value[k])
    .map(([k, v]) => ({ key: k, label: `${v.label} · ${counts.value[k]}` }))
  arr.push({ key: '', label: `全部 · ${list.value.length}` })
  return arr
})

function filterCa(status: string) {
  filter.value = status
  loadContractApprovals()
}

function statusMeta(s: string) {
  return CA_STATUS[s] || { label: s, cls: 'bg-gray-100 text-gray-600' }
}

function decisionMeta(s: string) {
  return CA_DECISION[s] || CA_DECISION.pending
}

function toggleCaDetail(approvalId: string) {
  expanded[approvalId] = !expanded[approvalId]
  if (expanded[approvalId]) loadCaComments(approvalId)
}

async function loadCaComments(approvalId: string) {
  comments[approvalId] = { loading: true }
  try {
    const list = await caApi(`/${approvalId}/comments`)
    comments[approvalId] = { loading: false, list }
  } catch (err: any) {
    comments[approvalId] = { loading: false, error: err.message }
  }
}

function detailActions(r: any): { key: string; label: string; cls: string; style?: string }[] {
  const acts: { key: string; label: string; cls: string; style?: string }[] = []
  const me = auth.me.user?.open_id
  if (r.status === 'pending_approval') acts.push({ key: 'start', label: '开始审批', cls: '', style: 'background:var(--nec-cyan)' })
  const myApprover = (r.approvers || []).find((a: any) => a.approverId === me)
  if (r.status === 'in_review' && myApprover && myApprover.status === 'pending') {
    acts.push({ key: 'approve', label: '通过', cls: 'bg-green-600' })
    acts.push({ key: 'revise', label: '要求修改', cls: 'bg-orange-500' })
    acts.push({ key: 'reject', label: '拒绝', cls: 'bg-red-500' })
  }
  if (r.status === 'revised' && r.submittedBy === me) acts.push({ key: 'resubmit', label: '重新提交', cls: '', style: 'background:var(--nec-navy)' })
  if (['approved', 'rejected'].includes(r.status)) acts.push({ key: 'archive', label: '归档', cls: 'bg-gray-600' })
  return acts
}

function setTip(id: string, tone: 'ok' | 'err', msg: string) { actTips[id] = { tone, msg } }

async function caPost(approvalId: string, path: string, body: any, okMsg: string) {
  try {
    await caApi(`/${approvalId}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    setTip(approvalId, 'ok', okMsg)
    setTimeout(loadContractApprovals, 600)
  } catch (err: any) {
    setTip(approvalId, 'err', '失败：' + err.message)
  }
}

const CA_ACT_LABELS: Record<string, string> = { approve: '通过', reject: '拒绝', revise: '要求修改' }

async function caAct(approvalId: string, action: 'approve' | 'reject' | 'revise') {
  const comment = prompt(`${CA_ACT_LABELS[action]}意见（可留空）：`, '')
  if (comment === null) return
  try {
    await caApi(`/${approvalId}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, comment: comment.trim() || undefined }),
    })
    setTip(approvalId, 'ok', `已${CA_ACT_LABELS[action]}`)
    setTimeout(loadContractApprovals, 600)
  } catch (err: any) {
    setTip(approvalId, 'err', '失败：' + err.message)
  }
}

function caResubmit(id: string) {
  const summary = prompt('修改说明（可留空，将更新摘要并重新进入待审批）：', '')
  if (summary === null) return
  caPost(id, '/resubmit', { summary: summary.trim() || undefined }, '已重新提交')
}

function runAction(approvalId: string, key: string) {
  if (key === 'start') return caPost(approvalId, '/start-review', {}, '已开始审批')
  if (key === 'archive') return caPost(approvalId, '/archive', {}, '已归档')
  if (key === 'resubmit') return caResubmit(approvalId)
  return caAct(approvalId, key as 'approve' | 'reject' | 'revise')
}

/** 解析审批人行：每行 `level open_id [姓名]`，level ∈ team_lead/department_head/finance/legal */
function parseCaApprovers(text: string) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [level, approverId, ...rest] = l.split(/\s+/)
    return { level, approverId, name: rest.join(' ') || undefined }
  })
}

/** 解析附件行：每行 `名称|token或URL`；单列时同名作 token */
function parseCaFiles(text: string) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const parts = l.split('|').map(s => s.trim())
    return parts.length > 1 ? { name: parts[0], token: parts[1] } : { name: parts[0], token: parts[0] }
  })
}

async function submitCa() {
  if (submitting.value || !auth.me.user) return
  const contractFiles = parseCaFiles(form.contractFiles)
  const approvers = parseCaApprovers(form.approvers)
  if (!contractFiles.length) {
    formResultOk.value = false
    formResult.value = '请至少填写一个合同文件（名称|token或URL）'
    return
  }
  if (!approvers.length || approvers.some(a => !CA_LEVEL[a.level] || !a.approverId)) {
    formResultOk.value = false
    formResult.value = '审批人格式：每行 `team_lead|department_head|finance|legal open_id [姓名]`，至少一名'
    return
  }
  if (approvers.some(a => a.approverId === auth.me.user!.open_id)) {
    formResultOk.value = false
    formResult.value = '提交人不能兼任审批人'
    return
  }
  submitting.value = true
  try {
    const data = await caApi('/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contractName: form.contractName.trim(),
        contractNumber: form.contractNumber.trim() || undefined,
        contractType: form.contractType,
        parties: form.parties.split(/[,，]/).map(s => s.trim()).filter(Boolean),
        effectiveDate: form.effectiveDate || undefined,
        expirationDate: form.expirationDate || undefined,
        contractFiles,
        summary: form.summary.trim(),
        approvers,
      }),
    })
    formResultOk.value = true
    formResult.value = `提交成功：${data.approvalId}，等待审批人处理`
    form.contractName = ''; form.contractNumber = ''; form.contractType = 'service'; form.parties = ''
    form.effectiveDate = ''; form.expirationDate = ''; form.contractFiles = ''; form.approvers = ''; form.summary = ''
    setTimeout(() => { formOpen.value = false; formResult.value = '' }, 1500)
    loadContractApprovals()
  } catch (err: any) {
    formResultOk.value = false
    formResult.value = '提交失败：' + err.message
  } finally {
    submitting.value = false
  }
}

// ---- 登录门控（gate-off）：登出时若正停在该 Tab 则跳回首页 ----
watch(authed, now => {
  if (now) {
    loadContractApprovals()
  } else {
    if (tabs.active === 'contract-approval') switchTab('home')
    list.value = []
    counts.value = {}
    loadState.value = 'loading'
    formOpen.value = false
  }
})
onMounted(() => { if (authed.value) loadContractApprovals() })
</script>

<template>
  <section id="tab-contract-approval">
    <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
      <h2 class="text-lg font-bold">合同审批</h2>
      <div class="flex items-center gap-2 flex-wrap">
        <button @click="loadContractApprovals" class="text-xs px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600">刷新</button>
        <button v-if="configured" id="ca-submit-toggle" @click="toggleCaForm" class="text-sm text-white px-4 py-2 rounded-lg" style="background:var(--nec-cyan)">＋ 提交审批单</button>
      </div>
    </div>

    <!-- 提交表单（默认折叠） -->
    <div v-if="formOpen && authed" id="ca-form-box" class="mb-6 bg-white rounded-xl shadow p-5">
      <h3 class="font-bold mb-3">提交合同审批单</h3>
      <form id="ca-form" class="grid grid-cols-1 sm:grid-cols-2 gap-3" @submit.prevent="submitCa">
        <div>
          <label class="block text-xs text-gray-500 mb-1">合同名称 *</label>
          <input v-model="form.contractName" required class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="XX 采购合同" />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">合同编号</label>
          <input v-model="form.contractNumber" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="HT-2026-001" />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">合同类型</label>
          <select v-model="form.contractType" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
            <option value="purchase">采购合同</option>
            <option value="sales">销售合同</option>
            <option value="service">服务合同</option>
            <option value="partnership">合作协议</option>
            <option value="nda">保密协议</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">合同各方（逗号分隔）</label>
          <input v-model="form.parties" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="常州工NEC, 供应商名称" />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">生效日期</label>
          <input v-model="form.effectiveDate" type="date" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">到期日期</label>
          <input v-model="form.expirationDate" type="date" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div class="sm:col-span-2">
          <label class="block text-xs text-gray-500 mb-1">合同文件 *（每行一个：名称|token或URL）</label>
          <textarea v-model="form.contractFiles" rows="2" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm mono" placeholder="采购合同V1.pdf|https://... 或飞书文件 token"></textarea>
        </div>
        <div class="sm:col-span-2">
          <label class="block text-xs text-gray-500 mb-1">会签审批人 *（每行一个：级别 open_id [姓名]，全部通过方生效）</label>
          <textarea v-model="form.approvers" rows="2" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm mono" placeholder="team_lead ou_xxxxx 张三&#10;finance ou_yyyyy 李四"></textarea>
        </div>
        <div class="sm:col-span-2">
          <label class="block text-xs text-gray-500 mb-1">摘要</label>
          <textarea v-model="form.summary" rows="2" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="合同背景、金额、关键条款"></textarea>
        </div>
        <div class="sm:col-span-2 flex justify-end gap-2">
          <button type="button" @click="toggleCaForm" class="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-500">取消</button>
          <button type="submit" id="ca-submit-btn" :disabled="submitting" class="text-sm text-white px-5 py-2 rounded-lg disabled:opacity-50" style="background:var(--nec-navy)">{{ submitting ? '提交中…' : '提交审批单' }}</button>
        </div>
      </form>
      <p id="ca-form-result" class="mt-2 text-sm" :class="formResultOk ? 'text-green-600' : 'text-red-600'">{{ formResult }}</p>
    </div>

    <template v-if="!authed">
      <EmptyState text="登录后可使用合同审批流程" />
    </template>
    <template v-else>
      <!-- 503 未配置引导态：不报错白屏，给出 config_contract_approval 配置 Prompt -->
      <ConfigGuide v-if="loadState === 'guide'" icon="📝" title="合同审批流程尚未配置"
        description="后端已就绪，但还没有绑定飞书多维表格（网关返回 503）。把下面的 Prompt 发给已接入 NEC-MCP 的 Agent 完成配置："
        :prompt="CA_GUIDE_PROMPT"
        footnote="需要的表：approvals（审批单）/ comments（审批评论）/ events（流程事件）。配置完成后点击「刷新」。" />
      <EmptyState v-else-if="loadState === 'unauthorized'" text="登录已过期，请重新登录" />
      <EmptyState v-else-if="loadState === 'error'" tone="danger" :text="'加载失败：' + errorMsg" />
      <template v-else>
        <!-- 状态统计条（兼作状态筛选） -->
        <FilterChips id="ca-stats" :chips="chips" :active="filter" @select="filterCa" />

        <!-- 审批单列表 -->
        <div id="ca-list" class="space-y-3">
          <EmptyState v-if="loadState === 'loading'" text="加载中…" />
          <EmptyState v-else-if="!shown.length" text="暂无审批单，点击右上角「＋ 提交审批单」开始" />
          <div v-for="r in shown" :key="r.approvalId" class="bg-white rounded-xl shadow p-4">
            <div class="flex items-start justify-between gap-3 cursor-pointer" @click="toggleCaDetail(r.approvalId)">
              <div>
                <p class="font-bold text-slate-800">{{ r.contractName }} <span class="text-xs font-normal text-gray-400">{{ r.approvalId }}</span></p>
                <p class="text-xs text-gray-500 mt-0.5">{{ CA_TYPE[r.contractType] || r.contractType || '—' }}{{ r.contractNumber ? ' · 编号 ' + r.contractNumber : '' }} · 提交人 {{ r.submittedBy }}</p>
              </div>
              <StatusBadge :label="statusMeta(r.status).label" :cls="statusMeta(r.status).cls" />
            </div>
            <p class="text-sm text-gray-600 mt-2 line-clamp-2">{{ r.summary }}</p>
            <p class="text-xs text-gray-400 mt-1">{{ r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN') : '' }}</p>
            <div v-if="expanded[r.approvalId]" :id="`ca-detail-${r.approvalId}`" class="mt-3 pt-3 border-t border-gray-100 space-y-2 text-sm">
              <p v-if="(r.parties || []).length">合同各方：{{ r.parties.join('、') }}</p>
              <p v-if="r.effectiveDate || r.expirationDate">有效期：{{ r.effectiveDate || '—' }} ~ {{ r.expirationDate || '—' }}</p>
              <template v-if="(r.contractFiles || []).length">
                <p class="text-xs font-bold text-slate-700 pt-1">合同文件</p>
                <ul class="list-disc pl-4 text-xs text-gray-600 space-y-0.5">
                  <li v-for="(f, i) in r.contractFiles" :key="i">
                    <a v-if="f.url" :href="f.url" target="_blank" class="underline" style="color:var(--nec-cyan)">{{ f.name }}</a>
                    <template v-else>{{ f.name }} <span class="mono text-gray-400">{{ f.token }}</span></template>
                  </li>
                </ul>
              </template>
              <p class="text-xs font-bold text-slate-700 pt-1">会签审批人（全部通过方生效）</p>
              <ul v-if="(r.approvers || []).length" class="space-y-1">
                <li v-for="(a, i) in r.approvers" :key="i" class="flex items-center gap-2 flex-wrap">
                  <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{{ CA_LEVEL[a.level] || a.level }}</span>
                  <span>{{ a.name || a.approverId }}</span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded-full" :class="decisionMeta(a.status).cls">{{ decisionMeta(a.status).label }}</span>
                  <span v-if="a.comment" class="text-xs text-gray-400">{{ a.comment }}</span>
                </li>
              </ul>
              <p v-else class="text-xs text-gray-400">未指定</p>
              <div v-if="detailActions(r).length" class="flex flex-wrap gap-2 pt-1">
                <button v-for="a in detailActions(r)" :key="a.key" @click="runAction(r.approvalId, a.key)"
                        class="text-xs px-3 py-1.5 rounded-lg text-white" :class="a.cls" :style="a.style || ''">{{ a.label }}</button>
              </div>
              <p v-else class="text-xs text-gray-400">当前状态暂无可执行操作</p>
              <div :id="`ca-comments-${r.approvalId}`" class="pt-2 mt-1 border-t border-gray-100">
                <template v-if="comments[r.approvalId]">
                  <p v-if="comments[r.approvalId].loading" class="text-xs text-gray-400">评论加载中…</p>
                  <p v-else-if="comments[r.approvalId].error" class="text-xs text-red-500">评论加载失败：{{ comments[r.approvalId].error }}</p>
                  <p v-else-if="!comments[r.approvalId].list?.length" class="text-xs text-gray-400">暂无审批评论</p>
                  <template v-else>
                    <p class="text-xs font-bold text-slate-700">审批评论（{{ comments[r.approvalId].list!.length }}）</p>
                    <p v-for="(c, i) in comments[r.approvalId].list" :key="i" class="text-xs text-gray-600 mt-1">
                      <span class="mono text-gray-400">{{ c.reviewerId }}</span> · {{ new Date(c.timestamp).toLocaleString('zh-CN') }}：{{ c.content }}
                    </p>
                  </template>
                </template>
              </div>
              <p v-if="actTips[r.approvalId]?.msg" :id="`ca-act-${r.approvalId}`" class="text-xs" :class="actTips[r.approvalId].tone === 'ok' ? 'text-green-600' : 'text-red-500'">{{ actTips[r.approvalId].msg }}</p>
            </div>
          </div>
        </div>
      </template>
    </template>
  </section>
</template>
