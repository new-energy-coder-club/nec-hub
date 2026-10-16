<script setup lang="ts">
// 流程看板（阻塞预警 + 甘特图），自门户 components/dr/DrFlowBoard.vue 迁入；状态配色复用 types.ts 的 drStatus
import { ref, onMounted } from 'vue'
import { apiDr } from '@shared/api'
import { DR_STATUS, drStatus } from '../types'
import Gantt from './Gantt.vue'

const emit = defineEmits<{ (e: 'open', reviewId: string): void }>()

const data = ref<any>(null)
const error = ref('')

async function reload() {
  error.value = ''
  try {
    data.value = await apiDr('/board')
  } catch (err) {
    error.value = (err as Error).message
  }
}

const counts = () => {
  const sc: Record<string, number> = data.value?.statusCounts ?? {}
  return Object.keys(DR_STATUS).filter(k => sc[k]).map(k => ({ key: k, ...drStatus(k), count: sc[k] }))
}

onMounted(reload)
defineExpose({ reload })
</script>

<template>
  <div id="dr-flow-board" class="mb-4 space-y-3">
    <div v-if="error" class="nec-card p-4 text-xs text-nec-gray">流程看板加载失败：{{ error }}</div>
    <template v-else-if="data">
      <div class="nec-card p-4">
        <div class="flex items-center justify-between flex-wrap gap-2 mb-2">
          <p class="text-sm font-bold text-nec-ink">流程看板</p>
          <div class="flex flex-wrap gap-1.5">
            <span v-if="!counts().length" class="text-xs text-nec-gray">暂无数据</span>
            <span v-for="c in counts()" :key="c.key" class="text-[10px] px-2 py-0.5 rounded-full" :style="c.color">{{ c.label }} {{ c.count }}</span>
          </div>
        </div>
        <p v-for="(w, i) in (data.warnings || [])" :key="i" class="text-[10px]" style="color:#92610B">⚠ {{ w }}</p>
        <div v-if="(data.blockers || []).length" class="mt-2 space-y-1.5">
          <p class="text-xs font-bold" style="color:#C22E2E">阻塞预警（{{ data.blockers.length }}）</p>
          <div v-for="(b, i) in data.blockers" :key="i" class="flex items-center justify-between gap-2 rounded-lg px-3 py-2 cursor-pointer" style="background:#FDECEA;border:1px solid #F5C6C0" @click="emit('open', b.reviewId)">
            <p class="text-xs" style="color:#C22E2E"><span class="font-bold">{{ b.machineName || b.reviewId }}</span> · {{ b.message }}</p>
            <span v-if="b.hoursBlocked" class="text-[10px] whitespace-nowrap" style="color:#D9736A">{{ b.hoursBlocked }}h</span>
          </div>
        </div>
        <p v-else class="text-xs text-nec-gray mt-1">暂无阻塞预警</p>
      </div>
      <Gantt :rows="data.gantt || []" @open="emit('open', $event)" />
    </template>
  </div>
</template>
