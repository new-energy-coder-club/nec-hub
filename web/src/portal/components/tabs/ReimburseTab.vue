<script setup lang="ts">
// 报销 Tab：原生复用报销助手视图（替代原 iframe 嵌入），登录态由门户统一引导
import ReimburseApp from '@apps/reimburse/ReimburseApp.vue'
import { switchTab } from '@portal/composables/useTabs'
</script>

<template>
  <section id="tab-reimburse">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">报销</h2>
      <a href="/apps/reimburse/" target="_blank" class="text-xs hover:underline" style="color:var(--nec-cyan)">独立全屏版 /apps/reimburse/ →</a>
    </div>
    <div class="rounded-xl border border-gray-200 overflow-hidden">
      <ReimburseApp embedded skip-auth-boot @exit="switchTab('home')" />
    </div>
  </section>
</template>
