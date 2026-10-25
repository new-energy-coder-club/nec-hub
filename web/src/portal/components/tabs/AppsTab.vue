<script setup lang="ts">
// 应用广场：上架 Prompt + /api/apps 合并视图（builtin 仓内应用 / r2 队员托管 / external 外链）
import { ref, computed, onMounted } from 'vue'
import { PUBLISH_PROMPT } from '@shared/prompts'
import { copyText } from '@shared/api'

const apps = ref<any[] | null>(null)
const showPrompt = ref(false)

onMounted(() => {
  fetch('/api/apps').then(r => r.json()).then(list => { apps.value = Array.isArray(list) ? list : [] }).catch(() => { apps.value = [] })
})

const coreApps = computed(() => (apps.value ?? []).filter(a => a.source === 'builtin' && a.group === 'core'))
const standaloneApps = computed(() => (apps.value ?? []).filter(a => a.source === 'builtin' && a.group !== 'core'))
const communityApps = computed(() => (apps.value ?? []).filter(a => a.source !== 'builtin'))
</script>

<template>
  <section id="tab-apps">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">应用广场</h2>
 <button @click="showPrompt = !showPrompt" class="text-sm text-white px-4 py-2 rounded-lg bg-nec-cyan">＋ 发布我的应用</button>
    </div>
    <div v-if="showPrompt" id="publish-box" class="mb-6 bg-white rounded-xl shadow p-5">
      <h3 class="font-bold mb-2">上架 Prompt（复制后发给你的 Agent）</h3>
      <pre class="prompt text-sm bg-gray-900 text-green-300 rounded-lg p-4" id="publish-prompt">{{ PUBLISH_PROMPT }}</pre>
 <button @click="copyText(PUBLISH_PROMPT)" class="mt-3 text-sm text-white px-3 py-1.5 rounded bg-nec-navy">复制</button>
    </div>

    <!-- 核心流程（仓内内置应用，manifest 驱动） -->
    <div v-if="coreApps.length" class="mb-6 bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <h3 class="text-sm font-bold text-slate-700 mb-3">核心流程</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <a v-for="a in coreApps" :key="a.name" :href="a.url" class="block border border-gray-100 rounded-lg p-4 hover:shadow-md hover:border-[#1FA9E8] transition">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-[#E8ECFB] flex items-center justify-center text-lg">{{ a.icon || '🧩' }}</div>
            <div>
              <p class="font-bold text-slate-800">{{ a.title }}</p>
              <p class="text-xs text-gray-500">{{ a.description }}</p>
            </div>
          </div>
        </a>
      </div>
    </div>

    <!-- 独立应用（仓内内置应用，manifest 驱动） -->
    <div v-if="standaloneApps.length" class="mb-6 bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <h3 class="text-sm font-bold text-slate-700 mb-3">独立应用</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <a v-for="a in standaloneApps" :key="a.name" :href="a.url" class="block border border-gray-100 rounded-lg p-4 hover:shadow-md hover:border-[#1FA9E8] transition">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-[#E8ECFB] flex items-center justify-center text-lg">{{ a.icon || '🧩' }}</div>
            <div>
              <p class="font-bold text-slate-800">{{ a.title }}</p>
              <p class="text-xs text-gray-500">{{ a.description }}</p>
            </div>
          </div>
        </a>
      </div>
    </div>

    <!-- 队员上架应用（deploy_app R2 托管 + register_app 外链） -->
    <div v-if="communityApps.length || apps" class="mb-2">
      <h3 class="text-sm font-bold text-slate-700 mb-3">队员上架应用</h3>
    </div>
    <div id="apps-list" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div v-if="apps && !communityApps.length" class="col-span-full bg-white rounded-xl shadow p-8 text-center text-gray-400 text-sm">
        还没有队员应用上架。<br/>点击右上角「发布我的应用」，把 Prompt 发给你的 Agent 即可上架第一个应用。
      </div>
      <a v-for="a in communityApps" :key="a.name" :href="a.url" target="_blank" class="block bg-white rounded-xl shadow hover:shadow-md transition p-5">
        <div class="flex items-center justify-between">
          <h3 class="font-bold">{{ a.title }}</h3>
          <span class="text-xs text-gray-400">v{{ a.version }}{{ a.source === 'external' ? ' · 外链' : '' }}</span>
        </div>
        <p class="text-xs text-gray-500 mt-1">{{ a.name }} · {{ a.author }}</p>
        <p class="text-xs text-gray-400 mt-2">更新于 {{ a.updatedAt ? new Date(a.updatedAt).toLocaleString('zh-CN') : '—' }}</p>
        <p v-if="a.shadows" class="mt-2 inline-block text-xs px-1.5 py-0.5 rounded" style="background:#FEF3C7;color:#B45309">⚠ 双版本：本卡片为 R2 独立域名版，/apps/ 路径为仓内版</p>
      </a>
    </div>
  </section>
</template>
