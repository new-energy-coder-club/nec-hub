<script setup lang="ts">
// 评审单视图：看板 / 列表 一体，列按 STATUS_MAP 顺序分组
import { computed } from 'vue'
import { store, router, loadReviews, statusOf, typeLabel, personLabel, STATUS_MAP, type Review } from '../store'

const boardColumns = computed(() =>
  Object.keys(STATUS_MAP).map(status => ({
    status,
    label: STATUS_MAP[status].label,
    items: store.reviews.filter((r: Review) => r.status === status),
  })),
)

function modeStyle(mode: 'board' | 'table') {
  const on = store.displayMode === mode
  return { background: on ? 'var(--nec-navy)' : 'var(--nec-paper)', color: on ? '#fff' : 'var(--nec-gray)' }
}
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
            <button id="mode-board" class="mono px-3 py-1.5" :style="modeStyle('board')" @click="store.displayMode = 'board'">看板</button>
            <button id="mode-table" class="mono px-3 py-1.5" style="border-left:1.5px solid var(--nec-line)" :style="modeStyle('table')" @click="store.displayMode = 'table'">列表</button>
          </div>
          <button class="text-sm font-medium px-2 link" @click="loadReviews()">刷新</button>
        </div>
      </div>

      <!-- 看板 -->
      <div v-show="store.displayMode === 'board'" id="dashboard" class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <p v-if="store.listState === 'loading'" class="text-sm text-nec-gray md:col-span-3 lg:col-span-4">加载中…</p>
        <div v-else-if="store.listState === 'unconfigured'" class="md:col-span-3 lg:col-span-4">
          <div class="rounded-lg p-6 text-center" style="background:var(--nec-fog);border:1px dashed var(--nec-line)">
            <p class="mono text-xs tracking-widest text-nec-cyan mb-2">WAITING FOR CONFIG</p>
            <p class="text-sm text-nec-gray">完成 Base 表配置后，评审单将在这里以看板形式流转。</p>
          </div>
        </div>
        <p v-else-if="store.listState === 'error'" class="text-sm md:col-span-3 lg:col-span-4" style="color:#C22E2E">加载失败：{{ store.listError }}</p>
        <template v-else>
          <div v-for="col in boardColumns" :key="col.status" class="rounded-lg p-3" style="background:var(--nec-fog);border:1px solid var(--nec-line)">
            <div class="flex items-center justify-between mb-3">
              <span class="text-sm font-bold text-nec-navy">{{ col.label }}</span>
              <span class="mono text-xs font-bold text-nec-cyan">{{ String(col.items.length).padStart(2, '0') }}</span>
            </div>
            <div class="space-y-2">
              <div v-for="r in col.items" :key="r.reviewId" class="rounded p-3 cursor-pointer transition-shadow hover:shadow-sm" style="background:var(--nec-paper);border:1px solid var(--nec-line)" @click="router('detail', r.reviewId)">
                <p class="text-sm font-medium text-nec-ink truncate">{{ r.hardwareName }}</p>
                <p class="mono text-xs text-nec-gray">{{ r.reviewId }}</p>
              </div>
              <p v-if="!col.items.length" class="text-xs text-nec-gray text-center py-4">无</p>
            </div>
          </div>
        </template>
      </div>

      <!-- 列表 -->
      <div v-show="store.displayMode === 'table'" id="review-list" class="space-y-3">
        <p v-if="store.listState === 'loading'" class="text-sm text-nec-gray">加载中…</p>
        <div v-else-if="store.listState === 'unconfigured'" class="rounded-lg p-6 text-center" style="background:var(--nec-fog);border:1px dashed var(--nec-line)">
          <p class="mono text-xs tracking-widest text-nec-cyan mb-2">WAITING FOR CONFIG</p>
          <p class="text-sm text-nec-gray">完成 Base 表配置后，评审单将在这里以看板形式流转。</p>
        </div>
        <p v-else-if="store.listState === 'error'" class="text-sm" style="color:#C22E2E">加载失败：{{ store.listError }}</p>
        <p v-else-if="!store.reviews.length" class="text-sm text-nec-gray">暂无评审单</p>
        <template v-else>
          <div v-for="r in store.reviews" :key="r.reviewId" class="rounded-lg p-4 cursor-pointer transition-shadow hover:shadow-md" style="border:1px solid var(--nec-line);background:var(--nec-paper)" @click="router('detail', r.reviewId)">
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
