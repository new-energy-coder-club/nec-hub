<script setup lang="ts">
// 审批人选择器：级别下拉 + 姓名/ou_ 搜索（300ms 防抖调 /api/contract-approval/members）+ 点击添加 chip
// chips 顺序 = 会签顺序，支持原生 HTML5 拖拽排序，并给 ↑↓ 按钮兜底
import { ref, watch, onBeforeUnmount } from 'vue'
import { api, renderLevel, levelMap } from '../store'

export interface ApproverChip { level: string; approverId: string; name: string }
export interface MemberHit { name?: string; open_id: string }

const props = withDefaults(defineProps<{ modelValue: ApproverChip[]; error?: string; disabled?: boolean }>(),
  { error: '', disabled: false })
const emit = defineEmits<{ (e: 'update:modelValue', v: ApproverChip[]): void }>()

const level = ref('team_lead')
const q = ref('')
const searching = ref(false)
const results = ref<MemberHit[]>([])
const hint = ref('')
const showDropdown = ref(false)

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let blurTimer: ReturnType<typeof setTimeout> | null = null
const dragIdx = ref(-1)
const overIdx = ref(-1)

function shortOpenId(openId?: string): string {
  const id = openId || ''
  if (id.startsWith('ou_') && id.length > 8) return `ou_…${id.slice(-6)}`
  return id
}

function ul() { return props.modelValue as ApproverChip[] }
function sync(v: ApproverChip[]) { emit('update:modelValue', v) }

function addChip(m: MemberHit) {
  if (props.disabled || !m?.open_id) return
  if (ul().some(c => c.approverId === m.open_id)) {
    hint.value = '该队员已在审批人中'
    showDropdown.value = false
    return
  }
  sync([...ul(), { level: level.value, approverId: m.open_id, name: m.name || '' }])
  q.value = ''
  results.value = []
  hint.value = ''
  showDropdown.value = false
}

function removeChip(i: number) {
  sync(ul().filter((_, idx) => idx !== i))
}

function moveChip(i: number, delta: number) {
  const j = i + delta
  if (j < 0 || j >= ul().length) return
  const next = [...ul()]
  const [item] = next.splice(i, 1)
  next.splice(j, 0, item)
  sync(next)
}

/* ---------- 原生 HTML5 拖拽排序 ---------- */
function onDragStart(i: number, e: DragEvent) {
  if (props.disabled) { e.preventDefault(); return }
  dragIdx.value = i
  e.dataTransfer?.setData('text/plain', String(i))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDragOver(i: number, e: DragEvent) {
  e.preventDefault()
  overIdx.value = i
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}
function onDragLeave() { overIdx.value = -1 }
function onDrop(i: number, e: DragEvent) {
  e.preventDefault()
  overIdx.value = -1
  const from = dragIdx.value
  dragIdx.value = -1
  if (from < 0 || from === i) return
  const next = [...ul()]
  const [item] = next.splice(from, 1)
  next.splice(i, 0, item)
  sync(next)
}
function onDragEnd() { dragIdx.value = -1; overIdx.value = -1 }

/* ---------- 300ms 防抖搜索 ---------- */
async function runSearch() {
  const query = q.value.trim()
  searching.value = true
  try {
    const data = await api(`/api/contract-approval/members?q=${encodeURIComponent(query)}`)
    results.value = Array.isArray(data?.members) ? data.members : []
    hint.value = data?.hint || (results.value.length === 0 ? '未找到匹配的队员' : '')
    showDropdown.value = true
  } catch (err: any) {
    results.value = []
    hint.value = err.message || '搜索失败'
    showDropdown.value = true
  } finally {
    searching.value = false
  }
}

watch(q, () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  const query = q.value.trim()
  if (!query) {
    results.value = []
    hint.value = ''
    showDropdown.value = false
    return
  }
  debounceTimer = setTimeout(runSearch, 300)
})

function onFocus() {
  if (blurTimer) clearTimeout(blurTimer)
  if (q.value.trim()) showDropdown.value = true
}
function onBlur() {
  blurTimer = setTimeout(() => { showDropdown.value = false }, 150)
}
function pick(m: MemberHit) {
  if (blurTimer) clearTimeout(blurTimer)
  addChip(m)
}

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (blurTimer) clearTimeout(blurTimer)
})
</script>

<template>
  <div id="cs-members" class="rounded-lg border border-nec-line p-3" :class="{ 'input-invalid': error }">
    <!-- 级别下拉 + 姓名/ou_ 搜索 -->
    <div class="cs-picker-bar">
      <select v-model="level" :disabled="disabled" class="cs-picker-level bg-white" title="审批级别">
        <option v-for="(label, value) in levelMap" :key="value" :value="value">{{ label }}</option>
      </select>
      <div class="cs-search-wrap">
        <input v-model="q" :disabled="disabled" class="cs-picker-q w-full" placeholder="搜索姓名或 ou_ 开头 id"
          @focus="onFocus" @blur="onBlur" />
        <span v-if="searching" class="mono text-xs text-nec-cyan absolute" style="right:10px;top:50%;transform:translateY(-50%)">…</span>
        <div v-if="showDropdown" class="cs-dd" role="listbox">
          <p v-if="hint" class="cs-hint">{{ hint }}</p>
          <p v-else-if="!results.length" class="cs-hint">未找到匹配的队员</p>
          <button v-for="m in results" :key="m.open_id" type="button" class="cs-dd-item" @mousedown.prevent @click="pick(m)">
            <span class="text-nec-ink">{{ m.name || '（未命名）' }}</span>
            <span class="mono text-xs text-nec-gray">{{ shortOpenId(m.open_id) }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- chips：顺序 = 会签顺序，拖拽排序 + ↑↓ 兜底 -->
    <div v-if="ul().length" class="cs-chips">
      <div v-for="(c, i) in ul()" :key="c.approverId + ':' + i" class="cs-chip"
        :class="{ dragging: i === dragIdx, 'drag-over': i === overIdx }"
        :draggable="!disabled" :title="c.approverId"
        @dragstart="onDragStart(i, $event)" @dragover="onDragOver(i, $event)" @dragleave="onDragLeave" @drop="onDrop(i, $event)" @dragend="onDragEnd">
        <span class="cs-chip-idx mono">{{ String(i + 1).padStart(2, '0') }}</span>
        <span class="level-badge">{{ renderLevel(c.level) }}</span>
        <span class="cs-chip-name">{{ c.name || shortOpenId(c.approverId) }}</span>
        <button type="button" class="cs-move-btn" :disabled="disabled || i === 0" title="上移" @click="moveChip(i, -1)">↑</button>
        <button type="button" class="cs-move-btn" :disabled="disabled || i === ul().length - 1" title="下移" @click="moveChip(i, 1)">↓</button>
        <button type="button" class="cs-chip-x cs-move-btn" :disabled="disabled" title="删除" @click="removeChip(i)">×</button>
      </div>
    </div>
    <p v-else class="text-xs text-nec-gray mt-2">尚未添加审批人，搜索并点击队员添加</p>

    <!-- 会签说明 + 或签（禁用占位） -->
    <div class="cs-sign-note">
      <span class="cs-sign-tag">会签</span>
      <span>顺序无优先级，全部通过才生效</span>
      <button type="button" class="cs-or-btn" disabled title="后续支持">或签</button>
    </div>

    <p class="field-error" :class="{ hidden: !error }" data-for="approvers">{{ error }}</p>
  </div>
</template>