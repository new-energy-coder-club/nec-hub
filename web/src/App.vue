<script setup lang="ts">
// NEC 团队 AI 中台门户：Hero + TabNav + 10 个 Tab（所有面板常驻挂载、v-show 切换，保持原单文件版的 DOM 常驻行为）
import { onMounted, watch } from 'vue'
import HeroHeader from './components/HeroHeader.vue'
import TabNav from './components/TabNav.vue'
import GoalBanner from './components/GoalBanner.vue'
import TodoBar from './components/TodoBar.vue'
import HomeTab from './components/tabs/HomeTab.vue'
import MyTasksTab from './components/tabs/MyTasksTab.vue'
import DrawingReviewTab from './components/tabs/DrawingReviewTab.vue'
import IframeTab from './components/tabs/IframeTab.vue'
import AppsTab from './components/tabs/AppsTab.vue'
import SkillsTab from './components/tabs/SkillsTab.vue'
import DocsTab from './components/tabs/DocsTab.vue'
import ReposTab from './components/tabs/ReposTab.vue'
import DashboardTab from './components/tabs/DashboardTab.vue'
import PrdTab from './components/tabs/PrdTab.vue'
import AgentTab from './components/tabs/AgentTab.vue'
import { tabs, initTabs, switchTab, applyHashRoute, replayLoginReturn } from './composables/useTabs'
import { auth, bootAuth } from './composables/useAuth'
import { loadTodos } from './composables/useBanners'

onMounted(async () => {
  initTabs()
  await bootAuth()
  loadTodos() // FE-09 待办条（未登录/无待办自动隐藏）
  replayLoginReturn() // OAuth 往返后恢复暂存的深链目标（ST-02）
})
watch(() => auth.tick, () => {
  loadTodos()
  applyHashRoute() // 登录门控放开后重放暂存的深链（ST-02）
})
</script>

<template>
  <HeroHeader />
  <TabNav />

  <GoalBanner />
  <TodoBar />

  <!-- 看板是表格密集型面板，单独放宽版心；其余 Tab 维持阅读宽度 -->
  <main class="mx-auto px-4 sm:px-6 py-6 sm:py-8" :class="tabs.active === 'dashboard' ? 'max-w-7xl' : 'max-w-5xl'">
    <HomeTab v-show="tabs.active === 'home'" @goto="switchTab" />
    <MyTasksTab v-show="tabs.active === 'my-tasks'" />
    <DrawingReviewTab v-show="tabs.active === 'drawing-review'" />
    <IframeTab v-show="tabs.active === 'reimburse'" tab="reimburse" title="报销" href="/apps/reimburse/" src="/apps/reimburse/?embedded=1" frame-title="报销助手" />
    <IframeTab v-show="tabs.active === 'task-schedule'" tab="task-schedule" title="任务排期" href="/apps/task-schedule/" src="/apps/task-schedule/?embedded=1" frame-title="任务排期" />
    <IframeTab v-show="tabs.active === 'season-goals'" tab="season-goals" title="赛季目标" href="/apps/season-goals/" src="/apps/season-goals/?embedded=1" frame-title="赛季目标管理" />
    <AppsTab v-show="tabs.active === 'apps'" />
    <SkillsTab v-show="tabs.active === 'skills'" />
    <DocsTab v-show="tabs.active === 'docs'" />
    <ReposTab v-show="tabs.active === 'repos'" />
    <DashboardTab v-show="tabs.active === 'dashboard'" />
    <PrdTab v-show="tabs.active === 'prd'" />
    <AgentTab v-show="tabs.active === 'agent'" />
  </main>

  <footer class="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 text-xs text-gray-400 leading-relaxed">
    NEC 团队 AI 中台 MVP · Cloudflare Workers + KV + R2 · 数据基建在飞书 · BUILT TO DAWN — KEEP BUILDING<br/>
    <a href="/brand/" class="hover:underline" style="color:var(--nec-cyan)">→ NEC 品牌主视觉（Logo / PPT 模板 / VI 规范）</a>
  </footer>
</template>
