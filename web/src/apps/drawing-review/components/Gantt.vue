<script setup lang="ts">
// 进度甘特图（节点：提交/会议/结论/BOM/归档），自门户 components/dr/DrGantt.vue 迁入
import { computed } from 'vue'
import { DR_GANTT_MS } from '../types'

const props = defineProps<{ rows: any[] }>()
const emit = defineEmits<{ (e: 'open', reviewId: string): void }>()

const entries = computed(() =>
  props.rows
    .map(r => {
      const pts = Object.entries(DR_GANTT_MS)
        .map(([k, label]) => ({ key: k, label, ts: Date.parse(r.milestones?.[k] || '') }))
        .filter(p => !Number.isNaN(p.ts))
      return { ...r, pts }
    })
    .filter(r => r.pts.length)
)

const range = computed(() => {
  if (!entries.value.length) return null
  const all = entries.value.flatMap((r: any) => r.pts.map((p: any) => p.ts))
  const minT = Math.min(...all)
  const maxT = Math.max(...all)
  return { minT, maxT, span: Math.max(maxT - minT, 86400000) }
})

const fmt = (ts: number) => new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })

const barRows = computed(() => {
  const rg = range.value
  if (!rg) return []
  return entries.value.map((r: any) => {
    const start = r.pts[0].ts, end = r.pts[r.pts.length - 1].ts
    return {
      reviewId: r.reviewId,
      name: r.machineName || r.reviewId,
      left: ((start - rg.minT) / rg.span * 100).toFixed(1),
      width: Math.max((end - start) / rg.span * 100, 1.5).toFixed(1),
      dots: r.pts.map((p: any) => ({
        x: ((p.ts - rg.minT) / rg.span * 100).toFixed(1),
        title: `${p.label} ${new Date(p.ts).toLocaleString('zh-CN')}`,
      })),
    }
  })
})

const ganttLabels = Object.values(DR_GANTT_MS).join(' / ')
</script>

<template>
  <div class="nec-card p-4">
    <template v-if="!barRows.length">
      <p class="text-sm font-bold text-nec-ink mb-2">进度甘特图</p>
      <p class="text-xs text-nec-gray">暂无进行中的评审单节点数据</p>
    </template>
    <template v-else>
      <div class="flex items-center justify-between mb-2">
        <p class="text-sm font-bold text-nec-ink">进度甘特图</p>
        <p class="mono text-[10px] text-nec-gray">{{ fmt(range!.minT) }} → {{ fmt(range!.maxT) }}</p>
      </div>
      <div class="space-y-1.5">
        <div v-for="r in barRows" :key="r.reviewId" class="flex items-center gap-2">
          <p class="text-xs text-nec-gray w-28 truncate shrink-0 cursor-pointer hover:underline" @click="emit('open', r.reviewId)">{{ r.name }}</p>
          <div style="position:relative;flex:1;height:18px;background:var(--nec-fog);border-radius:6px">
            <div :style="`position:absolute;left:${r.left}%;width:${r.width}%;top:5px;height:8px;border-radius:4px;background:var(--nec-cyan);opacity:.45`"></div>
            <span v-for="(p, i) in r.dots" :key="i" :title="p.title"
                  :style="`position:absolute;left:${p.x}%;top:50%;transform:translate(-50%,-50%);width:8px;height:8px;border-radius:50%;background:var(--nec-navy);border:1.5px solid #fff`"></span>
          </div>
        </div>
      </div>
      <p class="text-[10px] text-nec-gray mt-2">节点：{{ ganttLabels }}（悬停圆点查看时间，点击行名跳详情）</p>
    </template>
  </div>
</template>
