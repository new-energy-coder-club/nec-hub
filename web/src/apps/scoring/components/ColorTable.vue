<script setup lang="ts">
// 06 色彩规范表
import { COLOR_LEVELS } from '../data'
</script>

<template>
  <section class="nec-card p-5">
    <div class="mb-4">
      <h2 class="text-lg font-bold text-nec-ink">色彩规范（xterm-256 四级灰度）</h2>
      <p class="mono text-xs text-nec-gray tracking-wider">L1–L4 GRAYSCALE SYSTEM · L4 须比 L3 至少退后两级</p>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-sm" style="min-width:520px">
        <thead>
 <tr class="text-left mono text-xs text-nec-gray border-b-[1.5px] border-nec-line">
            <th class="py-2 pr-3">级别</th><th class="py-2 pr-3">用途</th><th class="py-2 pr-3">色号</th><th class="py-2">色块（xterm-256 近似）</th>
          </tr>
        </thead>
        <tbody>
 <tr v-for="c in COLOR_LEVELS" :key="c.level">class="border-b border-nec-line"
            <td class="py-3 pr-3 mono font-black text-nec-navy">{{ c.level }}</td>
            <td class="py-3 pr-3 text-nec-ink">{{ c.usage }}</td>
            <td class="py-3 pr-3 mono text-xs text-nec-gray">{{ c.codes.join(' / ') }}</td>
            <td class="py-3">
              <div class="flex flex-wrap gap-2">
                <span v-for="s in c.swatches" :key="s.label" class="inline-flex items-center gap-1.5">
                  <span :style="{ display: 'inline-block', width: '22px', height: '22px', borderRadius: '5px', background: s.hex, border: '1px solid var(--nec-line)' }"></span>
                  <span class="mono text-[10px] text-nec-gray">{{ s.label }}</span>
                </span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="mt-3 text-xs text-nec-gray">
        终局色彩方案（9.0→9.6 的关键一跃）：青蓝单色渐变 NEC(81) + PI5(195 极浅青 或 117 淡青)，
        消除“正常 vs 禁用”式冷暖割裂；PI5 禁用纯白 255（过曝），降级为 251 浅灰或 195 浅青；
        底线灰 238/240，与顶部线呼应形成“信封”包围感。
      </p>
    </div>
  </section>
</template>
