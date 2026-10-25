<script setup lang="ts">
// 评审单视图：看板 / 列表 一体，列按 STATUS_MAP 顺序分组；支持状态/类型定位与关键词搜索，30s 自动读取最新状态
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { store, router, loadReviews, statusOf, typeLabel, personLabel, STATUS_MAP, TYPE_MAP, type Review } from '../store'

const AUTO_REFRESH_MS = 30_000

const statusFilter = ref('')
const typeFilter = ref('')
const keyword = ref('')
const updatedAt = ref('')
let timer: ReturnType<typeof setInterval> | undefined

// 关键词定位：单号 / 硬件名称 / 项目 / 负责人 / 设计说明
function matches(r: Review) {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return true
  return [r.reviewId, r.hardwareName, r.projectId, r.designerId, r.designNotes]
    .some(v => (v || '').toLowerCase().includes(k))
}

// 类型 → 关键词 → 状态 逐级定位
const byType = computed(() => store.reviews.filter((r: Review) => !typeFilter.value || r.hardwareType === typeFilter.value))
const filtered = computed(() => byType.value.filter(matches))
const shown = computed(() => (statusFilter.value ? filtered.value.filter(r => r.status === statusFilter.value) : filtered.value))

// 状态 chip：仅展示有数据的状态 + 末尾「全部」；计数跟随类型与关键词定位
const statusChips = computed(() => {
  const counts: Record<string, number> = {}
  filtered.value.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1 })
  const list = Object.entries(STATUS_MAP)
    .filter(([k]) => counts[k])
    .map(([k, v]) => ({ key: k, label: v.label, count: counts[k] }))
  list.push({ key: '', label: '全部', count: filtered.value.length })
  return list
})

// 类型 chip：仅展示有数据的硬件类型
const typeChips = computed(() => {
  const counts: Record<string, number> = {}
  store.reviews.forEach(r => { counts[r.hardwareType] = (counts[r.hardwareType] || 0) + 1 })
  const list = Object.keys(TYPE_MAP)
    .filter(t => counts[t])
    .map(t => ({ key: t, label: TYPE_MAP[t], count: counts[t] }))
  list.push({ key: '', label: '全部类型', count: store.reviews.length })
  return list
})

const boardColumns = computed(() =>
  Object.keys(STATUS_MAP)
    .filter(status => !statusFilter.value || status === statusFilter.value)
    .map(status => ({
      status,
      label: STATUS_MAP[status].label,
      items: filtered.value.filter((r: Review) => r.status === status),
    })),
)

function modeStyle(mode: 'board' | 'table') {
  const on = store.displayMode === mode
  return { background: on ? 'var(--nec-navy)' : 'var(--nec-paper)', color: on ? '#fff' : 'var(--nec-gray)' }
}

