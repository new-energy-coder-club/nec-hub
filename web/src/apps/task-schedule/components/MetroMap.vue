<script setup lang="ts">
// 地铁线路图面板：量取任务行 DOM 坐标绘制 SVG 线路与站点（算法逐行对齐原版 renderMap）
// 站点/线路位置依赖列表布局，故由父组件在渲染后通过 expose 的 redraw(listEl) 触发重绘
import { ref } from 'vue'
import type { TaskItem, TaskLine } from '../store'
import { lineOf } from '../store'

const props = defineProps<{ lines: TaskLine[]; tasks: TaskItem[] }>()
const emit = defineEmits<{ (e: 'collapse'): void; (e: 'select', id: string): void }>()

interface Pt { x: number; y: number }
interface PathItem { d: string; color: string }
interface Stop { id: string; x: number; y: number; done: boolean; color: string; title: string }

const panelRef = ref<HTMLElement | null>(null)
const panelWidth = ref(132)
const svgWidth = ref(132)
const svgHeight = ref(120)
const paths = ref<PathItem[]>([])
const stops = ref<Stop[]>([])

function redraw(listEl: HTMLElement | null) {
  const panel = panelRef.value
  paths.value = []
  stops.value = []
  if (!panel) return

  const rows = listEl ? Array.from(listEl.querySelectorAll<HTMLElement>('.task-row')) : []
  if (!rows.length) { svgHeight.value = 120; return }

  const listRect = (listEl as HTMLElement).getBoundingClientRect()
  const panelRect = panel.getBoundingClientRect()
  const top0 = listRect.top - panelRect.top

  const laneX = (id: string) => {
    const i = Math.max(0, props.lines.findIndex(l => l.id === id))
    return 42 + i * 27
  }
  const maxLane = 42 + Math.max(0, props.lines.length - 1) * 27
  panelWidth.value = Math.max(96, maxLane + 34)
  svgWidth.value = Math.max(96, maxLane + 34)

  const pts = rows.map(el => {
    const r = el.getBoundingClientRect()
    const t = props.tasks.find(x => x.id === el.dataset.id)
    return t ? { task: t, x: laneX(t.line), y: top0 + (r.top - listRect.top) + r.height / 2 } : null
  }).filter((s): s is { task: TaskItem } & Pt => !!s)

  const H = top0 + listRect.height
  svgHeight.value = Math.max(120, H)

  // 每条线路：按任务顺序连接站点，转角处用圆弧；
  // 非首条线路从主干车道以弧线分出，形成支线效果
  const trunkX = laneX(props.lines[0].id)
  const newPaths: PathItem[] = []
  props.lines.forEach((line, li) => {
    const lp: Pt[] = pts.filter(s => s.task.line === line.id).map(s => ({ x: s.x, y: s.y }))
    if (lp.length < 1) return
    if (li > 0 && lp[0].x !== trunkX) lp.unshift({ x: trunkX, y: lp[0].y })
    if (lp.length === 1) {
      // 单点也要画一小段竖线
      newPaths.push({ d: `M ${lp[0].x} ${lp[0].y - 18} L ${lp[0].x} ${lp[0].y + 18}`, color: line.color })
      return
    }
    let d = `M ${lp[0].x} ${lp[0].y}`
    for (let i = 1; i < lp.length; i++) {
      const a = lp[i - 1], b = lp[i]
      if (a.x === b.x) {
        d += ` L ${b.x} ${b.y}`
      } else {
        const dir = Math.sign(b.x - a.x)
        const R = Math.min(22, Math.abs(b.y - a.y) / 2, Math.abs(b.x - a.x))
        d += ` L ${a.x} ${b.y - R}`
        d += ` Q ${a.x} ${b.y} ${a.x + dir * R} ${b.y}`
        d += ` L ${b.x} ${b.y}`
      }
    }
    newPaths.push({ d, color: line.color })
  })
  paths.value = newPaths

  // 站点圆点
  stops.value = pts.map(s => ({
    id: s.task.id, x: s.x, y: s.y,
    done: s.task.done, color: lineOf(s.task.line).color, title: s.task.title,
  }))
}

defineExpose({ redraw })
</script>

<template>
  <div ref="panelRef"
    class="relative flex-none border border-neutral-800 rounded-2xl overflow-hidden transition-all duration-300"
    :style="{ width: panelWidth + 'px' }">
    <div class="absolute inset-0 overflow-hidden">
      <svg class="block" :width="svgWidth" :height="svgHeight" :style="{ height: svgHeight + 'px' }" xmlns="http://www.w3.org/2000/svg">
        <path v-for="(p, i) in paths" :key="'p' + i" :d="p.d" :stroke="p.color" stroke-width="4" stroke-linecap="round" fill="none" />
        <circle v-for="s in stops" :key="s.id"
          :cx="s.x" :cy="s.y" r="8"
          :fill="s.done ? s.color : '#000'" :stroke="s.color" stroke-width="3.5"
          class="map-stop" @click="emit('select', s.id)">
          <title>{{ s.title }}</title>
        </circle>
      </svg>
    </div>
    <button title="收起线路图"
      class="absolute left-0 top-1/2 -translate-y-1/2 text-neutral-600 hover:text-white transition p-1"
      @click="emit('collapse')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
    </button>
  </div>
</template>
