<script setup lang="ts">
// KV V2 Hero：BUILT TO DAWN + 健康徽标/面板 + 用户盒
import { computed, ref, onMounted } from 'vue'
import { auth, heroCompact } from '@shared/auth'
import { ORIGIN } from '@shared/api'
import { switchTab } from '@portal/composables/useTabs'
import UserBox from './UserBox.vue'

// Hero 压缩模式：登录用户与回访访客只保留品牌细条
const compact = computed(() => heroCompact())

// ---- 健康检查：结果存 healthData，徽标点击展开全站健康面板（API / MCP 延迟 / FE-05 数据健康） ----
const healthData = ref<any>(null)
const healthOk = ref<boolean | null>(null)
const panelOpen = ref(false)
const panelLoading = ref(false)
const mcpLine = ref('')
const validateLine = ref('')

onMounted(() => {
  fetch('/api/health').then(r => r.json()).then(d => {
    healthData.value = d
    healthOk.value = true
  }).catch(() => {
    healthOk.value = false
  })
})

async function toggleHealthPanel() {
  if (panelOpen.value) { panelOpen.value = false; return }
  panelOpen.value = true
  panelLoading.value = true
  mcpLine.value = ''
  validateLine.value = ''
  // MCP 端点延迟：401 也算端点存活（仅说明需要鉴权）
  const t0 = performance.now()
  try {
    const resp = await fetch(ORIGIN + '/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    const ms = Math.round(performance.now() - t0)
    mcpLine.value = resp.ok
      ? `<span class="text-green-600">● 正常</span> · ${ms}ms`
      : resp.status === 401
        ? `<span class="text-green-600">● 正常</span>（需鉴权）· ${ms}ms`
        : `<span class="text-amber-600">● HTTP ${resp.status}</span>`
  } catch {
    mcpLine.value = `<span class="text-red-500">● 不可达</span>`
  }
  let vLine = `<span class="text-gray-400">登录后可见</span>`
  if (auth.me.authenticated) {
    try {
      const r = await fetch('/api/validate/report')
      if (r.ok) {
        const rep = await r.json()
        vLine = rep && !rep.empty
          ? `${rep.total ? `<span class="text-red-600">● ${rep.total} 条异常</span>` : `<span class="text-green-600">● 无异常</span>`} · 上次校验 ${rep.generatedAt ? new Date(rep.generatedAt).toLocaleString('zh-CN') : '—'}`
          : `<span class="text-gray-400">暂无校验报告</span>`
      }
    } catch { /* 保持默认提示 */ }
  }
  validateLine.value = vLine
  panelLoading.value = false
}

function goDashboard() {
  panelOpen.value = false
  switchTab('dashboard')
}
</script>

<template>
  <!-- KV V2 Hero：BUILT TO DAWN -->
  <header class="hero" :class="{ compact }">
    <div class="max-w-5xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-8 sm:pb-10 relative hero-inner">
      <div class="flex items-center gap-3 relative z-10">
        <img src="/brand/nec-logo.svg" alt="NEC" class="h-8 sm:h-9 w-auto" />
        <div class="leading-tight">
 <div class="font-black text-lg text-nec-navy">常州工NEC <span class="text-sm font-extrabold text-nec-cyan">in CIT</span></div>
          <div class="mono text-[11px] text-gray-500 tracking-wider">newenergycoder.club</div>
        </div>
 <span id="hero-mini" class="mono text-xs font-bold tracking-[.18em] ml-1 text-nec-navy">BUILT <span class="text-nec-cyan">TO</span> DAWN</span>
        <div class="ml-auto relative">
          <button id="health" @click="toggleHealthPanel" title="点击查看全站健康详情"
            class="text-xs px-2 py-1 rounded cursor-pointer"
            :class="healthOk === null ? 'bg-gray-100 text-gray-500' : healthOk ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'">
            {{ healthOk === null ? '连接中…' : healthOk ? '● 服务正常' : '● 连接失败' }}
          </button>
          <div v-if="panelOpen" id="health-panel" class="absolute right-0 top-full mt-1 w-72 sm:w-80 bg-white rounded-xl shadow-lg border border-gray-100 p-4 z-30 text-left">
            <p v-if="panelLoading" class="text-xs text-gray-400">检测中…</p>
            <template v-else>
 <p class="text-xs font-bold mb-2 text-nec-navy">全站健康</p>
              <ul class="text-xs text-gray-600 space-y-1.5">
                <li class="flex justify-between gap-2"><span>API 服务</span>
                  <span v-if="healthData"><span class="text-green-600">● 正常</span> · {{ healthData.service || 'nec-hub' }}</span>
                  <span v-else class="text-red-500">● 异常</span>
                </li>
                <li class="flex justify-between gap-2"><span>最近心跳</span><span class="text-gray-400">{{ healthData && healthData.time ? new Date(healthData.time).toLocaleString('zh-CN') : '—' }}</span></li>
                <!-- mcpLine/validateLine 内容为本函数生成的固定结构 HTML（无用户输入），与原实现一致 -->
                <li class="flex justify-between gap-2"><span>NEC-MCP 端点</span><span v-html="mcpLine"></span></li>
                <li class="flex justify-between gap-2"><span>数据健康（FE-05）</span><span v-html="validateLine"></span></li>
              </ul>
 <button @click="goDashboard" class="mt-3 text-xs hover:underline text-nec-cyan">数据健康详情 →</button>
            </template>
          </div>
        </div>
        <UserBox />
      </div>

      <!-- 全尺寸品牌区：仅未登录访客的首次访问展示；登录用户/回访访客走压缩细条 -->
      <div id="hero-full">
        <div class="mt-10 relative z-10">
 <p class="mono text-xs tracking-[.18em] sm:tracking-[.22em] mb-3 sm:mb-4 text-nec-navy"><b>NEC HUB</b> · 团队 AI 中台 · KEEP BUILDING</p>
          <h1 class="hero-title text-4xl sm:text-7xl">BUILT <span class="to">TO</span> DAWN</h1>
 <p class="mt-3 sm:mt-4 font-black tracking-[.22em] sm:tracking-[.4em] text-sm sm:text-base text-nec-navy">为黎明而造</p>
          <p class="mono mt-3 text-xs text-gray-500 tracking-wider sm:tracking-widest leading-relaxed">应用广场 · SKILL 中心 · 开源仓库 · 数据看板 · NEC-MCP</p>
          <div class="mt-5 sm:mt-6 flex flex-wrap gap-2 sm:gap-3 text-sm">
            <span class="chip mono px-3 py-2 rounded-sm bg-white"><i class="not-italic mr-1">01</i>找物品</span>
            <span class="chip mono px-3 py-2 rounded-sm bg-white"><i class="not-italic mr-1">02</i>扫标签</span>
            <span class="chip mono px-3 py-2 rounded-sm bg-white"><i class="not-italic mr-1">03</i>办工单</span>
            <a href="https://mes.newenergycoder.club/home.html" target="_blank"
 class="mono px-4 py-2 rounded-sm text-white inline-block bg-nec-cyan">→ NEC 仓库作业台</a>
          </div>
        </div>

        <!-- 破晓太阳 -->
        <svg class="hero-sun absolute -right-10 sm:right-10 top-24 w-36 sm:w-64 opacity-40 sm:opacity-90 z-0 pointer-events-none" viewBox="0 0 800 800" fill="none" aria-hidden="true">
          <defs><linearGradient id="sunG" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#4FC3F7"/><stop offset="1" stop-color="#1FA9E8"/></linearGradient></defs>
          <circle cx="400" cy="400" r="330" stroke="url(#sunG)" stroke-width="10"/>
          <circle cx="400" cy="400" r="282" stroke="#1FA9E8" stroke-width="2.5" stroke-dasharray="3 14" opacity=".85"/>
          <g stroke="#141B5E" stroke-width="2"><line x1="400" y1="368" x2="400" y2="432"/><line x1="368" y1="400" x2="432" y2="400"/></g>
          <circle cx="400" cy="400" r="7" fill="#141B5E"/>
        </svg>
      </div><!-- /#hero-full -->
    </div>
    <div class="horizon" style="bottom:34px"></div>
    <div class="base-line"></div>
  </header>
</template>
