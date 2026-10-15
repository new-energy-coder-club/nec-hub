<script setup lang="ts">
// 未配置引导卡：后端 503（未绑定多维表格）时给出 config_* 配置 Prompt（提炼自硬件评审/合同审批的引导态同一模式）
import { copyText } from '@shared/api'

defineProps<{ icon: string; title: string; description: string; prompt: string; footnote: string }>()
</script>

<template>
  <div class="bg-white rounded-xl shadow p-6">
    <p class="font-bold text-slate-800 mb-2">{{ icon }} {{ title }}</p>
    <p class="text-sm text-gray-500 mb-3">{{ description }}</p>
    <pre class="prompt text-xs bg-gray-900 text-green-300 rounded-lg p-4">{{ prompt }}</pre>
    <button @click="copyText(prompt)" class="mt-3 text-xs text-white px-3 py-1.5 rounded" style="background:var(--nec-navy)">复制 Prompt</button>
    <p class="text-xs text-gray-400 mt-3">{{ footnote }}</p>
  </div>
</template>
