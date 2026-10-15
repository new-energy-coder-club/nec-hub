<script setup lang="ts">
// Git 流线图面板（参考 VSCode Git Graph / GitLens 提交图）：纯前端自动布局，无第三方库
// 与 MetroMap 不同：本图用固定逻辑行高（rowH=40）按 date 排序布局，不与右侧任务行逐行对齐
// （右侧行展开后高度可变，逐行对齐在语义上不可行；图追求"提交图"的拓扑关系而非像素对齐）
import { computed } from 'vue'
import type { TaskItem, TaskLine } from '../store'
import { store, lineOf, fmtDate } from '../store'

const props = defineProps<{ lines: TaskLine[]; tasks: TaskItem[] }>()
const emit = defineEmits<{ (e: 'collapse'): void; (e: 'select', id: string): void }>()

const PANEL_INNER = 238 // 面板 240px - 左右边框
const PAD_X = 40        // 首泳道 x
const LANE_W = 20       // 泳道间距
const ROW_H = 40        // 每任务一行（逻辑行）
const HEADER_H = 8      // SVG 顶部留白
const TAIL_PAD = 20     // SVG 底部留白

interface Node { id: string; x: number; y: number; done: boolean; color: string; label: string; lineId: string }
interface LaneSegment { x: number; y1: number; y2: number; color: string }
interface FlowArc { d: string; color: string }

// 按 date 升序排序；相同 date 按列表原顺序稳定排
const rows = computed(() =>
  props.tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.date === b.t.date ? a.i - b.i : a.t.date < b.t.date ? -1 : 1)))

// 泳道按 lines 在 store.lines 中的顺序分配；未知线路回退首泳道
const laneIndex = (lineId: string) => Math.max(0, props.lines.findIndex(l => l.id === lineId))

const nodes = computed<Node[]>(() =>
  rows.value.map(({ t }, i) => ({
    id: t.id,
    x: PAD_X + laneIndex(t.line) * LANE_W,
    y: HEADER_H + i * ROW_H + ROW_H / 2,
    done: t.done,
    color: lineOf(t.line).color,
    label: `${t.title} · ${fmtDate(t.date)}`,
    lineId: t.line,
  })),
)

// 主线：每个 line 从该线首任务 y 画到末任务 y——中间被其他线路任务间隔时竖线仍穿过（连续泳道）
const laneSegments = computed<LaneSegment[]>(() => {
  const segs: LaneSegment[] = []
  props.lines.forEach(line => {
    const own = nodes.value.filter(n => n.lineId === line.id)
    if (!own.length) return
    segs.push({ x: own[0].x, y1: own[0].y, y2: own[own.length - 1].y, color: line.color })
  })
  return segs
})

// 跨线流转弧：全局时间顺序上相邻两任务换线时，画细虚线三次贝塞尔（前节点颜色 40% 透明度）
// 控制点纵坐标夹在两点之间，保证曲线单调下移；弧度随两点纵距与横距增大
const flowArcs = computed<FlowArc[]>(() => {
  const arcs: FlowArc[] = []
  for (let i = 1; i < nodes.value.length; i++) {
    const p = nodes.value[i - 1]
    const c = nodes.value[i]
    if (p.lineId === c.lineId) continue
    const dy = c.y - p.y
    const dx = Math.abs(c.x - p.x)
    const k = Math.max(6, Math.min(dy * 0.4, dx * 0.5 + 10, dy / 2))
    arcs.push({ d: `M ${p.x} ${p.y} C ${p.x} ${p.y + k}, ${c.x} ${c.y - k}, ${c.x} ${c.y}`, color: p.color })
  }
  return arcs
})

const svgHeight = computed(() => (rows.value.length ? HEADER_H + rows.value.length * ROW_H + TAIL_PAD : 0))

// done 节点空心：填充随当前主题（白底 #f6f7f9 / 黑底 #000），stroke 恒为线路色
const nodeBg = computed(() => (store.whiteBg ? '#f6f7f9' : '#000'))
</script>

<template>
  <div class="flex-none flex flex-col w-60 border border-neutral-800 rounded-2xl overflow-hidden transition-all duration-300">
    <!-- 标题行 + 折叠 -->
    <div class="flex-none flex items-center justify-between px-3 pt-2.5 pb-2">
      <span class="text-xs font-semibold text-neutral-400">Git 流线图</span>
      <button title="收起线路图"
        class="flex-none border border-neutral-800 rounded-full w-6 h-6 flex items-center justify-center text-neutral-600 hover:text-white transition"
        @click="emit('collapse')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      </button>
    </div>

    <!-- 滚动区：图例吸顶 + SVG -->
    <div class="flex-1 min-h-0 overflow-y-auto max-h-[500px]">
      <div class="gitflow-legend sticky top-0 z-10 flex flex-wrap gap-x-2.5 gap-y-1 px-3 py-1.5">
        <div v-for="l in lines" :key="l.id" class="flex items-center gap-1.5 min-w-0">
          <span class="w-2 h-2 rounded-full flex-none" :style="{ background: l.color }"></span>
          <span class="text-[11px] text-neutral-500 truncate">{{ l.name }}</span>
        </div>
      </div>

      <div v-if="!rows.length" class="py-12 text-center text-xs text-neutral-600">没有匹配的任务</div>
      <svg v-else class="block" :width="PANEL_INNER" :height="svgHeight" xmlns="http://www.w3.org/2000/svg" fill="none">
        <line v-for="(s, i) in laneSegments" :key="'l' + i"
          :x1="s.x" :y1="s.y1" :x2="s.x" :y2="s.y2"
          :stroke="s.color" stroke-width="2" stroke-opacity="0.85" />
        <path v-for="(a, i) in flowArcs" :key="'a' + i" :d="a.d"
          :stroke="a.color" stroke-width="1" stroke-opacity="0.4" stroke-dasharray="3 3" />
        <g v-for="n in nodes" :key="n.id" class="gitflow-node" @click="emit('select', n.id)">
          <circle :cx="n.x" :cy="n.y" r="7"
            :fill="n.done ? nodeBg : n.color" :stroke="n.color" stroke-width="2" />
          <path v-if="n.done" d="M -2.6 0.4 L -1 2 L 2.9 -2"
            :stroke="n.color" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          <title>{{ n.label }}</title>
        </g>
      </svg>
    </div>
  </div>
</template>