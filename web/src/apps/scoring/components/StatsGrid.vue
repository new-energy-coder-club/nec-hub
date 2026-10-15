<script setup lang="ts">
// 01 总览 stat 卡
import { STANDARD, REVIEWS, BEST } from '../data'

interface Stat {
  label: string
  value: string
  unit: string
  sub: string
  highlight?: boolean
  mono?: boolean
}

const stats: Stat[] = [
  { label: '当前最高分', value: `${BEST.score}`, unit: '/10', sub: '博物馆级', highlight: true },
  { label: '已留存评审轮次', value: `${REVIEWS.length}`, unit: '轮', sub: '7.x / 8.x 未留存' },
  { label: '终局目标', value: `${STANDARD.targetScore}`, unit: '/10', sub: STANDARD.targetNote },
  { label: '标准版本', value: STANDARD.version, unit: '', sub: STANDARD.name },
  { label: '审核模式', value: STANDARD.reviewMode, unit: '', sub: '三段式循环', mono: true },
]
</script>

<template>
  <section class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
    <div v-for="s in stats" :key="s.label" class="nec-card p-4" :style="s.highlight ? 'border-top:3px solid var(--nec-cyan)' : ''">
      <p class="mono text-[11px] text-nec-gray tracking-wider">{{ s.label }}</p>
      <p
        class="mt-1 font-black text-2xl"
        :class="[s.highlight ? 'text-nec-cyan' : 'text-nec-navy', s.mono ? 'mono text-base leading-8' : '']"
      >
        {{ s.value }}<span class="text-sm font-bold text-nec-gray">{{ s.unit }}</span>
      </p>
      <p class="text-xs text-nec-gray mt-1">{{ s.sub }}</p>
    </div>
  </section>
</template>
