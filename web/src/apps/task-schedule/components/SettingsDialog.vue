<script setup lang="ts">
// Settings 弹窗：线路管理（增删）+ 数据操作（清除已完成 / 导出 JSON / 恢复示例数据）
import { ref } from 'vue'
import type { TaskItem, TaskLine } from '../store'

const props = defineProps<{ lines: TaskLine[]; tasks: TaskItem[] }>()
const emit = defineEmits<{
  (e: 'delete-line', id: string): void
  (e: 'add-line', line: { name: string; color: string }): void
  (e: 'clear-done'): void
  (e: 'export-data'): void
  (e: 'reset-data'): void
}>()

const dlg = ref<HTMLDialogElement | null>(null)
const newName = ref('')
const newColor = ref('#3b82f6')

const countOf = (lineId: string) => props.tasks.filter(t => t.line === lineId).length

function open() { dlg.value?.showModal() }
function close() { dlg.value?.close() }
function onBackdropClick(e: MouseEvent) { if (e.target === dlg.value) close() }

function addLine() {
  const name = newName.value.trim()
  if (!name) return
  emit('add-line', { name, color: newColor.value })
  newName.value = ''
}

defineExpose({ open })
</script>

<template>
  <dialog ref="dlg" class="bg-neutral-950 text-white border border-neutral-800 rounded-2xl p-6 w-[92vw] max-w-md" @click="onBackdropClick">
    <h2 class="text-lg font-bold mb-1">Settings</h2>
    <p class="text-xs text-neutral-500 mb-5">数据保存在浏览器 localStorage</p>

    <h3 class="text-sm font-semibold mb-2 text-neutral-300">线路管理</h3>
    <div class="flex flex-col gap-2 mb-3">
      <div v-for="l in lines" :key="l.id" class="flex items-center gap-3 border border-neutral-800 rounded-lg px-3 py-2">
        <span class="w-3 h-3 rounded-full flex-none" :style="{ background: l.color }"></span>
        <span class="flex-1 text-sm truncate">{{ l.name }}</span>
        <span class="text-xs text-neutral-500">{{ countOf(l.id) }} 项</span>
        <button
          class="text-xs text-red-400 hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed"
          :disabled="lines.length <= 1 || countOf(l.id) > 0"
          :title="countOf(l.id) > 0 ? '该线路下还有任务' : ''"
          @click="emit('delete-line', l.id)">删除</button>
      </div>
    </div>
    <form class="flex gap-2 mb-6" @submit.prevent="addLine">
      <input v-model="newName" required maxlength="12" placeholder="新线路名称"
        class="flex-1 min-w-0 bg-black border border-neutral-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white" />
      <input v-model="newColor" type="color"
        class="w-10 h-9 bg-black border border-neutral-700 rounded-lg cursor-pointer p-1" />
      <button class="px-4 py-2 rounded-lg text-sm bg-white text-black font-semibold hover:bg-neutral-200 transition">加</button>
    </form>

    <h3 class="text-sm font-semibold mb-2 text-neutral-300">数据</h3>
    <div class="flex flex-wrap gap-2">
      <button class="px-4 py-2 rounded-lg text-sm border border-neutral-700 hover:border-neutral-400 transition" @click="emit('clear-done')">清除已完成</button>
      <button class="px-4 py-2 rounded-lg text-sm border border-neutral-700 hover:border-neutral-400 transition" @click="emit('export-data')">导出 JSON</button>
      <button class="px-4 py-2 rounded-lg text-sm border border-red-900 text-red-400 hover:border-red-500 transition" @click="emit('reset-data')">恢复示例数据</button>
    </div>

    <div class="flex justify-end mt-6">
      <button class="px-5 py-2 rounded-full text-sm bg-white text-black font-semibold hover:bg-neutral-200 transition" @click="close">完成</button>
    </div>
  </dialog>
</template>
