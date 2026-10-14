<script setup lang="ts">
// FE-09：待办条（登录后有待办时显示；逾期任务/待确认报销/飞书审批/本地审批单聚合，可展开清单；合规 T-1 单标红置顶）
import { todoBar, todoSummary, toggleTodoList, hideTodoBar, TODO_TYPE_LABELS } from '../composables/useBanners'

function localMeta(x: any): string {
  if (x.urgent && x.deadline) return '距计划发布不足 24h'
  if (x.deadline) {
    const days = Math.ceil((x.deadline - Date.now()) / 86400000)
    return days > 0 ? `距计划发布还有 ${days} 天` : '已过计划发布时间'
  }
  return ''
}
</script>

<template>
  <div id="todo-bar" v-show="todoBar.data">
    <div class="max-w-5xl mx-auto px-4 sm:px-6 py-2.5 text-sm text-white" style="background:#B45309">
      <div class="flex items-center gap-3">
        <span class="shrink-0">✅</span>
        <button @click="toggleTodoList" class="flex-1 text-left leading-snug hover:underline" id="todo-bar-text">{{ todoSummary() }}</button>
        <button @click="hideTodoBar" class="text-white/60 hover:text-white shrink-0">✕</button>
      </div>
      <div id="todo-list" v-show="todoBar.expanded" class="mt-2 pt-2 border-t border-white/20">
        <ul v-if="todoBar.data" class="divide-y divide-white/10">
          <li v-for="(x, i) in (todoBar.data.approvals_local?.items ?? [])" :key="'al' + i"
              class="py-1.5 flex items-baseline gap-2 flex-wrap" :class="{ '-mx-2 px-2 rounded bg-red-500/25': x.urgent }">
            <span class="text-xs px-1.5 py-0.5 rounded shrink-0" :class="x.urgent ? 'bg-red-500/60' : 'bg-white/15'">{{ TODO_TYPE_LABELS[x.type] ?? '审批' }}</span>
            <span v-if="x.urgent" class="text-xs px-1.5 py-0.5 rounded bg-red-500 text-white font-bold shrink-0">T-1</span>
            <a :href="x.url" target="_blank" class="hover:underline font-medium">{{ x.title }}</a>
            <span v-if="localMeta(x)" class="text-xs" :class="x.urgent ? 'text-red-200 font-medium' : 'text-white/70'">{{ localMeta(x) }}</span>
          </li>
          <li v-for="(x, i) in (todoBar.data.tasks ?? [])" :key="'t' + i" class="py-1.5 flex items-baseline gap-2 flex-wrap">
            <span class="text-xs px-1.5 py-0.5 rounded bg-white/15 shrink-0">任务</span>
            <a :href="x.link" target="_blank" class="hover:underline font-medium">{{ x.title }}</a>
            <span class="text-xs text-white/70">逾期 {{ x.daysOverdue ?? '?' }} 天 · {{ x.status }}</span>
          </li>
          <li v-for="(x, i) in (todoBar.data.finance?.items ?? [])" :key="'f' + i" class="py-1.5 flex items-baseline gap-2 flex-wrap">
            <span class="text-xs px-1.5 py-0.5 rounded bg-white/15 shrink-0">报销</span>
            <a :href="x.link" target="_blank" class="hover:underline font-medium">{{ x.name }}</a>
            <span class="text-xs text-white/70">{{ x.amount ?? '—' }} 元 · {{ x.applicant || '—' }} · {{ x.status }}</span>
          </li>
          <li v-for="(x, i) in (todoBar.data.approvals?.items ?? [])" :key="'a' + i" class="py-1.5 flex items-baseline gap-2 flex-wrap">
            <span class="text-xs px-1.5 py-0.5 rounded bg-white/15 shrink-0">审批</span>
            <a :href="x.link" target="_blank" class="hover:underline font-medium">{{ x.title }}</a>
          </li>
        </ul>
        <p v-for="(w, i) in (todoBar.data?.warnings ?? [])" :key="'w' + i" class="text-xs text-white/60 mt-1">⚠ {{ w }}</p>
      </div>
    </div>
  </div>
</template>
