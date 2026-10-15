<script setup lang="ts">
// 硬件评审/申购（ST-04，登录后可见，收进「更多」）：列表 + 详情 + 提交表单，模式对齐 DrawingReviewTab
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { auth } from '@shared/auth'
import { apiMod } from '@shared/api'
import { tabs, switchTab } from '@portal/composables/useTabs'
import StatusBadge from '@shared/ui/StatusBadge.vue'
import EmptyState from '@shared/ui/EmptyState.vue'
import FilterChips from '@shared/ui/FilterChips.vue'
import ConfigGuide from '@shared/ui/ConfigGuide.vue'

const HW_API = '/api/hardware-review'
const HW_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: '待提交', cls: 'bg-gray-100 text-gray-600' },
  pending_review: { label: '待评审', cls: 'bg-blue-50 text-blue-700' },
  in_review: { label: '评审中', cls: 'bg-amber-50 text-amber-700' },
  rectifying: { label: '待整改', cls: 'bg-orange-50 text-orange-700' },
  report_generating: { label: '报告生成中', cls: 'bg-purple-50 text-purple-700' },
  assessing: { label: '评估中', cls: 'bg-indigo-50 text-indigo-700' },
  approved: { label: '已通过', cls: 'bg-green-50 text-green-700' },
  archived: { label: '已归档', cls: 'bg-gray-100 text-gray-500' },
}
const HW_TYPE: Record<string, string> = {
  controller: '控制器', sensor: '传感器', actuator: '执行器', motor: '电机/驱动',
  power: '电源/电池', communication: '通信模块', structure: '结构件', other: '其他',
}
const HW_GUIDE_PROMPT = `请配置 NEC-MCP 硬件评审流程：
调用 NEC-MCP 的 config_hardware_review 工具：
- action: set
- base: <飞书多维表格 app_token>
- tables: 映射 { reviews, minutes, rectifications, reports, events } 到各自的 table_id
完成后告诉我配置结果`

const authed = computed(() => !!(auth.me.authenticated && auth.me.user))
const designerName = computed(() => auth.me.user ? `${auth.me.user.name}（${auth.me.user.open_id}）` : '')

const filter = ref('')
const list = ref<any[]>([])
const counts = ref<Record<string, number>>({})
const byId = ref<Record<string, any>>({})
const configured = ref(true)
// loadState：loading / ok / guide(503 未配置) / unauthorized(401) / error
const loadState = ref<'loading' | 'ok' | 'guide' | 'unauthorized' | 'error'>('loading')
const errorMsg = ref('')
const expanded = reactive<Record<string, boolean>>({})
const reports = reactive<Record<string, { loading: boolean; data?: any; error?: string }>>({})
const actTips = reactive<Record<string, { tone: 'ok' | 'err' | 'warn'; msg: string }>>({})

// ---- 提交表单 ----
const formOpen = ref(false)
const form = reactive({ projectId: '', hardwareName: '', hardwareType: 'other', hardwareVersion: '', specification: '', designNotes: '' })
const formResult = ref('')
const formResultOk = ref(true)
const submitting = ref(false)

function toggleHwForm() { formOpen.value = !formOpen.value }

function hwApi(path: string, options?: RequestInit) { return apiMod(HW_API, path, options) }

async function loadHardwareReviews() {
  if (!authed.value) return
  try {
    const data: any[] = await hwApi('')
    configured.value = true
    const c: Record<string, number> = {}
    data.forEach(r => { c[r.status] = (c[r.status] || 0) + 1 })
    counts.value = c
    list.value = data
    byId.value = Object.fromEntries(data.map(r => [r.reviewId, r]))
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
  const arr = Object.entries(HW_STATUS)
    .filter(([k]) => counts.value[k])
    .map(([k, v]) => ({ key: k, label: `${v.label} · ${counts.value[k]}` }))
  arr.push({ key: '', label: `全部 · ${list.value.length}` })
  return arr
})

function filterHw(status: string) {
  filter.value = status
  loadHardwareReviews()
}

function statusMeta(s: string) {
  return HW_STATUS[s] || { label: s, cls: 'bg-gray-100 text-gray-600' }
}

function toggleHwDetail(reviewId: string) {
  expanded[reviewId] = !expanded[reviewId]
}

