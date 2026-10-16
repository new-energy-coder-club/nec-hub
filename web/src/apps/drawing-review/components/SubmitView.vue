<script setup lang="ts">
// 提交图纸报告书表单（原 #view-submit）：字段、校验、提交报文与原单文件版一致
// 并入原门户 Tab 能力：/start 智能默认值、项目/机型联想建议（/suggestions）、登录态预填设计负责人
import { reactive, ref, onMounted, onBeforeUnmount } from 'vue'
import { auth } from '@shared/auth'
import { apiDr } from '@shared/api'

const emit = defineEmits<{ (e: 'submitted'): void }>()

const form = reactive({
  projectId: '',
  machineName: '',
  drawingVersion: '',
  designerId: '',
  designNotes: '',
})
const result = ref<{ ok: boolean; text: string } | null>(null)

// ---- 联想建议（项目编号 / 机型名称，≥2 字符触发，300ms 防抖） ----
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
  } catch { /* 联想失败静默，不阻塞填写 */ }
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

// 智能默认值：沿用上一单的项目/机型/版本/说明（仅填空白字段）
async function loadDefaults() {
  try {
    const data = await apiDr('/start')
    const d = data.defaults || {}
    if (!form.projectId && d.projectId) form.projectId = d.projectId
    if (!form.machineName && d.machineName) form.machineName = d.machineName
    if (!form.drawingVersion && d.drawingVersion) form.drawingVersion = d.drawingVersion
    if (!form.designNotes && d.designNotes) form.designNotes = d.designNotes
  } catch { /* 默认值加载失败静默 */ }
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  if (auth.me.user && !form.designerId) form.designerId = auth.me.user.open_id
  loadDefaults()
})
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

async function onSubmit() {
  try {
    const data = await apiDr('/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: form.projectId,
        machineName: form.machineName,
        drawingVersion: form.drawingVersion,
        designerId: form.designerId,
        drawingFiles: [],
        designNotes: form.designNotes,
      }),
    })
    result.value = { ok: true, text: `提交成功：${data.reviewId}` }
    Object.keys(form).forEach(k => { (form as Record<string, string>)[k] = '' })
    emit('submitted')
  } catch (err) {
    result.value = { ok: false, text: '失败：' + (err as Error).message }
  }
}
</script>

<template>
  <section id="view-submit">
    <div class="nec-card p-5">
      <h2 class="text-lg font-bold text-nec-ink mb-1">提交图纸报告书</h2>
      <p class="mono text-xs text-nec-gray mb-4 tracking-wider">DRAWING REVIEW SUBMISSION</p>
      <form id="submit-form" class="space-y-4" @submit.prevent="onSubmit">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="relative">
            <label class="block text-sm font-medium text-nec-navy mb-1">项目编号</label>
            <input type="text" name="projectId" v-model="form.projectId" required class="mono w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="PRJ-2026-001"
                   @input="handleInput('project')"
                   @focus="showSuggestionsOnFocus('project')" />
            <div v-show="suggestOpen.project" id="project-suggestions" class="absolute z-10 w-full mt-1 rounded-lg shadow-lg max-h-40 overflow-y-auto" style="background:var(--nec-paper);border:1px solid var(--nec-line)">
              <div v-for="s in suggestions.project" :key="s.value" class="px-3 py-2 cursor-pointer" style="border-bottom:1px solid var(--nec-line)"
                   @click="selectSuggestion('project', s.value)">
                <div class="text-sm font-medium text-nec-ink">{{ s.label }}</div>
                <div v-if="s.count" class="text-xs text-nec-gray">使用 {{ s.count }} 次</div>
              </div>
            </div>
          </div>
          <div class="relative">
            <label class="block text-sm font-medium text-nec-navy mb-1">机型名称</label>
            <input type="text" name="machineName" v-model="form.machineName" required class="w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="R1 底盘"
                   @input="handleInput('machine')"
                   @focus="showSuggestionsOnFocus('machine')" />
            <div v-show="suggestOpen.machine" id="machine-suggestions" class="absolute z-10 w-full mt-1 rounded-lg shadow-lg max-h-40 overflow-y-auto" style="background:var(--nec-paper);border:1px solid var(--nec-line)">
              <div v-for="s in suggestions.machine" :key="s.value" class="px-3 py-2 cursor-pointer" style="border-bottom:1px solid var(--nec-line)"
                   @click="selectSuggestion('machine', s.value)">
                <div class="text-sm font-medium text-nec-ink">{{ s.label }}</div>
                <div v-if="s.count" class="text-xs text-nec-gray">使用 {{ s.count }} 次</div>
              </div>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-nec-navy mb-1">图纸版本</label>
            <input type="text" name="drawingVersion" v-model="form.drawingVersion" required class="mono w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="V1.0" />
          </div>
          <div>
            <label class="block text-sm font-medium text-nec-navy mb-1">设计负责人 open_id</label>
            <input type="text" name="designerId" v-model="form.designerId" required class="mono w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="ou_xxx" />
            <p v-if="auth.me.user && form.designerId === auth.me.user.open_id" class="text-xs text-nec-gray mt-1">当前登录：{{ auth.me.user.name }}</p>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-nec-navy mb-1">设计说明</label>
          <textarea name="designNotes" v-model="form.designNotes" rows="3" required class="w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="关键设计参数、变更点"></textarea>
        </div>
        <div class="flex justify-end">
          <button type="submit" class="btn-primary text-sm font-medium px-5 py-2 rounded-lg">提交评审单</button>
        </div>
      </form>
      <p v-if="result" id="submit-result" class="mt-3 text-sm" :class="result.ok ? 'text-green-600' : 'text-red-600'">{{ result.text }}</p>
    </div>
  </section>
</template>
