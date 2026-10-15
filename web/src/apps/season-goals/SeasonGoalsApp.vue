<script setup lang="ts">
// 赛季目标管理：独立页（/apps/season-goals/）与门户 Tab 共用本视图
// embedded：隐藏顶栏、收窄边距（原 ?embedded=1 / iframe 嵌入语义）
import { onMounted } from 'vue'
import { store, router, init, type ViewName } from './store'
import SubmitView from './components/SubmitView.vue'
import CollectView from './components/CollectView.vue'
import GoalsView from './components/GoalsView.vue'
import PlanView from './components/PlanView.vue'
import './season-goals.css'

defineProps<{ embedded?: boolean }>()

const navs: { view: ViewName; label: string }[] = [
  { view: 'submit', label: '提交目标' },
  { view: 'collect', label: '收集单' },
  { view: 'goals', label: '目标看板' },
  { view: 'plan', label: '自动规划' },
]

onMounted(init)
</script>

<template>
  <div class="max-w-5xl mx-auto" :class="embedded ? '' : 'px-4 py-6'">
    <!-- 顶部导航（embedded 模式隐藏） -->
    <header v-if="!embedded" id="app-header" class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-xl font-black text-slate-800">赛季目标管理</h1>
          <p class="text-xs text-gray-500">提交目标 → 收集单评审 → 目标看板 → 按任务自动规划</p>
        </div>
        <nav class="flex gap-2 flex-wrap">
          <button
            v-for="n in navs"
            :key="n.view"
            class="nav-btn px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
            :class="{ 'bg-[#E8ECFB]': store.view === n.view, 'border-[#1A2FA0]': store.view === n.view }"
            :data-view="n.view"
            @click="router(n.view)"
          >{{ n.label }}</button>
        </nav>
      </div>
    </header>

    <!-- 未配置提示 -->
    <div v-if="store.notConfigured" id="not-configured" class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
      <p class="text-yellow-800 font-medium">模块未配置</p>
      <p class="text-sm text-yellow-700">请先调用 POST /api/season-goals/config 设置 base 与 tables（goals / collect 必填）。</p>
    </div>

    <SubmitView />
    <CollectView />
    <GoalsView />
    <PlanView />
  </div>

  <div
    v-if="store.toast.visible"
    id="toast"
    class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm text-white shadow-lg"
    :class="store.toast.ok ? 'bg-green-600' : 'bg-red-600'"
  >{{ store.toast.msg }}</div>
</template>