function detailActions(r: any): { key: string; label: string; cls: string; style?: string }[] {
  const acts: { key: string; label: string; cls: string; style?: string }[] = []
  if (r.status === 'pending_review') acts.push({ key: 'meeting', label: '预约会议', cls: '', style: 'background:var(--nec-cyan)' })
  if (r.status === 'in_review') acts.push({ key: 'conclude', label: '提交评审结论', cls: '', style: 'background:var(--nec-navy)' })
  if (r.status === 'rectifying') acts.push({ key: 'rectify', label: '整改完成', cls: 'bg-orange-500' })
  if (r.status === 'report_generating') acts.push({ key: 'report', label: '生成评审报告', cls: 'bg-purple-600' })
  if (r.status === 'assessing') {
    acts.push({ key: 'assess-pass', label: '评估通过', cls: 'bg-green-600' })
    acts.push({ key: 'assess-fail', label: '评估不通过', cls: 'bg-red-500' })
  }
  if (r.status === 'approved') acts.push({ key: 'archive', label: '归档', cls: 'bg-gray-600' })
  return acts
}

function canViewReport(r: any): boolean {
  return ['assessing', 'approved', 'archived'].includes(r.status)
}

function setTip(id: string, tone: 'ok' | 'err' | 'warn', msg: string) { actTips[id] = { tone, msg } }

