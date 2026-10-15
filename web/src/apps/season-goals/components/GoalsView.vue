<script setup lang="ts">
// 目标看板视图：进度条 + 逾期高亮
import { store, loadGoals, statusColor } from '../store'
</script>

<template>
  <section id="view-goals" class="view" :class="{ active: store.view === 'goals' }">
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold text-slate-800">目标看板</h2>
        <button class="text-sm text-blue-600 hover:text-blue-700 font-medium px-2" @click="loadGoals()">刷新</button>
      </div>
      <div id="goal-list" class="space-y-3">
        <p v-if="store.goals.error" class="text-sm text-red-500">加载失败：{{ store.goals.error }}</p>
        <p v-else-if="store.goals.items === null" class="text-sm text-gray-400">加载中…</p>
        <p v-else-if="!store.goals.items.length" class="text-sm text-gray-400">暂无目标</p>
        <div
          v-for="(g, i) in store.goals.items"
          :key="i"
          class="border rounded-lg p-4"
          :class="g.overdue ? 'border-red-200 bg-red-50' : 'border-gray-100'"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="font-bold text-slate-800">{{ g.title }}</p>
              <p class="text-xs text-gray-500">
                {{ g.group }} · 截止 {{ g.deadline || '—' }}
                <template v-if="g.overdue"> · <span class="text-red-600 font-medium">已逾期</span></template>
              </p>
            </div>
            <span class="status-badge" :class="statusColor(g.status)">{{ g.status || '—' }}</span>
          </div>
          <div class="mt-3 flex items-center gap-3">
            <div class="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div class="h-full rounded-full" :class="g.overdue ? 'bg-red-400' : 'bg-[#1FA9E8]'" :style="{ width: g.pct + '%' }"></div>
            </div>
            <span class="text-xs text-gray-500 w-10 text-right">{{ g.progress }}%</span>
          </div>
          <p v-if="g.krs" class="text-xs text-gray-500 mt-2 whitespace-pre-wrap">{{ g.krs }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
