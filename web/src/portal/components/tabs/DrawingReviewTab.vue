<script setup lang="ts">
// 图纸评审（原生集成，登录后可见）：提交表单 + 联想建议、看板/列表、详情、流程看板 + 甘特图
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { auth } from '@shared/auth'
import { apiDr } from '@shared/api'
import { tabs, switchTab } from '@portal/composables/useTabs'
import { DR_STATUS } from '../dr/dr-status'
import DrBoard from '../dr/DrBoard.vue'
import DrDetail from '../dr/DrDetail.vue'
import DrFlowBoard from '../dr/DrFlowBoard.vue'

const authed = computed(() => !!(auth.me.authenticated && auth.me.user))

const mode = ref<'board' | 'list'>(authed.value ? 'board' : 'list')
const filter = ref('')
const list = ref<any[]>([])
const counts = ref<Record<string, number>>({})
const loadError = ref('')
const loaded = ref(false)
const expanded = ref<Record<string, boolean>>({})
const flowBoardRef = ref<InstanceType<typeof DrFlowBoard> | null>(null)

// ---- 提交表单 ----
const formOpen = ref(false)
const form = reactive({ projectId: '', machineName: '', drawingVersion: '', designNotes: '' })
const formResult = ref('')
const formResultOk = ref(true)
const submitting = ref(false)
let defaultsLoaded = false

const designerName = computed(() => auth.me.user ? `${auth.me.user.name}（${auth.me.user.open_id}）` : '')

function toggleDrForm() {
  formOpen.value = !formOpen.value
  if (formOpen.value && !defaultsLoaded) {
    defaultsLoaded = true
    loadFormDefaults()
  }
}

// 加载表单默认值（智能默认值：沿用上一单的项目/机型/版本/说明）
async function loadFormDefaults() {
  try {
    const data = await apiDr('/start')
    if (data.ok && data.defaults) {
      if (data.defaults.projectId) form.projectId = data.defaults.projectId
      if (data.defaults.machineName) form.machineName = data.defaults.machineName
      if (data.defaults.drawingVersion) form.drawingVersion = data.defaults.drawingVersion
      if (data.defaults.designNotes) form.designNotes = data.defaults.designNotes
      formResultOk.value = true
      formResult.value = '✅ 已加载智能默认值'
      setTimeout(() => { if (formResult.value === '✅ 已加载智能默认值') formResult.value = '' }, 3000)
    }
  } catch (err) {
    console.error('加载默认值失败:', err)
  }
}

// ---- 联想建议 ----
let suggestionTimeout: ReturnType<typeof setTimeout> | undefined
const suggestions = reactive<{ project: any[]; machine: any[] }>({ project: [], machine: [] })
const suggestOpen = reactive({ project: false, machine: false })

function handleInput(type: 'project' | 'machine') {
  clearTimeout(suggestionTimeout)
  const query = (type === 'project' ? form.projectId : form.machineName).trim()
  if (query.length < 2) {
    suggestOpen[type] = false
    return
  }
  suggestionTimeout = setTimeout(() => fetchSuggestions(query, type), 300)
}

function showSuggestionsOnFocus(type: 'project' | 'machine') {
  const query = (type === 'project' ? form.projectId : form.machineName).trim()
  if (query.length >= 2) fetchSuggestions(query, type)
}

async function fetchSuggestions(query: string, type: 'project' | 'machine') {
  try {
    const projectId = type === 'machine' ? form.projectId : undefined
    const url = `/suggestions?q=${encodeURIComponent(query)}&type=${type}${projectId ? '&projectId=' + encodeURIComponent(projectId) : ''}`
    const data = await apiDr(url)
    if (data.ok && data.suggestions) {
      suggestions[type] = data.suggestions
      suggestOpen[type] = data.suggestions.length > 0
    }
  } catch (err) {
    console.error('获取联想建议失败:', err)
  }
}

function selectSuggestion(type: 'project' | 'machine', value: string) {
  if (type === 'project') {
    form.projectId = value
    suggestOpen.project = false
    // 项目选择后自动触发机型联想
    setTimeout(() => {
      if (form.machineName.length >= 2) fetchSuggestions(form.machineName, 'machine')
    }, 100)
  } else {
    form.machineName = value
    suggestOpen.machine = false
  }
}

// 点击外部隐藏联想
function onDocClick(e: MouseEvent) {
  const t = e.target as HTMLElement
  if (!t.closest('#project-suggestions') && !t.closest('input[name="projectId"]')) suggestOpen.project = false
  if (!t.closest('#machine-suggestions') && !t.closest('input[name="machineName"]')) suggestOpen.machine = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

async function submitDr() {
  if (submitting.value || !auth.me.user) return
  submitting.value = true
  try {
    const data = await apiDr('/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: form.projectId.trim(),
        machineName: form.machineName.trim(),
        drawingVersion: form.drawingVersion.trim(),
        designerId: auth.me.user.open_id,
        drawingFiles: [],
        designNotes: form.designNotes.trim(),
      }),
    })
    formResultOk.value = true
    formResult.value = `提交成功：${data.reviewId}，请在列表中点击「预约会议」`
    form.projectId = ''; form.machineName = ''; form.drawingVersion = ''; form.designNotes = ''
    setTimeout(() => { formOpen.value = false; formResult.value = '' }, 1500)
    loadDrawingReviews()
  } catch (err: any) {
    formResultOk.value = false
    formResult.value = '提交失败：' + err.message
  } finally {
    submitting.value = false
  }
}

