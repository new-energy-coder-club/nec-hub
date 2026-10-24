<script setup lang="ts">
// 评审单视图（看板 / 列表 一体，原 #view-list）：筛选 chip、看板分列、列表卡片与原单文件版一致
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { apiDr } from '@shared/api'
import { DR_STATUS, drStatus, type Review } from '../types'

const emit = defineEmits<{ (e: 'open', reviewId: string): void }>()

const AUTO_REFRESH_MS = 30_000

const displayMode = ref<'board' | 'table'>('board')
const drFilter = ref('')
const keyword = ref('')
const reviews = ref<Review[]>([])
const loading = ref(true)
const error = ref('')
const updatedAt = ref('')
let timer: ReturnType<typeof setInterval> | undefined

// 关键词定位：单号 / 机型 / 项目 / 负责人 / 设计说明
function matches(r: Review) {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return true
  return [r.reviewId, r.machineName, r.projectId, r.designerId, r.designNotes]
    .some(v => (v || '').toLowerCase().includes(k))
}

const filtered = computed(() => reviews.value.filter(matches))
const shown = computed(() => (drFilter.value ? filtered.value.filter(r => r.status === drFilter.value) : filtered.value))

// 筛选 chip：仅展示有数据的状态 + 末尾「全部」；计数跟随关键词定位
const chips = computed(() => {
  const counts: Record<string, number> = {}
  filtered.value.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1 })
  const list = Object.entries(DR_STATUS)
    .filter(([k]) => counts[k])
    .map(([k, v]) => ({ key: k, label: v.label, count: counts[k] }))
  list.push({ key: '', label: '全部', count: filtered.value.length })
  return list
})

// 看板分列：按 DR_STATUS 顺序，应用状态筛选与关键词定位
const columns = computed(() => {
  const groups: Record<string, Review[]> = {}
  for (const r of filtered.value) {
    ;(groups[r.status] = groups[r.status] || []).push(r)
  }
  return Object.keys(DR_STATUS)
    .filter(status => !drFilter.value || status === drFilter.value)
    .map(status => ({ status, ...DR_STATUS[status], items: groups[status] || [] }))
})

// silent=true 为后台轮询：不闪 loading、失败保留旧数据
async function load(silent = false) {
  if (!silent) { loading.value = true; error.value = '' }
  try {
    reviews.value = await apiDr('')
    updatedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  } catch (err) {
    if (!silent) error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

function filterDr(status: string) { drFilter.value = status }

onMounted(() => {
  load()
  // 自动读取最新评审状态：页面隐藏时暂停轮询
  timer = setInterval(() => { if (!document.hidden) load(true) }, AUTO_REFRESH_MS)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
defineExpose({ reload: load })
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
            <button id="mode-board" class="mono px-3 py-1.5"
              :style="displayMode === 'board' ? 'background:var(--nec-navy);color:#fff' : 'background:var(--nec-paper);color:var(--nec-gray)'"
              @click="displayMode = 'board'">看板</button>
 <button id="mode-table" class="mono px-3 py-1.5 border-l-[1.5px] border-nec-line"
              :style="displayMode === 'table' ? 'background:var(--nec-navy);color:#fff' : 'background:var(--nec-paper);color:var(--nec-gray)'"
              @click="displayMode = 'table'">列表</button>
          </div>
          <button class="text-sm font-medium px-2 link" @click="load()">刷新</button>
        </div>
      </div>

      <div class="mb-3 flex items-center gap-3">
        <input v-model="keyword" type="search" placeholder="搜索单号 / 机型 / 项目 / 负责人…"
          class="w-full md:w-80 text-sm px-3 py-1.5 rounded-lg text-nec-ink"
 />class="border-[1.5px] border-nec-line bg-nec-paper"
        <span v-if="updatedAt" class="mono text-xs text-nec-gray whitespace-nowrap">更新于 {{ updatedAt }}</span>
      </div>

      <div id="filter-chips" class="flex flex-wrap gap-2 mb-4">
        <button v-for="c in chips" :key="c.key" class="mono text-xs px-3 py-1.5 rounded-full border"
          :class="drFilter === c.key ? 'text-white border-transparent' : 'border-nec-line text-nec-gray'"
          :style="drFilter === c.key ? 'background:var(--nec-navy)' : ''"
          @click="filterDr(c.key)">{{ c.label }} · {{ c.count }}</button>
      </div>

      <div v-show="displayMode === 'board'" id="dashboard" class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <p v-if="error" class="text-sm md:col-span-3 lg:col-span-4" style="color:#C22E2E">加载失败：{{ error }}</p>
        <p v-else-if="loading && !reviews.length" class="text-sm text-nec-gray md:col-span-3 lg:col-span-4">加载中…</p>
 <div v-for="col in columns" :key="col.status" class="rounded-lg p-3 bg-nec-fog border border-nec-line">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-bold text-nec-navy">{{ col.label }}</span>
            <span class="mono text-xs font-bold text-nec-cyan">{{ String(col.items.length).padStart(2, '0') }}</span>
          </div>
          <div class="space-y-2">
            <div v-for="r in col.items" :key="r.reviewId" class="rounded p-3 cursor-pointer transition-shadow hover:shadow-sm bg-nec-paper border border-nec-line"
 @click="emit('open', r.reviewId)">
              <p class="text-sm font-medium text-nec-ink truncate">{{ r.machineName }}</p>
              <p class="mono text-xs text-nec-gray">{{ r.reviewId }}</p>
            </div>
            <p v-if="!col.items.length" class="text-xs text-nec-gray text-center py-4">无</p>
          </div>
        </div>
      </div>

      <div v-show="displayMode === 'table'" id="review-list" class="space-y-3">
        <p v-if="error" class="text-sm" style="color:#C22E2E">加载失败：{{ error }}</p>
        <p v-else-if="!loading && !shown.length" class="text-sm text-nec-gray">{{ keyword || drFilter ? '无匹配评审单' : '暂无评审单' }}</p>
        <div v-for="r in shown" :key="r.reviewId" class="rounded-lg p-4 cursor-pointer transition-shadow hover:shadow-md border border-nec-line bg-nec-paper"
 @click="emit('open', r.reviewId)">
          <div class="flex items-center justify-between">
            <div>
              <p class="font-bold text-nec-ink"><span class="mono text-nec-royal">{{ r.reviewId }}</span> · {{ r.machineName }}</p>
              <p class="mono text-xs text-nec-gray mt-0.5">项目 {{ r.projectId }} · 版本 {{ r.drawingVersion }}</p>
            </div>
            <span class="status-badge" :style="drStatus(r.status).color">{{ drStatus(r.status).label }}</span>
          </div>
          <p class="text-sm text-nec-gray mt-2 line-clamp-2">{{ r.designNotes }}</p>
          <div class="mt-3 flex gap-3 text-xs items-center">
            <span class="text-nec-gray">负责人：<span class="mono">{{ r.designerId }}</span></span>
            <a v-if="r.meetingLink" :href="r.meetingLink" target="_blank" class="link hover:underline" @click.stop>会议链接 →</a>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
