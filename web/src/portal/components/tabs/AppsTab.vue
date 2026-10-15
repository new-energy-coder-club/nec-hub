<script setup lang="ts">
// 应用广场：上架 Prompt + 核心流程/独立应用静态入口 + /api/apps 列表
import { ref, onMounted } from 'vue'
import { PUBLISH_PROMPT } from '@shared/prompts'
import { copyText } from '@shared/api'

const apps = ref<any[] | null>(null)
const showPrompt = ref(false)

onMounted(() => {
  fetch('/api/apps').then(r => r.json()).then(list => { apps.value = list || [] }).catch(() => { apps.value = [] })
})

const coreFlows = [
  { href: '/apps/drawing-review/', icon: '📐', title: '新增机图纸评审', desc: '提交 · 评审 · BOM · 排期 · 采购' },
  { href: '/apps/hardware-review/', icon: '🔧', title: '硬件评审流程', desc: '选型 · 评审 · 立项 · 归档' },
  { href: '/apps/mech-review-6014/', icon: '⚙️', title: '6014 电机机械评审', desc: '评审纪要 · 转接板草图 · DXF/CSV' },
  { href: '/apps/scoring/', icon: '🏆', title: 'NEC 评分看板', desc: '赛事成绩 · 评分记录 · 排名' },
  { href: '/apps/contract-signing/', icon: '📝', title: '协议签署 OA 审批', desc: '合同提交 · 会签审批 · 归档' },
  { href: '/apps/domains/', icon: '🌐', title: '域名分发系统', desc: '子域名申请 · 分发管理' },
]
const standaloneApps = [
  { href: '/apps/reimburse/', icon: '💰', title: '报销助手', desc: '费用报销单 · 发票附件 · 提交审批' },
  { href: '/apps/compliance/', icon: '🛡️', title: '合规申请', desc: '合规事项提交 · 审批 · 归档' },
  { href: '/apps/cla-sign/', icon: '✍️', title: 'CLA 协议签署', desc: '开源贡献协议 · 签署 · PDF 证书' },
  { href: '/apps/drawing/', icon: '📏', title: '机械图纸审批', desc: '图纸提交 · 审批流转' },
  { href: '/apps/season-goals/', icon: '🎯', title: '赛季目标管理', desc: '目标 · 关键结果 · 完成度跟踪' },
  { href: '/apps/task-schedule/', icon: '🗓️', title: '任务排期', desc: '任务计划 · 排期甘特 · 进度' },
]
</script>

<template>
  <section id="tab-apps">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">应用广场</h2>
      <button @click="showPrompt = !showPrompt" class="text-sm text-white px-4 py-2 rounded-lg" style="background:var(--nec-cyan)">＋ 发布我的应用</button>
    </div>
    <div v-if="showPrompt" id="publish-box" class="mb-6 bg-white rounded-xl shadow p-5">
      <h3 class="font-bold mb-2">上架 Prompt（复制后发给你的 Agent）</h3>
      <pre class="prompt text-sm bg-gray-900 text-green-300 rounded-lg p-4" id="publish-prompt">{{ PUBLISH_PROMPT }}</pre>
      <button @click="copyText(PUBLISH_PROMPT)" class="mt-3 text-sm text-white px-3 py-1.5 rounded" style="background:var(--nec-navy)">复制</button>
    </div>

    <!-- 核心流程入口 -->
    <div class="mb-6 bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <h3 class="text-sm font-bold text-slate-700 mb-3">核心流程</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <a v-for="a in coreFlows" :key="a.href" :href="a.href" class="block border border-gray-100 rounded-lg p-4 hover:shadow-md hover:border-[#1FA9E8] transition">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-[#E8ECFB] flex items-center justify-center text-lg">{{ a.icon }}</div>
            <div>
              <p class="font-bold text-slate-800">{{ a.title }}</p>
              <p class="text-xs text-gray-500">{{ a.desc }}</p>
            </div>
          </div>
        </a>
      </div>
    </div>

    <!-- 独立应用（仓库托管的完整功能页，全部保留入口） -->
    <div class="mb-6 bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <h3 class="text-sm font-bold text-slate-700 mb-3">独立应用</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <a v-for="a in standaloneApps" :key="a.href" :href="a.href" class="block border border-gray-100 rounded-lg p-4 hover:shadow-md hover:border-[#1FA9E8] transition">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-[#E8ECFB] flex items-center justify-center text-lg">{{ a.icon }}</div>
            <div>
              <p class="font-bold text-slate-800">{{ a.title }}</p>
              <p class="text-xs text-gray-500">{{ a.desc }}</p>
            </div>
          </div>
        </a>
      </div>
    </div>

    <div id="apps-list" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div v-if="apps && !apps.length" class="col-span-full bg-white rounded-xl shadow p-8 text-center text-gray-400 text-sm">
        还没有应用上架。<br/>点击右上角「发布我的应用」，把 Prompt 发给你的 Agent 即可上架第一个应用。
      </div>
      <a v-for="a in apps" :key="a.name" :href="a.url" target="_blank" class="block bg-white rounded-xl shadow hover:shadow-md transition p-5">
        <div class="flex items-center justify-between">
          <h3 class="font-bold">{{ a.title }}</h3>
          <span class="text-xs text-gray-400">v{{ a.version }}{{ a.external ? ' · 外链' : '' }}</span>
        </div>
        <p class="text-xs text-gray-500 mt-1">{{ a.name }} · {{ a.author }}</p>
        <p class="text-xs text-gray-400 mt-2">更新于 {{ new Date(a.updatedAt).toLocaleString('zh-CN') }}</p>
      </a>
    </div>
  </section>
</template>