// ---- 列表 / 看板数据 ----
async function loadDrawingReviews() {
  if (!authed.value) return
  loadError.value = ''
  try {
    const data: any[] = await apiDr('')
    const c: Record<string, number> = {}
    data.forEach(r => { c[r.status] = (c[r.status] || 0) + 1 })
    counts.value = c
    list.value = data
    loaded.value = true
    flowBoardRef.value?.reload()
  } catch (err: any) {
    loadError.value = err.message
  }
}

const shown = computed(() => filter.value ? list.value.filter(r => r.status === filter.value) : list.value)

const chips = computed(() => {
  const arr = Object.entries(DR_STATUS)
    .filter(([k]) => counts.value[k])
    .map(([k, v]) => ({ key: k, label: `${v.label} · ${counts.value[k]}` }))
  arr.push({ key: '', label: `全部 · ${list.value.length}` })
  return arr
})

function filterDr(status: string) {
  filter.value = status
  loadDrawingReviews()
}

function setDrMode(m: 'board' | 'list') {
  mode.value = m
}

/** 看板卡片/流程看板/甘特图点击 → 切到列表并展开该评审单详情 */
async function drOpen(reviewId: string) {
  setDrMode('list')
  expanded.value[reviewId] = true
  await nextTick()
  document.getElementById(`dr-detail-${reviewId}`)?.closest('.bg-white')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function toggleDrDetail(reviewId: string) {
  expanded.value[reviewId] = !expanded.value[reviewId]
}

function reviewOf(reviewId: string) {
  return list.value.find(r => r.reviewId === reviewId)
}

function statusMeta(s: string) {
  return DR_STATUS[s] || { label: s, cls: 'bg-gray-100 text-gray-600' }
}

// ---- 登录门控：显示/隐藏「图纸评审」数据；登出时若正停在该 Tab 则跳回应用广场 ----
watch(authed, (now, before) => {
  if (now) {
    mode.value = 'board'
    loadDrawingReviews()
  } else {
    if (tabs.active === 'drawing-review') switchTab('apps')
    mode.value = 'list'
    list.value = []
    counts.value = {}
    loaded.value = false
    formOpen.value = false
  }
})
onMounted(() => { if (authed.value) loadDrawingReviews() })
</script>

<template>
  <section id="tab-drawing-review">
    <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
      <h2 class="text-lg font-bold">图纸评审</h2>
      <div class="flex items-center gap-2 flex-wrap">
        <div class="flex rounded-lg border border-gray-200 overflow-hidden text-xs bg-white">
          <button id="dr-mode-board" @click="setDrMode('board')" class="px-3 py-2"
                  :class="mode === 'board' ? 'text-white' : 'text-gray-600'" :style="mode === 'board' ? 'background:var(--nec-navy)' : ''">看板</button>
          <button id="dr-mode-list" @click="setDrMode('list')" class="px-3 py-2 border-l border-gray-200"
                  :class="mode === 'list' ? 'text-white' : 'text-gray-600'" :style="mode === 'list' ? 'background:var(--nec-navy)' : ''">列表</button>
        </div>
        <button @click="loadDrawingReviews" class="text-xs px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600">刷新</button>
        <button v-if="authed" @click="toggleDrForm" class="text-sm text-white px-4 py-2 rounded-lg" style="background:var(--nec-cyan)">＋ 提交评审单</button>
      </div>
    </div>

    <!-- 提交表单（默认折叠） -->
    <div v-if="formOpen && authed" id="dr-form-box" class="mb-6 bg-white rounded-xl shadow p-5">
      <h3 class="font-bold mb-3">提交图纸报告书</h3>
      <form id="dr-form" class="grid grid-cols-1 sm:grid-cols-2 gap-3" @submit.prevent="submitDr">
        <div class="relative">
          <label class="block text-xs text-gray-500 mb-1">项目编号 *</label>
          <input name="projectId" v-model="form.projectId" required class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                 placeholder="PRJ-2026-001"
                 @input="handleInput('project')"
                 @focus="showSuggestionsOnFocus('project')" />
          <div v-show="suggestOpen.project" id="project-suggestions" class="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
            <div v-for="s in suggestions.project" :key="s.value" class="px-3 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-100 last:border-b-0"
                 @click="selectSuggestion('project', s.value)">
              <div class="text-sm font-medium text-gray-800">{{ s.label }}</div>
              <div v-if="s.count" class="text-xs text-gray-500">使用 {{ s.count }} 次</div>
            </div>
          </div>
        </div>
        <div class="relative">
          <label class="block text-xs text-gray-500 mb-1">机型名称 *</label>
          <input name="machineName" v-model="form.machineName" required class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                 placeholder="R1 底盘"
                 @input="handleInput('machine')"
                 @focus="showSuggestionsOnFocus('machine')" />
          <div v-show="suggestOpen.machine" id="machine-suggestions" class="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
            <div v-for="s in suggestions.machine" :key="s.value" class="px-3 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-100 last:border-b-0"
                 @click="selectSuggestion('machine', s.value)">
              <div class="text-sm font-medium text-gray-800">{{ s.label }}</div>
              <div v-if="s.count" class="text-xs text-gray-500">使用 {{ s.count }} 次</div>
            </div>
          </div>
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">图纸版本 *</label>
          <input name="drawingVersion" v-model="form.drawingVersion" required class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="V1.0" />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">设计负责人</label>
          <input name="designerName" id="dr-designer-name" disabled :value="designerName" class="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500" />
        </div>
        <div class="sm:col-span-2">
          <label class="block text-xs text-gray-500 mb-1">设计说明 *</label>
          <textarea name="designNotes" v-model="form.designNotes" rows="3" required class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="关键设计参数、变更点"></textarea>
        </div>
        <div class="sm:col-span-2 flex justify-end gap-2">
          <button type="button" @click="toggleDrForm" class="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-500">取消</button>
          <button type="submit" id="dr-submit-btn" :disabled="submitting" class="text-sm text-white px-5 py-2 rounded-lg disabled:opacity-50" style="background:var(--nec-navy)">{{ submitting ? '提交中…' : '提交评审单' }}</button>
        </div>
      </form>
      <p id="dr-form-result" class="mt-2 text-sm" :class="formResultOk ? (formResult.startsWith('✅ 已加载') ? 'text-blue-600' : 'text-green-600') : 'text-red-600'">{{ formResult }}</p>
    </div>

    <DrFlowBoard v-if="authed" ref="flowBoardRef" @open="drOpen" />

    <!-- 状态统计条（兼作状态筛选，看板/列表共用） -->
    <div id="dr-stats" class="flex flex-wrap gap-2 mb-4">
      <button v-for="c in chips" :key="c.key" @click="filterDr(c.key)"
              class="text-xs px-3 py-1.5 rounded-full border"
              :class="filter === c.key ? 'text-white border-transparent' : 'border-gray-200 text-gray-600'"
              :style="filter === c.key ? 'background:var(--nec-navy)' : ''">{{ c.label }}</button>
    </div>

    <template v-if="!authed">
      <p v-show="mode === 'list'" class="text-sm text-gray-400 bg-white rounded-xl shadow p-8 text-center">登录后可使用图纸评审流程</p>
    </template>
    <template v-else>
      <p v-if="loadError && mode === 'board'" class="text-sm text-red-500 bg-white rounded-xl shadow p-8 text-center sm:col-span-2 lg:col-span-3">加载失败：{{ loadError }}</p>
      <!-- 看板视图（默认） -->
      <DrBoard v-else-if="loaded || list.length" v-show="mode === 'board'" :data="list" :counts="counts" :filter="filter" @open="drOpen" />
      <p v-if="loadError && mode === 'list'" class="text-sm text-red-500 bg-white rounded-xl shadow p-8 text-center">加载失败：{{ loadError }}</p>
      <!-- 评审单列表 -->
      <div v-else v-show="mode === 'list'" id="dr-list" class="space-y-3">
        <p v-if="!loaded" class="text-sm text-gray-400 bg-white rounded-xl shadow p-8 text-center">加载中…</p>
        <p v-else-if="!shown.length" class="text-sm text-gray-400 bg-white rounded-xl shadow p-8 text-center">暂无评审单，点击右上角「＋ 提交评审单」开始</p>
        <div v-for="r in shown" :key="r.reviewId" class="bg-white rounded-xl shadow p-4">
          <div class="flex items-start justify-between gap-3 cursor-pointer" @click="toggleDrDetail(r.reviewId)">
            <div>
              <p class="font-bold text-slate-800">{{ r.machineName }} <span class="text-xs font-normal text-gray-400">{{ r.reviewId }}</span></p>
              <p class="text-xs text-gray-500 mt-0.5">项目 {{ r.projectId }} · 版本 {{ r.drawingVersion }} · 设计 {{ r.designerId }}</p>
            </div>
            <span class="text-xs px-2 py-1 rounded-full whitespace-nowrap" :class="statusMeta(r.status).cls">{{ statusMeta(r.status).label }}</span>
          </div>
          <p class="text-sm text-gray-600 mt-2 line-clamp-2">{{ r.designNotes }}</p>
          <div v-if="expanded[r.reviewId]" :id="`dr-detail-${r.reviewId}`">
            <DrDetail v-if="reviewOf(r.reviewId)" :review="reviewOf(r.reviewId)" @changed="loadDrawingReviews" />
          </div>
        </div>
      </div>
    </template>
    <p class="text-xs text-gray-400 mt-3">
      独立全屏版：<a href="/apps/drawing-review/" target="_blank" class="hover:underline" style="color:var(--nec-cyan)">/apps/drawing-review/ →</a>
    </p>
  </section>
</template>
