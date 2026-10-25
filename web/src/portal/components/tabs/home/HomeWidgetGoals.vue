<script setup lang="ts">
// 赛季目标（前 5 条 + 未配置时的接入 Prompt 引导）
// #1 进度条：数值统一归一化到 0-100 后再渲染（文案与条宽同一个 Math.round 值，保证视觉线性）
// #2 风险分级：goalRisk 与顶部告警条同口径，late 红底红条 / warn 黄底琥珀条；整行点击跳赛季目标 Tab
// #10 排序：截止日升序；已过期未完成置灰 +「已过期」灰徽章沉底
import { ref, onMounted, inject } from 'vue'
import { GOALS_CONFIG_PROMPT } from '@shared/prompts'
import { copyText } from '@shared/api'
import { fmtDashDate, goalBarColor } from '@shared/format'
import { goalRisk, goalTimeProgress } from '@portal/composables/useBanners'

const props = defineProps<{ shared: { load(name: string): Promise<any> } }>()
const noteHomeFreshness = inject<(d: any) => void>('noteHomeFreshness', () => {})
const goto = inject<(tab: string) => void>('homeGoto', () => {})

const g = ref<any>(undefined)
const items = ref<any[]>([])
const failed = ref(false)

/** 进度归一化：后端组装已归一 0-100（src/dashboard.ts），这里兜底（0-1 小数 ×100），并钳制 [0,100] */
function normPct(v: any): number {
  let p = typeof v === 'number' && isFinite(v) ? v : Number(v)
  if (!isFinite(p)) return 0
  if (p > 0 && p <= 1) p = p * 100
  return Math.min(Math.max(Math.round(p), 0), 100)
}

function riskOf(it: any): 'late' | 'warn' | 'ok' {
  if (it.done) return 'ok' // 已达标不再告警
  return goalRisk(it.deadline, it.progress)
}

/** 整行底色（与 VI 语义色一致）：late → danger 浅底；warn → warning 浅底 */
function rowClass(it: any): string {
  const r = riskOf(it)
  if (r === 'late') return 'bg-[#FBEAEA]'
  if (r === 'warn') return 'bg-[#FDEADD]'
  return 'hover:bg-gray-50/60'
}

/** 徽章：已过期（灰）优先；否则 late/warn 显示风险徽章 */
function badgeOf(it: any): { text: string; cls: string } {
  if (it.overdue && !it.done) return { text: '已过期', cls: 'bg-gray-200 text-gray-500' }
  const r = riskOf(it)
  if (r === 'late') return { text: '⚠ 风险', cls: 'bg-[#FBEAEA] text-[#C22E2E]' }
  if (r === 'warn') return { text: '⚠ 风险', cls: 'bg-[#FDEADD] text-[#B45309]' }
  return { text: '', cls: '' }
}

/**
 * 进度条颜色：late 红（--nec-danger）/ warn 琥珀（--nec-warning）/ ok 沿用 goalBarColor（逾期红、完成 navy、进行 cyan）。
 * 轨道为无 padding 的纯灰底（h-1.5 overflow-hidden），width 百分比即真实轨道占比；条自身 max-width:100% + 一个取整值。
 */
function barColor(it: any): string {
  const r = riskOf(it)
  if (r === 'late') return 'var(--nec-danger)'
  if (r === 'warn') return 'var(--nec-warning)'
  return goalBarColor(it)
}

/** 时间基准刻度位置（0-100）：与 goalRisk 同一口径（年初→截止日），null = 无截止日不画刻度 */
function timeMark(it: any): number | null {
  if (typeof it.deadline !== 'number' || !isFinite(it.deadline)) return null
  return Math.round(goalTimeProgress(it.deadline))
}

