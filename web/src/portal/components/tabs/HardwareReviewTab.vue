<script setup lang="ts">
// 硬件评审 Tab：薄壳嵌入 @apps/hardware-review（登录门控 Tab，登出时跳回首页）
import { computed, watch } from 'vue'
import { auth } from '@shared/auth'
import { tabs, switchTab } from '@portal/composables/useTabs'
import HardwareReviewApp from '@apps/hardware-review/HardwareReviewApp.vue'
import EmptyState from '@shared/ui/EmptyState.vue'

const authed = computed(() => !!(auth.me.authenticated && auth.me.user))
watch(authed, now => { if (!now && tabs.active === 'hardware-review') switchTab('home') })
</script>

<template>
  <section id="tab-hardware-review">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">硬件评审</h2>
      <a href="/apps/hardware-review/" target="_blank" class="text-xs hover:underline" style="color:var(--nec-cyan)">独立全屏版 /apps/hardware-review/ →</a>
    </div>
    <EmptyState v-if="!authed" text="登录后可使用硬件评审流程" />
    <div v-else class="rounded-xl border border-gray-200 overflow-hidden">
      <HardwareReviewApp embedded />
    </div>
  </section>
</template>