async function refresh(silent = false) {
  await loadReviews(silent)
  if (store.listState === 'ok') updatedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

onMounted(() => {
  // 自动读取最新评审状态：页面隐藏时暂停轮询
  timer = setInterval(() => { if (!document.hidden) refresh(true) }, AUTO_REFRESH_MS)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <section id="view-list">
    <div class="nec-card p-5">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-lg font-bold text-nec-ink">评审单</h2>
          <p class="mono text-xs text-nec-gray tracking-wider">REVIEW PIPELINE</p>
        </div>
        <div class="flex items-center gap-2">
 <div class="flex rounded-lg overflow-hidden text-sm border-[1.5px] border-nec-line">
            <button id="mode-board" class="mono px-3 py-1.5" :style="modeStyle('board')" @click="store.displayMode = 'board'">看板</button>
 <button id="mode-table" class="mono px-3 py-1.5 border-l-[1.5px] border-nec-line" :style="modeStyle('table')" @click="store.displayMode = 'table'">列表</button>
          </div>
          <button class="text-sm font-medium px-2 link" @click="refresh()">刷新</button>
        </div>
      </div>

      <div class="mb-3 flex items-center gap-3">
        <input v-model="keyword" type="search" placeholder="搜索单号 / 硬件名称 / 项目 / 负责人…"
          class="w-full md:w-80 text-sm px-3 py-1.5 rounded-lg text-nec-ink"
 />class="border-[1.5px] border-nec-line bg-nec-paper"
        <span v-if="updatedAt" class="mono text-xs text-nec-gray whitespace-nowrap">更新于 {{ updatedAt }}</span>
      </div>

      <div id="filter-type-chips" class="flex flex-wrap gap-2 mb-2">
        <button v-for="c in typeChips" :key="c.key" class="mono text-xs px-3 py-1.5 rounded-full border"
          :class="typeFilter === c.key ? 'text-white border-transparent' : 'border-nec-line text-nec-gray'"
          :style="typeFilter === c.key ? 'background:var(--nec-cyan)' : ''"
          @click="typeFilter = c.key">{{ c.label }} · {{ c.count }}</button>
      </div>

      <div id="filter-chips" class="flex flex-wrap gap-2 mb-4">
        <button v-for="c in statusChips" :key="c.key" class="mono text-xs px-3 py-1.5 rounded-full border"
          :class="statusFilter === c.key ? 'text-white border-transparent' : 'border-nec-line text-nec-gray'"
          :style="statusFilter === c.key ? 'background:var(--nec-navy)' : ''"
          @click="statusFilter = c.key">{{ c.label }} · {{ c.count }}</button>
      </div>

      <!-- 看板 -->
      <div v-show="store.displayMode === 'board'" id="dashboard" class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <p v-if="store.listState === 'loading'" class="text-sm text-nec-gray md:col-span-3 lg:col-span-4">加载中…</p>
        <div v-else-if="store.listState === 'unconfigured'" class="md:col-span-3 lg:col-span-4">
 <div class="rounded-lg p-6 text-center bg-nec-fog border border-dashed border-nec-line">
            <p class="mono text-xs tracking-widest text-nec-cyan mb-2">WAITING FOR CONFIG</p>
            <p class="text-sm text-nec-gray">完成 Base 表配置后，评审单将在这里以看板形式流转。</p>
          </div>
        </div>
        <p v-else-if="store.listState === 'error'" class="text-sm md:col-span-3 lg:col-span-4" style="color:#C22E2E">加载失败：{{ store.listError }}</p>
        <template v-else>
 <div v-for="col in boardColumns" :key="col.status" class="rounded-lg p-3 bg-nec-fog border border-nec-line">
            <div class="flex items-center justify-between mb-3">
              <span class="text-sm font-bold text-nec-navy">{{ col.label }}</span>
              <span class="mono text-xs font-bold text-nec-cyan">{{ String(col.items.length).padStart(2, '0') }}</span>
            </div>
            <div class="space-y-2">
 <div v-for="r in col.items" :key="r.reviewId" class="rounded p-3 cursor-pointer transition-shadow hover:shadow-sm bg-nec-paper border border-nec-line" @click="router('detail', r.reviewId)">
                <p class="text-sm font-medium text-nec-ink truncate">{{ r.hardwareName }}</p>
                <p class="mono text-xs text-nec-gray">{{ r.reviewId }} · {{ typeLabel(r.hardwareType) }}</p>
              </div>
              <p v-if="!col.items.length" class="text-xs text-nec-gray text-center py-4">无</p>
            </div>
          </div>
        </template>
      </div>

      <!-- 列表 -->
      <div v-show="store.displayMode === 'table'" id="review-list" class="space-y-3">
        <p v-if="store.listState === 'loading'" class="text-sm text-nec-gray">加载中…</p>
 <div v-else-if="store.listState === 'unconfigured'" class="rounded-lg p-6 text-center bg-nec-fog border border-dashed border-nec-line">
          <p class="mono text-xs tracking-widest text-nec-cyan mb-2">WAITING FOR CONFIG</p>
          <p class="text-sm text-nec-gray">完成 Base 表配置后，评审单将在这里以看板形式流转。</p>
        </div>
        <p v-else-if="store.listState === 'error'" class="text-sm" style="color:#C22E2E">加载失败：{{ store.listError }}</p>
        <p v-else-if="!shown.length" class="text-sm text-nec-gray">{{ keyword || statusFilter || typeFilter ? '无匹配评审单' : '暂无评审单' }}</p>
        <template v-else>
 <div v-for="r in shown" :key="r.reviewId" class="rounded-lg p-4 cursor-pointer transition-shadow hover:shadow-md border border-nec-line bg-nec-paper" @click="router('detail', r.reviewId)">
            <div class="flex items-center justify-between">
              <div>
                <p class="font-bold text-nec-ink"><span class="mono text-nec-royal">{{ r.reviewId }}</span> · {{ r.hardwareName }}</p>
                <p class="mono text-xs text-nec-gray mt-0.5">项目 {{ r.projectId }} · {{ typeLabel(r.hardwareType) }} · {{ r.hardwareVersion }}</p>
              </div>
              <span class="status-badge" :style="statusOf(r.status).color">{{ statusOf(r.status).label }}</span>
            </div>
            <p class="text-sm text-nec-gray mt-2 line-clamp-2">{{ r.designNotes }}</p>
            <div class="mt-3 flex gap-3 text-xs items-center">
              <span class="text-nec-gray">负责人：<span :title="r.designerId">{{ personLabel(r.designerId) }}</span></span>
              <a v-if="r.meetingLink" :href="r.meetingLink" target="_blank" class="link hover:underline" @click.stop>会议链接 →</a>
            </div>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>
