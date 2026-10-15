<script setup lang="ts">
// 04 六大评分维度
import { DIMENSIONS } from '../data'
</script>

<template>
  <section class="nec-card p-5">
    <div class="mb-4 flex items-baseline justify-between">
      <div>
        <h2 class="text-lg font-bold text-nec-ink">六大评分维度</h2>
        <p class="mono text-xs text-nec-gray tracking-wider">SIX SCORING DIMENSIONS</p>
      </div>
      <span class="text-xs text-nec-gray">文档未留存分项得分，仅列规则</span>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      <div v-for="(d, i) in DIMENSIONS" :key="d.name" class="rounded-lg p-4" style="border:1px solid var(--nec-line);background:var(--nec-paper)">
        <div class="flex items-center gap-2 mb-2">
          <span class="mono text-xs font-black text-nec-cyan">{{ String(i + 1).padStart(2, '0') }}</span>
          <h3 class="text-sm font-bold text-nec-navy">{{ d.name }}</h3>
        </div>
        <p class="text-xs text-nec-gray leading-relaxed">{{ d.rule }}</p>
      </div>
    </div>
  </section>
</template>
