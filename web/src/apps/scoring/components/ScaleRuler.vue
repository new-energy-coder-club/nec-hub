<script setup lang="ts">
// 02 评分标尺（纯 DOM + 手绘定位指针）
import { SCALE_MILESTONES, BEST } from '../data'

const ticks = Array.from({ length: 11 }, (_, i) => i * 10)
</script>

<template>
  <section class="nec-card p-5">
    <div class="mb-4">
      <h2 class="text-lg font-bold text-nec-ink">10 分制评分标尺</h2>
      <p class="mono text-xs text-nec-gray tracking-wider">SCORING SCALE</p>
    </div>
    <div class="relative select-none">
      <div class="relative" style="height:76px">
        <div
          v-for="m in SCALE_MILESTONES"
          :key="m.score"
          :style="{ position: 'absolute', left: m.score * 10 + '%', transform: 'translateX(-50%)', top: '-6px' }"
          class="flex flex-col items-center"
        >
          <div
            :style="{
              width: '0', height: '0',
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '9px solid ' + (m.current ? 'var(--nec-cyan)' : 'var(--nec-navy)'),
            }"
          ></div>
          <span
            class="mono text-[10px] mt-1 font-bold"
            :style="{ color: m.current ? 'var(--nec-cyan)' : 'var(--nec-navy)' }"
          >{{ m.score.toFixed(1) }}</span>
        </div>
        <div
          class="absolute left-0 right-0"
          style="top:44px;height:6px;border-radius:3px;background:linear-gradient(90deg,var(--nec-line) 0%,var(--nec-cyan) 93%,var(--nec-ink) 100%)"
        ></div>
        <div
          :style="{
            position: 'absolute', top: '38px', height: '18px', width: '3px', borderRadius: '2px',
            background: 'var(--nec-cyan)', left: BEST.score * 10 + '%', transform: 'translateX(-50%)',
            boxShadow: '0 0 0 4px rgba(31,169,232,.25)',
          }"
        ></div>
        <div class="relative" style="top:52px">
          <div
            v-for="t in ticks"
            :key="t"
            class="flex flex-col items-center"
            :style="{ position: 'absolute', left: t + '%', transform: 'translateX(-50%)' }"
          >
            <div class="scale-tick major"></div>
            <span class="mono text-[10px] text-nec-gray mt-1">{{ (t / 10).toFixed(0) }}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2">
      <div
        v-for="m in SCALE_MILESTONES"
        :key="m.score"
        class="rounded-lg p-3"
        :style="{ border: '1px solid var(--nec-line)', background: m.current ? 'var(--nec-royal-100)' : 'var(--nec-fog)' }"
      >
        <p class="mono text-sm font-black" :style="{ color: m.current ? 'var(--nec-cyan)' : 'var(--nec-navy)' }">
          {{ m.score.toFixed(1) }} {{ m.current ? '◀ 当前' : '' }}
        </p>
        <p class="text-sm font-bold text-nec-ink">{{ m.grade }}</p>
        <p class="text-xs text-nec-gray mt-0.5">{{ m.note }}</p>
      </div>
    </div>
  </section>
</template>
