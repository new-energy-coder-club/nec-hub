<script setup lang="ts">
// 赛季目标（前 5 条 + 未配置时的接入 Prompt 引导）
import { ref, onMounted, inject } from 'vue'
import { GOALS_CONFIG_PROMPT } from '../../../prompts'
import { copyText, fmtDashDate, goalBarColor } from '../../../api'

const props = defineProps<{ shared: { load(name: string): Promise<any> } }>()
const noteHomeFreshness = inject<(d: any) => void>('noteHomeFreshness', () => {})

const g = ref<any>(undefined)
const items = ref<any[]>([])
const failed = ref(false)

onMounted(async () => {
  try {
    const d = await props.shared.load('dashboard')
    noteHomeFreshness(d)
    g.value = d?.goals ?? null
    items.value = (g.value?.items ?? []).slice(0, 5)
  } catch { failed.value = true }
})
</script>

<template>
  <p v-if="failed" class="text-sm text-gray-400">加载失败，请刷新重试。</p>
  <p v-else-if="g === undefined" class="text-sm text-gray-400">加载中…</p>
  <!-- 配置缺口不是用户的问题：给出可复制的接入 Prompt（与数据看板未配置引导同一模式） -->
  <template v-else-if="!g || !g.configured">
    <p class="text-sm text-gray-500 mb-2">赛季目标未配置：把下面的 Prompt 发给已接入 NEC-MCP 的 Agent 完成接入。</p>
    <pre class="prompt text-xs bg-gray-900 text-green-300 rounded-lg p-3" id="home-goals-prompt">{{ GOALS_CONFIG_PROMPT }}</pre>
    <button @click="copyText(GOALS_CONFIG_PROMPT)" class="mt-2 text-xs text-white px-3 py-1.5 rounded" style="background:var(--nec-navy)">复制 Prompt</button>
  </template>
  <p v-else-if="!items.length" class="text-sm text-gray-400">赛季目标表已配置但暂无数据：在飞书赛季目标表中添加第一条目标（含截止日期）后即可显示在这里。</p>
  <template v-else>
    <a v-for="(it, i) in items" :key="i" :href="it.link" target="_blank" class="block py-1.5 border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-400 mono shrink-0">{{ fmtDashDate(it.deadline) }}</span>
        <span class="flex-1 min-w-0 truncate">{{ it.title }}</span>
        <span v-if="it.overdue" class="text-xs text-red-600 font-bold shrink-0">已逾期</span>
        <span class="text-xs text-gray-500 mono shrink-0">{{ it.progress === null ? '—' : Math.round(it.progress) + '%' }}</span>
      </div>
      <div class="h-1.5 rounded bg-gray-100 overflow-hidden mt-1">
        <div :style="`width:${(it.progress ?? 0).toFixed(0)}%;height:100%;background:${goalBarColor(it)}`"></div>
      </div>
    </a>
  </template>
</template>
