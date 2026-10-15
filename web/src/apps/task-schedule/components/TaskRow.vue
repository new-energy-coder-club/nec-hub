<script setup lang="ts">
// 单条任务行：完成勾选 / 点击展开详情（备注 + 标记完成 / 删除）
import type { TaskItem } from '../store'

defineProps<{ task: TaskItem; expanded: boolean; lineName: string; lineColor: string; fmt: string }>()
const emit = defineEmits<{ (e: 'toggle'): void; (e: 'toggle-expand'): void; (e: 'delete'): void }>()
</script>

<template>
  <div class="task-row fade-in border border-neutral-800 rounded-xl px-5 py-4" :data-id="task.id">
    <div class="flex items-center gap-4">
      <button
        class="row-check" :class="{ done: task.done }"
        :aria-label="task.done ? '标记为未完成' : '标记为完成'"
        @click.stop="emit('toggle')">
        <svg v-if="task.done" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      </button>

      <div class="flex-1 min-w-0 cursor-pointer" @click="emit('toggle-expand')">
        <div class="font-bold text-[15px] truncate" :class="{ 'done-text': task.done }">{{ task.title }}</div>
        <div class="flex items-center gap-1.5 text-xs text-neutral-500 mt-1">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><circle cx="9" cy="15" r="1.6" fill="currentColor" stroke="none"/></svg>
          <span>{{ fmt }}</span>
          <span class="inline-block w-2 h-2 rounded-full ml-1" :style="{ background: lineColor }"></span>
          <span>{{ lineName }}</span>
        </div>
      </div>

      <button
        class="text-neutral-500 hover:text-white transition p-1" :class="{ 'rotate-180': expanded }"
        @click="emit('toggle-expand')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="transition-transform" :class="{ 'rotate-180': expanded }"><path d="m6 9 6 6 6-6"/></svg>
      </button>
    </div>

    <div v-if="expanded" class="mt-3 pt-3 border-t border-neutral-800 fade-in">
      <p class="text-sm text-neutral-400 whitespace-pre-wrap mb-3">{{ task.note || '（无备注）' }}</p>
      <div class="flex gap-2 justify-end">
        <button class="px-4 py-1.5 rounded-full text-xs border border-neutral-700 hover:border-neutral-400 transition" @click="emit('toggle')">{{ task.done ? '重新打开' : '标记完成' }}</button>
        <button class="px-4 py-1.5 rounded-full text-xs border border-red-900 text-red-400 hover:border-red-500 transition" @click="emit('delete')">删除</button>
      </div>
    </div>
  </div>
</template>
