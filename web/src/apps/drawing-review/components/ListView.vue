<script setup lang="ts">
// 评审单视图（看板 / 列表 一体，原 #view-list）：筛选 chip、看板分列、列表卡片与原单文件版一致
import { ref, computed, onMounted } from 'vue'
import { apiDr } from '@shared/api'
import { DR_STATUS, drStatus, type Review } from '../types'

const emit = defineEmits<{ (e: 'open', reviewId: string): void }>()

const displayMode = ref<'board' | 'table'>('board')
const drFilter = ref('')
const reviews = ref<Review[]>([])
const loading = ref(true)
const error = ref('')

const shown = computed(() => (drFilter.value ? reviews.value.filter(r => r.status === drFilter.value) : reviews.value))

// 筛选 chip：仅展示有数据的状体 + 末尾「全部」（与原 renderFilterChips 一致）
const chips = computed(() => {
  const counts: Record<string, number> = {}
  reviews.value.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1 })
  const list = Object.entries(DR_STATUS)
    .filter(([k]) => counts[k])
    .map(([k, v]) => ({ key: k, label: v.label, count: counts[k] }))
  list.push({ key: '', label: '全部', count: reviews.value.length })
  return list
})

// 看板分列：按 DR_STATUS 顺序，应用当前筛选（与原 renderBoard 一致）
const columns = computed(() => {
  const groups: Record<string, Review[]> = {}
  for (const r of reviews.value) {
    ;(groups[r.status] = groups[r.status] || []).push(r)
  }
  return Object.keys(DR_STATUS)
    .filter(status => !drFilter.value || status === drFilter.value)
    .map(status => ({ status, ...DR_STATUS[status], items: groups[status] || [] }))
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    reviews.value = await apiDr('')
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

function filterDr(status: string) { drFilter.value = status; load() }

onMounted(load)
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
          <div class="flex rounded-lg overflow-hidden text-sm" style="border:1.5px solid var(--nec-line)">
            <button id="mode-board" class="mono px-3 py-1.5"
              :style="displayMode === 'board' ? 'background:var(--nec-navy);color:#fff' : 'background:var(--nec-paper);color:var(--nec-gray)'"
              @click="displayMode = 'board'">看板</button>
            <button id="mode-table" class="mono px-3 py-1.5" style="border-left:1.5px solid var(--nec-line)"
              :style="displayMode === 'table' ? 'background:var(--nec-navy);color:#fff' : 'background:var(--nec-paper);color:var(--nec-gray)'"
              @click="displayMode = 'table'">列表</button>
          </div>
          <button class="text-sm font-medium px-2 link" @click="load">刷新</button>
        </div>
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
        <div v-for="col in columns" :key="col.status" class="rounded-lg p-3" style="background:var(--nec-fog);border:1px solid var(--nec-line)">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-bold text-nec-navy">{{ col.label }}</span>
            <span class="mono text-xs font-bold text-nec-cyan">{{ String(col.items.length).padStart(2, '0') }}</span>
          </div>
          <div class="space-y-2">
            <div v-for="r in col.items" :key="r.reviewId" class="rounded p-3 cursor-pointer transition-shadow hover:shadow-sm"
              style="background:var(--nec-paper);border:1px solid var(--nec-line)" @click="emit('open', r.reviewId)">
              <p class="text-sm font-medium text-nec-ink truncate">{{ r.machineName }}</p>
              <p class="mono text-xs text-nec-gray">{{ r.reviewId }}</p>
            </div>
            <p v-if="!col.items.length" class="text-xs text-nec-gray text-center py-4">无</p>
          </div>
        </div>
      </div>

      <div v-show="displayMode === 'table'" id="review-list" class="space-y-3">
        <p v-if="error" class="text-sm" style="color:#C22E2E">加载失败：{{ error }}</p>
        <p v-else-if="!loading && !shown.length" class="text-sm text-nec-gray">暂无评审单</p>
        <div v-for="r in shown" :key="r.reviewId" class="rounded-lg p-4 cursor-pointer transition-shadow hover:shadow-md"
          style="border:1px solid var(--nec-line);background:var(--nec-paper)" @click="emit('open', r.reviewId)">
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
