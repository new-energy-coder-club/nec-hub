<script setup lang="ts">
// 新增机图纸评审流程：独立页（/apps/drawing-review/）与门户 Tab 共用本视图
// embedded：隐藏 Hero、改用紧凑导航、底色换纸白（原 ?embedded=1 / iframe 嵌入语义）
import { ref, onMounted } from 'vue'
import { apiDr } from '@shared/api'
import SubmitView from './components/SubmitView.vue'
import ListView from './components/ListView.vue'
import FlowBoard from './components/FlowBoard.vue'
import DetailView from './components/DetailView.vue'
import type { ViewName } from './types'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const view = ref<ViewName>('list')
const detailId = ref('')
const detailSeq = ref(0) // 每次进入详情都强制重取（原 router('detail') 总是 loadDetail）
const notConfigured = ref(false)
const listRef = ref<InstanceType<typeof ListView>>()
const flowRef = ref<InstanceType<typeof FlowBoard>>()

function router(v: ViewName, id = '') {
  view.value = v
  if (v === 'list') { listRef.value?.reload(); flowRef.value?.reload() }
  if (v === 'detail' && id) { detailId.value = id; detailSeq.value++ }
}

onMounted(async () => {
  if (props.embedded) document.body.style.background = 'var(--nec-paper)'
  // 原实现：init 先查配置，未配置时提示横幅；接口异常时静默（列表各自报错）
  try {
    const cfg = await apiDr('/config')
    notConfigured.value = !cfg.configured
  } catch { /* 保持静默，列表加载会自行提示错误 */ }
})
</script>

<template>
  <div>
    <!-- KV Hero：蓝图 × 破晓（embedded 模式隐藏） -->
    <header v-if="!embedded" id="app-header" class="hero">
      <div class="max-w-5xl mx-auto px-4 sm:px-6 pt-5 sm:pt-6 pb-8 sm:pb-12 relative">
        <div class="flex items-center gap-3 relative z-10 flex-wrap">
          <img src="/brand/nec-logo.svg" alt="NEC" class="h-8 w-auto" />
          <div class="leading-tight">
            <div class="font-black text-base text-nec-navy">常州工NEC <span class="text-sm font-extrabold text-nec-cyan">in CIT</span></div>
            <div class="mono text-[11px] text-nec-gray tracking-wider">newenergycoder.club</div>
          </div>
          <nav class="ml-auto flex gap-2">
            <a href="/" class="nav-btn mono px-3 py-2 text-sm rounded-lg">← 门户</a>
            <button class="nav-btn mono px-3 py-2 text-sm rounded-lg" :class="{ on: view === 'list' }" @click="router('list')">评审单</button>
            <button class="nav-btn mono px-3 py-2 text-sm rounded-lg" :class="{ on: view === 'submit' }" @click="router('submit')">提交</button>
          </nav>
        </div>

        <div class="mt-8 relative z-10">
          <p class="mono text-xs tracking-[.22em] mb-3 text-nec-navy"><b>NEC HUB</b> · 图纸评审 · KEEP BUILDING</p>
          <h1 class="hero-title text-3xl sm:text-5xl">新增机图纸<span class="accent">评审</span>流程</h1>
          <p class="mono mt-3 text-xs text-nec-gray tracking-widest">提交图纸 → 自动预约会议 → 保存纪要 → BOM 生成</p>
          <div class="mt-5 flex flex-wrap gap-2 text-sm">
            <span class="mono px-3 py-1 rounded-sm bg-white text-nec-navy" style="border:1.5px solid var(--nec-navy)"><i class="not-italic mr-1 text-nec-cyan">01</i>提交</span>
            <span class="mono px-3 py-1 rounded-sm bg-white text-nec-navy" style="border:1.5px solid var(--nec-navy)"><i class="not-italic mr-1 text-nec-cyan">02</i>评审</span>
            <span class="mono px-3 py-1 rounded-sm bg-white text-nec-navy" style="border:1.5px solid var(--nec-navy)"><i class="not-italic mr-1 text-nec-cyan">03</i>纪要</span>
            <span class="mono px-3 py-1 rounded-sm bg-white text-nec-navy" style="border:1.5px solid var(--nec-navy)"><i class="not-italic mr-1 text-nec-cyan">04</i>BOM</span>
          </div>
        </div>

        <!-- 破晓太阳 -->
        <svg class="absolute -right-6 sm:right-8 top-16 w-28 sm:w-44 opacity-40 sm:opacity-90 z-0 pointer-events-none" viewBox="0 0 800 800" fill="none" aria-hidden="true">
          <defs><linearGradient id="sunG" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#4FC3F7"/><stop offset="1" stop-color="#1FA9E8"/></linearGradient></defs>
          <circle cx="400" cy="400" r="330" stroke="url(#sunG)" stroke-width="10"/>
          <circle cx="400" cy="400" r="282" stroke="#1FA9E8" stroke-width="2.5" stroke-dasharray="3 14" opacity=".85"/>
          <g stroke="#141B5E" stroke-width="2"><line x1="400" y1="368" x2="400" y2="432"/><line x1="368" y1="400" x2="432" y2="400"/></g>
          <circle cx="400" cy="400" r="7" fill="#141B5E"/>
        </svg>
      </div>
      <div class="horizon"></div>
      <div class="base-line"></div>
    </header>

    <!-- embedded 模式下的紧凑导航 -->
    <div v-else id="embed-nav" class="max-w-5xl mx-auto px-4 pt-4">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-lg font-black text-nec-ink">新增机图纸评审流程</h1>
        <nav class="flex gap-2">
          <button class="nav-btn mono px-3 py-1.5 text-sm rounded-lg" :class="{ on: view === 'list' }" @click="router('list')">评审单</button>
          <button class="nav-btn mono px-3 py-1.5 text-sm rounded-lg" :class="{ on: view === 'submit' }" @click="router('submit')">提交</button>
        </nav>
      </div>
    </div>

    <div class="max-w-5xl mx-auto px-4 py-6">
      <!-- 未配置提示 -->
      <div v-if="notConfigured" id="not-configured" class="rounded-lg p-4 mb-6" style="background:#FFF8E6;border:1px solid #F5D876">
        <p class="font-medium" style="color:#8A6D1A">流程尚未配置</p>
        <p class="text-sm" style="color:#A8892E">请先让 Agent 调用 MCP 的 <span class="mono">config_drawing_review</span> 配置 Base 表。</p>
      </div>

      <!-- 提交视图 -->
      <SubmitView v-show="view === 'submit'" @submitted="router('list')" />

      <!-- 流程看板（阻塞预警 + 甘特图，随列表视图显隐） -->
      <FlowBoard v-show="view === 'list'" ref="flowRef" @open="id => router('detail', id)" />

      <!-- 评审单视图（列表 / 看板 一体） -->
      <ListView v-show="view === 'list'" ref="listRef" @open="id => router('detail', id)" />

      <!-- 详情视图 -->
      <section v-if="view === 'detail'" id="view-detail">
        <div class="mb-4">
          <button class="text-sm link hover:underline mono" @click="router('list')">← 返回评审单</button>
        </div>
        <DetailView :review-id="detailId" :key="detailId + '-' + detailSeq" />
      </section>
    </div>
  </div>
</template>
