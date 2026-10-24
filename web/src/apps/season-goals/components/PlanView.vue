<script setup lang="ts">
// 自动规划视图：预览建议 + 生成草稿到收集单
import { store, previewPlan, applyPlan, fmtGeneratedAt } from '../store'
</script>

<template>
  <section id="view-plan" class="view" :class="{ active: store.view === 'plan' }">
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold text-slate-800">自动规划</h2>
        <div class="flex gap-2">
 <button class="text-white text-sm font-medium px-4 py-2 rounded-lg bg-nec-royal" @click="previewPlan()">预览规划</button>
          <button
            id="apply-btn"
            :disabled="store.applyDisabled"
            class="bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg"
            @click="applyPlan()"
          >生成草稿到收集单</button>
        </div>
      </div>
      <p class="text-xs text-gray-500 mb-4">按「负责组」聚合未完成任务生成目标建议；已有进行中目标的组自动跳过。「生成草稿」会把建议写入收集单（待评审），需人工采纳后才进入目标看板。</p>
      <div id="plan-result" class="space-y-3">
        <p v-if="store.plan.phase === 'idle'" class="text-sm text-gray-400">点击「预览规划」查看建议</p>
        <p v-else-if="store.plan.phase === 'loading'" class="text-sm text-gray-400">分析任务中…</p>
        <p v-else-if="store.plan.phase === 'error'" class="text-sm text-red-500">预览失败：{{ store.plan.error }}</p>
        <template v-else-if="store.plan.data">
          <p class="text-xs text-gray-500">共扫描 {{ store.plan.data.taskCount }} 条未完成任务 · 生成于 {{ fmtGeneratedAt(store.plan.data.generatedAt) }}</p>
          <p v-if="!store.plan.data.suggestions.length" class="text-sm text-gray-400">没有可生成的目标建议</p>
          <div v-for="(s, i) in store.plan.data.suggestions" :key="i" class="border border-gray-100 rounded-lg p-4">
            <div class="flex items-center justify-between">
              <p class="font-bold text-slate-800">{{ s.title }}</p>
              <span class="text-xs text-gray-500">截止 {{ s.deadline }}</span>
            </div>
            <p class="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{{ s.krs }}</p>
            <p class="text-xs text-gray-400 mt-2">基于任务：{{ s.basedOnTasks.join('、') }}</p>
          </div>
          <div v-if="store.plan.data.skipped.length" class="text-xs text-gray-500 border-t border-gray-100 pt-3">
            <p v-for="(s, i) in store.plan.data.skipped" :key="i">跳过「{{ s.group }}」：{{ s.reason }}</p>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>
