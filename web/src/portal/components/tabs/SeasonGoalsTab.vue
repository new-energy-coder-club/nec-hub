<script setup lang="ts">
// 赛季目标 Tab：原生复用赛季目标管理视图（替代原 iframe 嵌入；无登录态依赖）
import SeasonGoalsApp from '@apps/season-goals/SeasonGoalsApp.vue'
</script>

<template>
  <section id="tab-season-goals">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">赛季目标</h2>
 <a href="/apps/season-goals/" target="_blank" class="text-xs hover:underline text-nec-cyan">独立全屏版 /apps/season-goals/ →</a>
    </div>
    <div class="rounded-xl border border-gray-200 overflow-hidden bg-white">
      <SeasonGoalsApp embedded />
    </div>
  </section>
</template>
