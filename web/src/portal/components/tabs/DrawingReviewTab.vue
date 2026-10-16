<script setup lang="ts">
// 图纸评审 Tab：薄壳嵌入 @apps/drawing-review（登录门控 Tab，登出时跳回应用广场）
import { computed, watch } from 'vue'
import { auth } from '@shared/auth'
import { tabs, switchTab } from '@portal/composables/useTabs'
import DrawingReviewApp from '@apps/drawing-review/DrawingReviewApp.vue'
import EmptyState from '@shared/ui/EmptyState.vue'

const authed = computed(() => !!(auth.me.authenticated && auth.me.user))
watch(authed, now => { if (!now && tabs.active === 'drawing-review') switchTab('apps') })
</script>

<template>
  <section id="tab-drawing-review">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">图纸评审</h2>
      <a href="/apps/drawing-review/" target="_blank" class="text-xs hover:underline" style="color:var(--nec-cyan)">独立全屏版 /apps/drawing-review/ →</a>
    </div>
    <EmptyState v-if="!authed" text="登录后可使用图纸评审流程" />
    <div v-else class="rounded-xl border border-gray-200 overflow-hidden">
      <DrawingReviewApp embedded />
    </div>
  </section>
</template>
