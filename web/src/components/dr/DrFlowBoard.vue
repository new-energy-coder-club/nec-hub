<script setup lang="ts">
// 图纸评审 · 流程看板（阻塞预警 + 甘特图）
import { ref } from 'vue'
import { apiDr } from '../../api'
import { DR_STATUS } from './dr-status'
import DrGantt from './DrGantt.vue'

const emit = defineEmits<{ (e: 'open', reviewId: string): void }>()

const data = ref<any>(null)
const error = ref('')

async function reload() {
  error.value = ''
  try {
    data.value = await apiDr('/board')
  } catch (err: any) {
    error.value = err.message
  }
}

const counts = () => {
  const sc = data.value?.statusCounts ?? {}
  return Object.entries(DR_STATUS).filter(([k]) => sc[k]).map(([k, v]) => ({ key: k, ...v, count: sc[k] }))
}

defineExpose({ reload })
</script>

<template>
  <div id="dr-flow-board" class="mb-4 space-y-3">
    <div v-if="error" class="bg-white rounded-xl shadow p-4 text-xs text-gray-400">流程看板加载失败：{{ error }}</div>
    <template v-else-if="data">
      <div class="bg-white rounded-xl shadow p-4">
        <div class="flex items-center justify-between flex-wrap gap-2 mb-2">
          <p class="text-sm font-bold text-slate-800">流程看板</p>
          <div class="flex flex-wrap gap-1.5">
            <span v-if="!counts().length" class="text-xs text-gray-400">暂无数据</span>
            <span v-for="c in counts()" :key="c.key" class="text-[10px] px-2 py-0.5 rounded-full" :class="c.cls">{{ c.label }} {{ c.count }}</span>
          </div>
        </div>
        <p v-for="(w, i) in (data.warnings || [])" :key="i" class="text-[10px] text-amber-600">⚠ {{ w }}</p>
        <div v-if="(data.blockers || []).length" class="mt-2 space-y-1.5">
          <p class="text-xs font-bold text-red-600">阻塞预警（{{ data.blockers.length }}）</p>
          <div v-for="(b, i) in data.blockers" :key="i" class="flex items-center justify-between gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2 cursor-pointer hover:bg-red-100/60" @click="emit('open', b.reviewId)">
            <p class="text-xs text-red-700"><span class="font-bold">{{ b.machineName || b.reviewId }}</span> · {{ b.message }}</p>
            <span v-if="b.hoursBlocked" class="text-[10px] text-red-400 whitespace-nowrap">{{ b.hoursBlocked }}h</span>
          </div>
        </div>
        <p v-else class="text-xs text-gray-400 mt-1">暂无阻塞预警</p>
      </div>
      <DrGantt :rows="data.gantt || []" @open="emit('open', $event)" />
    </template>
  </div>
</template>
