<script setup lang="ts">
// FE-04：赛季目标关键节点 T-7 提醒条（无临近节点时隐藏）
// 风险联动（#2）：条目 risk=late 时文字与 T-x 标签变红；存在 late 项则整条背景切警示色
import { goalBanner, dismissGoalBanner, goalRisk } from '@portal/composables/useBanners'

function labelOf(it: any): { cls: string; text: string } {
  if (it.overdue) return { cls: '#FCA5A5', text: `已逾期 ${Math.abs(it.daysLeft ?? 0)} 天` }
  if (goalRisk(it.deadline, it.progress) === 'late') return { cls: '#FCA5A5', text: `⚠ T-${it.daysLeft} 天` }
  return { cls: '', text: `T-${it.daysLeft} 天` }
}
</script>

<template>
  <div id="goal-banner" v-show="goalBanner.items.length">
    <div class="max-w-5xl mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-3 text-sm text-white" :style="{ background: goalBanner.danger ? 'var(--nec-danger)' : 'var(--nec-navy)' }">
      <span class="shrink-0">📌</span>
      <div id="goal-banner-text" class="flex-1 leading-snug">
        <template v-for="(it, i) in goalBanner.items" :key="i">
          <span v-if="i" class="mx-2 text-white/30">｜</span>
          <a :href="it.link" target="_blank" class="hover:underline">
            <b :style="labelOf(it).cls ? { color: labelOf(it).cls } : {}">{{ labelOf(it).text }}</b>
            <template v-if="goalRisk(it.deadline, it.progress) === 'late'">
              <span style="color:#FCA5A5">· {{ it.title }}（{{ it.group }} {{ it.progress === null ? '' : Math.round(it.progress) + '%' }}）</span>
            </template>
            <template v-else>
              · {{ it.title }}（{{ it.group }} {{ it.progress === null ? '' : Math.round(it.progress) + '%' }}）
            </template>
          </a>
        </template>
      </div>
      <button @click="dismissGoalBanner" class="text-white/60 hover:text-white shrink-0">✕</button>
    </div>
  </div>
</template>
