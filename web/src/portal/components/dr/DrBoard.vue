<script setup lang="ts">
// 图纸评审 · 看板视图：按状态分列，列内为评审单卡片（点击切列表展开详情）
import { computed } from 'vue'
import { DR_STATUS } from './dr-status'

const props = defineProps<{ data: any[]; counts: Record<string, number>; filter: string }>()
const emit = defineEmits<{ (e: 'open', reviewId: string): void }>()

const cols = computed(() =>
  Object.entries(DR_STATUS)
    .filter(([k]) => props.counts[k] && (!props.filter || props.filter === k))
    .map(([k, v]) => {
      // 单次遍历分组，替代每列一次 data.filter 的 O(列数×行数) 重复扫描
      const groups: Record<string, any[]> = {}
      for (const r of props.data) (groups[r.status] ||= []).push(r)
      return { key: k, label: v.label, items: groups[k] ?? [] }
    })
)
</script>

<template>
  <div id="dr-board" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    <p v-if="!cols.length" class="text-sm text-gray-400 bg-white rounded-xl shadow p-8 text-center sm:col-span-2 lg:col-span-3">暂无评审单，点击右上角「＋ 提交评审单」开始</p>
    <div v-for="c in cols" :key="c.key" class="bg-gray-100/70 rounded-xl p-3">
      <div class="flex items-center justify-between mb-2 px-1">
        <span class="text-xs font-bold text-slate-700">{{ c.label }}</span>
        <span class="text-xs text-gray-400">{{ c.items.length }}</span>
      </div>
      <div class="space-y-2">
        <div v-for="r in c.items" :key="r.reviewId" class="bg-white rounded-lg shadow-sm p-3 cursor-pointer hover:shadow-md transition" @click="emit('open', r.reviewId)">
          <p class="text-sm font-bold text-slate-800 truncate">{{ r.machineName }}</p>
          <p class="text-xs text-gray-400 mt-0.5">{{ r.reviewId }} · {{ r.drawingVersion }}</p>
          <p class="text-xs text-gray-500 mt-1 line-clamp-2">{{ r.designNotes }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