async function hwAct(reviewId: string, path: string, body: any, okMsg: string) {
  try {
    await hwApi(`/${reviewId}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    setTip(reviewId, 'ok', okMsg)
    setTimeout(loadHardwareReviews, 600)
  } catch (err: any) {
    setTip(reviewId, 'err', '失败：' + err.message)
  }
}

async function runAction(reviewId: string, key: string) {
  if (key === 'meeting') return hwMeeting(reviewId)
  if (key === 'conclude') return hwConclude(reviewId)
  if (key === 'rectify') return hwAct(reviewId, '/rectify', {}, '整改已完成，进入报告生成')
  if (key === 'report') return hwReport(reviewId)
  if (key === 'assess-pass') return hwAct(reviewId, '/assess', { result: 'pass' }, '评估通过，可归档')
  if (key === 'assess-fail') return hwAct(reviewId, '/assess', { result: 'fail' }, '评估不通过，退回待提交')
  if (key === 'archive') return hwAct(reviewId, '/archive', {}, '已归档')
}

async function hwMeeting(id: string) {
  try {
    const data = await hwApi(`/${id}/meeting`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (data.meeting?.mock) {
      setTip(id, 'warn', `会议 API 未打通（${data.meeting.mockReason || '权限/网络'}），已生成占位会议号 ${data.meeting.meetingId}，请人工建会后补录链接`)
    } else {
      setTip(id, 'ok', '会议已预约')
    }
    setTimeout(loadHardwareReviews, 600)
  } catch (err: any) {
    setTip(id, 'err', '失败：' + err.message)
  }
}

function hwConclude(id: string) {
  const c = prompt('评审结论：passed（通过）/ conditional（有条件通过）/ rejected（不通过）', 'passed')
  if (c === null) return
  if (!['passed', 'conditional', 'rejected'].includes(c)) { alert('无效结论'); return }
  const notes = prompt('结论说明（可留空）：', '') ?? ''
  hwAct(id, '/conclusion', { conclusion: c, notes }, '评审结论已提交')
}

function hwReport(id: string) {
  const summary = prompt('评审报告摘要（可留空）：', '')
  if (summary === null) return
  hwAct(id, '/report/generate', { summary }, '评审报告已生成，进入评估')
}

async function hwShowReport(reviewId: string) {
  reports[reviewId] = { loading: true }
  try {
    const data = await hwApi(`/${reviewId}/report`)
    reports[reviewId] = { loading: false, data: data.report || data }
  } catch (err: any) {
    reports[reviewId] = { loading: false, error: err.message }
  }
}

async function submitHw() {
  if (submitting.value || !auth.me.user) return
  submitting.value = true
  try {
    const data = await hwApi('/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: form.projectId.trim(),
        hardwareName: form.hardwareName.trim(),
        hardwareType: form.hardwareType,
        hardwareVersion: form.hardwareVersion.trim(),
        designerId: auth.me.user.open_id,
        hardwareFiles: [],
        designNotes: form.designNotes.trim(),
        specification: form.specification.trim(),
      }),
    })
    formResultOk.value = true
    formResult.value = `提交成功：${data.reviewId}，请在列表中点击「预约会议」`
    form.projectId = ''; form.hardwareName = ''; form.hardwareType = 'other'
    form.hardwareVersion = ''; form.specification = ''; form.designNotes = ''
    setTimeout(() => { formOpen.value = false; formResult.value = '' }, 1500)
    loadHardwareReviews()
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
    loadHardwareReviews()
  } else {
    if (tabs.active === 'hardware-review') switchTab('home')
    list.value = []
    counts.value = {}
    loadState.value = 'loading'
    formOpen.value = false
  }
})
onMounted(() => { if (authed.value) loadHardwareReviews() })
</script>

<template>
  <section id="tab-hardware-review">
    <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
      <h2 class="text-lg font-bold">硬件评审</h2>
      <div class="flex items-center gap-2 flex-wrap">
        <button @click="loadHardwareReviews" class="text-xs px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600">刷新</button>
        <button v-if="configured" id="hw-submit-toggle" @click="toggleHwForm" class="text-sm text-white px-4 py-2 rounded-lg" style="background:var(--nec-cyan)">＋ 提交评审单</button>
      </div>
    </div>

    <!-- 提交表单（默认折叠） -->
    <div v-if="formOpen && authed" id="hw-form-box" class="mb-6 bg-white rounded-xl shadow p-5">
      <h3 class="font-bold mb-3">提交硬件评审单</h3>
      <form id="hw-form" class="grid grid-cols-1 sm:grid-cols-2 gap-3" @submit.prevent="submitHw">
        <div>
          <label class="block text-xs text-gray-500 mb-1">项目编号</label>
          <input v-model="form.projectId" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="PRJ-2026-001" />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">硬件名称 *</label>
          <input v-model="form.hardwareName" required class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="R1 主控板" />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">硬件类型</label>
          <select v-model="form.hardwareType" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
            <option value="controller">控制器</option>
            <option value="sensor">传感器</option>
            <option value="actuator">执行器</option>
            <option value="motor">电机/驱动</option>
            <option value="power">电源/电池</option>
            <option value="communication">通信模块</option>
            <option value="structure">结构件</option>
            <option value="other">其他</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">硬件版本</label>
          <input v-model="form.hardwareVersion" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="V1.0（留空自动递增）" />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">设计负责人</label>
          <input id="hw-designer-name" disabled :value="designerName" class="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500" />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">规格参数</label>
          <input v-model="form.specification" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="电压/电流/功率/接口/防护等级" />
        </div>
        <div class="sm:col-span-2">
          <label class="block text-xs text-gray-500 mb-1">设计说明 *</label>
          <textarea v-model="form.designNotes" rows="3" required class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="关键设计参数、变更点"></textarea>
        </div>
        <div class="sm:col-span-2 flex justify-end gap-2">
          <button type="button" @click="toggleHwForm" class="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-500">取消</button>
          <button type="submit" id="hw-submit-btn" :disabled="submitting" class="text-sm text-white px-5 py-2 rounded-lg disabled:opacity-50" style="background:var(--nec-navy)">{{ submitting ? '提交中…' : '提交评审单' }}</button>
        </div>
      </form>
      <p id="hw-form-result" class="mt-2 text-sm" :class="formResultOk ? 'text-green-600' : 'text-red-600'">{{ formResult }}</p>
    </div>

    <template v-if="!authed">
      <EmptyState text="登录后可使用硬件评审流程" />
    </template>
    <template v-else>
      <!-- 503 未配置引导态：不报错白屏，给出 config_hardware_review 配置 Prompt -->
      <ConfigGuide v-if="loadState === 'guide'" icon="🔧" title="硬件评审流程尚未配置"
        description="后端已就绪，但还没有绑定飞书多维表格（网关返回 503）。把下面的 Prompt 发给已接入 NEC-MCP 的 Agent 完成配置："
        :prompt="HW_GUIDE_PROMPT"
        footnote="需要的表：reviews（评审单）/ minutes（纪要）/ rectifications（整改项）/ reports（评审报告）/ events（流程事件）。配置完成后点击「刷新」。" />
      <EmptyState v-else-if="loadState === 'unauthorized'" text="登录已过期，请重新登录" />
      <EmptyState v-else-if="loadState === 'error'" tone="danger" :text="'加载失败：' + errorMsg" />
      <template v-else>
        <!-- 状态统计条（兼作状态筛选） -->
        <FilterChips id="hw-stats" :chips="chips" :active="filter" @select="filterHw" />

        <!-- 评审单列表 -->
        <div id="hw-list" class="space-y-3">
          <EmptyState v-if="loadState === 'loading'" text="加载中…" />
          <EmptyState v-else-if="!shown.length" text="暂无评审单，点击右上角「＋ 提交评审单」开始" />
          <div v-for="r in shown" :key="r.reviewId" class="bg-white rounded-xl shadow p-4">
            <div class="flex items-start justify-between gap-3 cursor-pointer" @click="toggleHwDetail(r.reviewId)">
              <div>
                <p class="font-bold text-slate-800">{{ r.hardwareName }} <span class="text-xs font-normal text-gray-400">{{ r.reviewId }}</span></p>
                <p class="text-xs text-gray-500 mt-0.5">项目 {{ r.projectId || '—' }} · {{ HW_TYPE[r.hardwareType] || r.hardwareType || '其他' }} · 版本 {{ r.hardwareVersion }} · 设计 {{ r.designerId }}</p>
              </div>
              <StatusBadge :label="statusMeta(r.status).label" :cls="statusMeta(r.status).cls" />
            </div>
            <p class="text-sm text-gray-600 mt-2 line-clamp-2">{{ r.designNotes }}</p>
            <p class="text-xs text-gray-400 mt-1">{{ r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN') : '' }}</p>
            <div v-if="expanded[r.reviewId]" :id="`hw-detail-${r.reviewId}`" class="mt-3 pt-3 border-t border-gray-100 space-y-2 text-sm">
              <p v-if="r.specification">规格参数：{{ r.specification }}</p>
              <p v-if="r.meetingId">会议：
                <a v-if="r.meetingLink" :href="r.meetingLink" target="_blank" class="underline" style="color:var(--nec-cyan)">{{ r.meetingId }}</a>
                <span v-else class="mono">{{ r.meetingId }}</span>
                <template v-if="r.meetingStartTime"> · {{ new Date(r.meetingStartTime).toLocaleString('zh-CN') }}</template>
              </p>
              <p v-if="r.conclusion">评审结论：{{ r.conclusion }}<template v-if="r.conclusionNotes"> · {{ r.conclusionNotes }}</template></p>
              <div v-if="detailActions(r).length" class="flex flex-wrap gap-2 pt-1">
                <button v-for="a in detailActions(r)" :key="a.key" @click="runAction(r.reviewId, a.key)"
                        class="text-xs px-3 py-1.5 rounded-lg text-white" :class="a.cls" :style="a.style || ''">{{ a.label }}</button>
              </div>
              <p v-else class="text-xs text-gray-400">当前状态暂无可执行操作</p>
              <div v-if="canViewReport(r)" class="pt-1">
                <button @click="hwShowReport(r.reviewId)" class="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600">查看评审报告</button>
              </div>
              <div v-if="reports[r.reviewId]" :id="`hw-report-${r.reviewId}`">
                <p v-if="reports[r.reviewId].loading" class="text-xs text-gray-400">报告加载中…</p>
                <p v-else-if="reports[r.reviewId].error" class="text-xs text-red-500">报告加载失败：{{ reports[r.reviewId].error }}</p>
                <div v-else class="border border-indigo-100 rounded-lg bg-indigo-50/40 p-3 text-xs space-y-1">
                  <p class="font-bold text-indigo-800">评审报告 {{ reports[r.reviewId].data.reportId || '' }} · 结果：{{ reports[r.reviewId].data.result === 'pass' ? '通过' : '不通过' }}</p>
                  <p v-if="reports[r.reviewId].data.summary" class="text-gray-600">{{ reports[r.reviewId].data.summary }}</p>
                  <ul v-if="(reports[r.reviewId].data.checklist || []).length" class="list-disc pl-4 text-gray-600">
                    <li v-for="(it, i) in reports[r.reviewId].data.checklist" :key="i">{{ it.item }}：{{ it.result === 'pass' ? '✅' : it.result === 'fail' ? '❌' : '—' }}{{ it.note ? '（' + it.note + '）' : '' }}</li>
                  </ul>
                </div>
              </div>
              <p v-if="actTips[r.reviewId]?.msg" :id="`hw-act-${r.reviewId}`" class="text-xs"
                 :class="{ 'text-green-600': actTips[r.reviewId].tone === 'ok', 'text-red-500': actTips[r.reviewId].tone === 'err', 'text-amber-600': actTips[r.reviewId].tone === 'warn' }">{{ actTips[r.reviewId].msg }}</p>
            </div>
          </div>
        </div>
      </template>
    </template>
  </section>
</template>
