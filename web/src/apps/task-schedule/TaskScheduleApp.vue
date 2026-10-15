<script setup lang="ts">
// 任务排期（Taskto 地铁线路图 Todo）：独立页（/apps/task-schedule/）与门户 Tab 共用本视图
// embedded：隐藏顶栏、收窄边距（原 ?embedded=1 / iframe 嵌入语义）
// 纯本地应用：数据存 localStorage「nec-taskto-v1」，无后端端点
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { store, save, uid, lineOf, fmtDate, visibleTasks, resetToDefault } from './store'
import TaskRow from './components/TaskRow.vue'
import MetroMap from './components/MetroMap.vue'
import AddTodoDialog from './components/AddTodoDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import './taskto.css'

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const listEl = ref<HTMLElement | null>(null)
const mapRef = ref<InstanceType<typeof MetroMap> | null>(null)
const addDlg = ref<InstanceType<typeof AddTodoDialog> | null>(null)
const settingsDlg = ref<InstanceType<typeof SettingsDialog> | null>(null)

const statText = computed(() => {
  const total = store.tasks.length
  const done = store.tasks.filter(t => t.done).length
  return `共 ${total} 项 · 已完成 ${done} · 待办 ${total - done}`
})

// 线路图依赖任务行实际布局，任何影响列表/线路/展开态的变化后等 DOM 绘制再量坐标（原 render() 末尾 rAF(renderMap)）
function scheduleRedraw() {
  nextTick(() => requestAnimationFrame(() => mapRef.value?.redraw(listEl.value)))
}
watch([visibleTasks, () => store.lines, () => store.expandedId], scheduleRedraw, { deep: true })

function onResize() { if (store.mapVisible) mapRef.value?.redraw(listEl.value) }
onMounted(() => {
  window.addEventListener('resize', onResize)
  scheduleRedraw()
})
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

/* ---------------- 任务行为 ---------------- */
function toggleDone(id: string) {
  const t = store.tasks.find(x => x.id === id)
  if (!t) return
  t.done = !t.done
  save()
}
function toggleExpand(id: string) {
  store.expandedId = store.expandedId === id ? null : id
}
function deleteTask(id: string) {
  const t = store.tasks.find(x => x.id === id)
  if (!t) return
  if (!confirm(`删除任务「${t.title}」？`)) return
  store.tasks = store.tasks.filter(x => x.id !== id)
  if (store.expandedId === id) store.expandedId = null
  save()
}
function addTask(p: { title: string; date: string; line: string; note: string }) {
  store.tasks.unshift({ id: uid(), title: p.title, date: p.date, line: p.line, note: p.note, done: false })
  save()
}
function onFilterChange() { store.expandedId = null }

// 点击站点圆点：展开对应任务并平滑滚动到该行
function selectStop(id: string) {
  store.expandedId = id
  nextTick(() => {
    const el = listEl.value?.querySelector(`.task-row[data-id="${id}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

function expandMap() {
  store.mapVisible = true
  scheduleRedraw()
}

/* ---------------- 设置行为 ---------------- */
function deleteLine(id: string) {
  store.lines = store.lines.filter(x => x.id !== id)
  save()
}
function addLine(p: { name: string; color: string }) {
  store.lines.push({ id: 'line-' + uid(), name: p.name, color: p.color })
  save()
}
function clearDone() {
  if (!confirm('清除所有已完成任务？')) return
  store.tasks = store.tasks.filter(t => !t.done)
  save()
}
function exportData() {
  const blob = new Blob([JSON.stringify({ lines: store.lines, tasks: store.tasks }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'taskto-export.json'
  a.click()
  URL.revokeObjectURL(a.href)
}
function resetData() {
  if (!confirm('恢复示例数据？当前数据将被覆盖。')) return
  resetToDefault()
  save()
}
</script>

<template>
  <div class="taskto-root max-w-4xl mx-auto" :class="embedded ? '' : 'px-5 py-6'">

    <!-- 顶栏（embedded 隐藏） -->
    <header v-if="!embedded" class="flex items-center justify-between mb-6">
      <h1 class="logo text-3xl">Taskto</h1>
      <div class="flex items-center gap-3">
        <a href="./animated.html" class="text-xs text-neutral-500 hover:text-white transition underline underline-offset-4 decoration-neutral-700">动态版</a>
        <button
          class="flex items-center gap-2 bg-white text-black font-semibold text-sm px-5 py-2.5 rounded-full hover:bg-neutral-200 transition"
          @click="settingsDlg?.open()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          Settings
        </button>
      </div>
    </header>

    <!-- 工具栏 -->
    <div class="flex items-center justify-between gap-3 mb-4">
      <div class="relative">
        <select v-model="store.filter"
          class="bg-transparent border border-neutral-700 rounded-lg pl-4 pr-10 py-2 text-sm text-white focus:outline-none focus:border-neutral-400 cursor-pointer"
          @change="onFilterChange">
          <option value="all" class="bg-black">All</option>
          <option value="todo" class="bg-black">待办</option>
          <option value="done" class="bg-black">已完成</option>
          <optgroup label="线路" class="bg-black">
            <option v-for="l in store.lines" :key="l.id" :value="'line:' + l.id" class="bg-black">{{ l.name }}</option>
          </optgroup>
        </select>
      </div>
      <button
        class="flex items-center gap-1.5 bg-white text-black font-semibold text-sm px-5 py-2 rounded-full hover:bg-neutral-200 transition"
        @click="addDlg?.open()">
        <span class="text-lg leading-none">+</span> Add Todo
      </button>
    </div>

    <!-- 统计折叠条 -->
    <button
      class="w-full border border-neutral-800 rounded-lg py-1.5 flex flex-col items-center justify-center text-neutral-500 hover:text-neutral-300 transition mb-4"
      @click="store.statOpen = !store.statOpen">
      <span class="text-xs mb-0.5" :class="{ hidden: !store.statOpen }">{{ statText }}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="transition-transform" :style="{ transform: store.statOpen ? 'rotate(180deg)' : '' }"><path d="m6 9 6 6 6-6"/></svg>
    </button>

    <!-- 主体：线路图 + 任务列表 -->
    <div class="flex gap-3 items-stretch">
      <MetroMap v-show="store.mapVisible" ref="mapRef"
        :lines="store.lines" :tasks="visibleTasks"
        @collapse="store.mapVisible = false" @select="selectStop" />
      <button v-if="!store.mapVisible" title="展开线路图"
        class="flex-none self-center border border-neutral-800 rounded-full w-8 h-8 flex items-center justify-center text-neutral-500 hover:text-white transition"
        @click="expandMap">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
      </button>

      <div ref="listEl" class="flex-1 min-w-0 flex flex-col gap-2.5">
        <div v-if="!visibleTasks.length" class="border border-dashed border-neutral-800 rounded-xl py-14 text-center text-neutral-600 text-sm">没有匹配的任务</div>
        <TaskRow v-for="t in visibleTasks" :key="t.id"
          :task="t" :expanded="store.expandedId === t.id"
          :line-name="lineOf(t.line).name" :line-color="lineOf(t.line).color" :fmt="fmtDate(t.date)"
          @toggle="toggleDone(t.id)" @toggle-expand="toggleExpand(t.id)" @delete="deleteTask(t.id)" />
      </div>
    </div>

    <AddTodoDialog ref="addDlg" :lines="store.lines" @add="addTask" />
    <SettingsDialog ref="settingsDlg" :lines="store.lines" :tasks="store.tasks"
      @delete-line="deleteLine" @add-line="addLine"
      @clear-done="clearDone" @export-data="exportData" @reset-data="resetData" />
  </div>
</template>
