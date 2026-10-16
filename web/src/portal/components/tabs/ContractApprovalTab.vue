<script setup lang="ts">
// 合同审批 Tab：薄壳嵌入 @apps/contract-signing（登录门控 Tab，登出时跳回首页）
import { computed, watch } from 'vue'
import { auth } from '@shared/auth'
import { tabs, switchTab } from '@portal/composables/useTabs'
import ContractSigningApp from '@apps/contract-signing/ContractSigningApp.vue'
import EmptyState from '@shared/ui/EmptyState.vue'

const authed = computed(() => !!(auth.me.authenticated && auth.me.user))
watch(authed, now => { if (!now && tabs.active === 'contract-approval') switchTab('home') })
</script>

<template>
  <section id="tab-contract-approval">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">合同审批</h2>
      <a href="/apps/contract-signing/" target="_blank" class="text-xs hover:underline" style="color:var(--nec-cyan)">独立全屏版 /apps/contract-signing/ →</a>
    </div>
    <EmptyState v-if="!authed" text="登录后可使用合同审批流程" />
    <div v-else class="rounded-xl border border-gray-200 overflow-hidden">
      <ContractSigningApp embedded />
    </div>
  </section>
</template>
