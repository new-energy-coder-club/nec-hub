<script setup lang="ts">
// 03 迭代轨迹（手绘 SVG 折线图）
import { STANDARD, REVIEWS } from '../data'

const W = 720, H = 260, PAD = { l: 56, r: 24, t: 36, b: 44 }
const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / Math.max(REVIEWS.length - 1, 1)
const y = (s: number) => PAD.t + (10 - s) * (H - PAD.t - PAD.b) / 10
const pts = REVIEWS.map((r, i) => `${x(i)},${y(r.score)}`).join(' ')
const gridScores = [6, 7, 8, 9, 10]
</script>

<template>
  <section class="nec-card p-5">
    <div class="mb-4">
      <h2 class="text-lg font-bold text-nec-ink">迭代轨迹</h2>
      <p class="mono text-xs text-nec-gray tracking-wider">ITERATION TRAJECTORY</p>
    </div>
    <div class="w-full overflow-x-auto">
      <svg :viewBox="`0 0 ${W} ${H}`" class="w-full" style="min-width:520px" role="img" aria-label="评分迭代轨迹折线图">
        <template v-for="s in gridScores" :key="s">
          <line
            :x1="PAD.l" :y1="y(s)" :x2="W - PAD.r" :y2="y(s)"
            stroke="var(--nec-line)" stroke-width="1"
            :stroke-dasharray="s % 2 ? '3 6' : undefined"
          />
          <text
            :x="PAD.l - 10" :y="y(s) + 4" text-anchor="end" font-size="11"
            fill="var(--nec-gray)" font-family="ui-monospace,Consolas,monospace"
          >{{ s }}.0</text>
        </template>
        <line :x1="PAD.l" :y1="y(6)" :x2="W - PAD.r" :y2="y(6)" stroke="var(--nec-gray)" stroke-width="1.5" />
        <polyline
          :points="pts" fill="none" stroke="var(--nec-royal)" stroke-width="2.5"
          stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="6 4"
        />
        <line
          :x1="PAD.l" :y1="y(STANDARD.targetScore)" :x2="W - PAD.r" :y2="y(STANDARD.targetScore)"
          stroke="var(--nec-cyan)" stroke-width="1.5" stroke-dasharray="8 6"
        />
        <text
          :x="W - PAD.r" :y="y(STANDARD.targetScore) - 6" text-anchor="end" font-size="11" font-weight="700"
          fill="var(--nec-cyan)" font-family="ui-monospace,Consolas,monospace"
        >终局目标 9.6</text>
        <template v-for="(r, i) in REVIEWS" :key="r.round">
          <circle
            :cx="x(i)" :cy="y(r.score)" :r="r.current ? 8 : 5.5"
            :fill="r.current ? 'var(--nec-cyan)' : 'var(--nec-navy)'"
            :stroke="r.current ? 'rgba(31,169,232,.3)' : '#fff'"
            :stroke-width="r.current ? 6 : 2"
          />
          <text
            :x="x(i)" :y="y(r.score) - 16" text-anchor="middle" font-size="13" font-weight="800"
            :fill="r.current ? 'var(--nec-cyan)' : 'var(--nec-navy)'" font-family="ui-monospace,Consolas,monospace"
          >{{ r.score.toFixed(1) }}</text>
          <text :x="x(i)" :y="H - 22" text-anchor="middle" font-size="12" font-weight="700" fill="var(--nec-ink)">{{ r.round }}</text>
          <text :x="x(i)" :y="H - 6" text-anchor="middle" font-size="10" fill="var(--nec-gray)">{{ r.stage }}</text>
        </template>
      </svg>
    </div>
    <div class="mt-3 space-y-2">
      <div v-for="r in REVIEWS" :key="r.round" class="flex items-start gap-2 text-sm">
        <span class="status-badge" :style="r.current ? 'background:#E8ECFB;color:#1A2FA0' : 'background:#EEF1F8;color:#5A6472'">{{ r.score.toFixed(1) }}</span>
        <span class="text-nec-gray"><b class="text-nec-ink">{{ r.round }}</b> · {{ r.stage }} —— {{ r.note }}</span>
      </div>
      <p class="text-xs text-nec-gray pt-1" style="border-top:1px dashed var(--nec-line)">
        注：6.0 → 9.0 之间的中间轮次（7.x / 8.x）未留存，折线仅连接已留存的三轮记录。
      </p>
    </div>
  </section>
</template>
