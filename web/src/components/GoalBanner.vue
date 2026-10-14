<script setup lang="ts">
// FE-04：赛季目标关键节点 T-7 提醒条（无临近节点时隐藏）
import { goalBanner, dismissGoalBanner } from '../composables/useBanners'
</script>

<template>
  <div id="goal-banner" v-show="goalBanner.items.length">
    <div class="max-w-5xl mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-3 text-sm text-white" style="background:var(--nec-navy)">
      <span class="shrink-0">📌</span>
      <div id="goal-banner-text" class="flex-1 leading-snug">
        <template v-for="(it, i) in goalBanner.items" :key="i">
          <span v-if="i" class="mx-2 text-white/30">｜</span>
          <a :href="it.link" target="_blank" class="hover:underline">
            <b v-if="it.overdue" style="color:#FCA5A5">已逾期 {{ Math.abs(it.daysLeft ?? 0) }} 天</b>
            <b v-else>T-{{ it.daysLeft }} 天</b>
            · {{ it.title }}（{{ it.group }} {{ it.progress === null ? '' : Math.round(it.progress) + '%' }}）
          </a>
        </template>
      </div>
      <button @click="dismissGoalBanner" class="text-white/60 hover:text-white shrink-0">✕</button>
    </div>
  </div>
</template>