onMounted(async () => {
  try {
    const d = await props.shared.load('dashboard')
    noteHomeFreshness(d)
    g.value = d?.goals ?? null
    const all = g.value?.items ?? []
    // 截止日升序；已过期且未完成的沉到底部（#10）
    items.value = all.slice().sort((a: any, b: any) => {
      const pa = a.overdue && !a.done ? 1 : 0
      const pb = b.overdue && !b.done ? 1 : 0
      if (pa !== pb) return pa - pb
      return (a.deadline ?? Infinity) - (b.deadline ?? Infinity)
    }).slice(0, 5)
  } catch { failed.value = true }
})
</script>

<template>
  <p v-if="failed" class="text-sm text-gray-400">加载失败，请刷新重试。</p>
  <p v-else-if="g === undefined" class="text-sm text-gray-400">加载中…</p>
  <!-- 配置缺口不是用户的问题：给出可复制的接入 Prompt（与数据看板未配置引导同一模式） -->
  <template v-else-if="!g || !g.configured">
    <p class="text-sm text-gray-500 mb-2">赛季目标未配置：把下面的 Prompt 发给已接入 NEC-MCP 的 Agent 完成接入。</p>
    <pre class="prompt text-xs bg-gray-900 text-green-300 rounded-lg p-3" id="home-goals-prompt">{{ GOALS_CONFIG_PROMPT }}</pre>
    <button @click="copyText(GOALS_CONFIG_PROMPT)" class="mt-2 text-xs text-white px-3 py-1.5 rounded" style="background:var(--nec-navy)">复制 Prompt</button>
  </template>
  <p v-else-if="!items.length" class="text-sm text-gray-400">赛季目标表已配置但暂无数据：在飞书赛季目标表中添加第一条目标（含截止日期）后即可显示在这里。</p>
  <template v-else>
    <div v-for="(it, i) in items" :key="i"
         class="py-1.5 border-b border-gray-100 last:border-0 rounded-md -mx-1 px-1 cursor-pointer"
         :class="rowClass(it)" title="点击进入赛季目标 Tab" role="button" tabindex="0"
         @click="goto('season-goals')" @keydown.enter="goto('season-goals')">
      <div class="flex items-center gap-2" :class="{ 'opacity-60': it.overdue && !it.done }">
        <span v-if="badgeOf(it).text" class="text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium" :class="badgeOf(it).cls">{{ badgeOf(it).text }}</span>
        <span class="text-xs text-gray-400 mono shrink-0">{{ fmtDashDate(it.deadline) }}</span>
        <span class="flex-1 min-w-0 truncate" :class="{ 'line-through text-gray-400': it.overdue && !it.done }">{{ it.title }}</span>
        <span class="text-xs text-gray-500 mono shrink-0">{{ it.progress === null ? '—' : normPct(it.progress) + '%' }}</span>
        <span class="text-xs text-gray-300 shrink-0" aria-hidden="true">›</span>
        <a :href="it.link" target="_blank" @click.stop title="打开飞书记录" class="text-xs text-gray-300 hover:text-gray-500 shrink-0" aria-label="打开飞书记录">↗</a>
      </div>
      <div class="relative h-1.5 rounded bg-gray-100 overflow-hidden mt-1">
        <div :style="{ width: normPct(it.progress) + '%', height: '100%', maxWidth: '100%', background: barColor(it) }"></div>
        <!-- 时间基准刻度：竖线标出「年初→今天」应到的位置，条长明显短于刻度即落后来源 -->
        <div v-if="timeMark(it) !== null" class="absolute top-0 h-full w-[2px] bg-gray-500/70"
             :style="{ left: `min(${timeMark(it)}%, calc(100% - 2px))` }" title="时间基准（年初至今）"></div>
      </div>
    </div>
    <!-- 图例：口径与颜色一屏说清（与顶部告警条同一套 goalRisk 分级） -->
    <p class="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
      条＝实际进度，刻度＝时间基准（年初 → 截止日）· 红＝落后超 20%，黄＝落后超 10%，绿＝正常
    </p>
  </template>
</template>