<script setup lang="ts">
// NEC 评分看板（ASPIEC-DCB）：独立页（/apps/scoring/）与门户 iframe 嵌入共用本视图
// embedded：隐藏 Hero、改用紧凑导航、底色换为 --nec-paper（原 ?embedded=1 / iframe 嵌入语义）
import { onMounted } from 'vue'
import { STANDARD, GOV_BADGES } from './data'
import StatsGrid from './components/StatsGrid.vue'
import ScaleRuler from './components/ScaleRuler.vue'
import TrajectoryChart from './components/TrajectoryChart.vue'
import DimensionGrid from './components/DimensionGrid.vue'
import ReviewFlow from './components/ReviewFlow.vue'
import ColorTable from './components/ColorTable.vue'
import HotfixList from './components/HotfixList.vue'
import './scoring.css'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

onMounted(() => {
  if (props.embedded) document.body.style.background = 'var(--nec-paper)'
})
</script>

<template>
  <div class="nec-scoring min-h-screen">
    <!-- KV Hero：蓝图 × 破晓（embedded 模式隐藏） -->
    <header v-if="!embedded" class="hero">
      <div class="max-w-5xl mx-auto px-4 sm:px-6 pt-5 sm:pt-6 pb-8 sm:pb-12 relative">
        <div class="flex items-center gap-3 relative z-10">
          <img src="/brand/nec-logo.svg" alt="NEC" class="h-8 w-auto" />
          <div class="leading-tight">
            <div class="font-black text-base text-nec-navy">常州工NEC <span class="text-sm font-extrabold text-nec-cyan">in CIT</span></div>
            <div class="mono text-[11px] text-nec-gray tracking-wider">newenergycoder.club</div>
          </div>
        </div>

        <div class="mt-8 relative z-10">
          <p class="mono text-xs tracking-[.22em] mb-3 text-nec-navy"><b>NEC HUB</b> · 评分看板 · ASPIEC-DCB</p>
          <h1 class="hero-title text-3xl sm:text-5xl">NEC <span class="accent">评分</span>看板</h1>
          <p class="mono mt-3 text-xs text-nec-gray tracking-widest">ASPIEC-DCB v0.1.0 · A416::REVIEW 模式 · 终端视觉合规标准</p>
          <div class="mt-5 flex flex-wrap gap-2 text-sm">
 <span class="mono px-3 py-1 rounded-sm bg-white text-nec-navy border-[1.5px] border-nec-navy"><i class="not-italic mr-1 text-nec-cyan">01</i>诊断</span>
 <span class="mono px-3 py-1 rounded-sm bg-white text-nec-navy border-[1.5px] border-nec-navy"><i class="not-italic mr-1 text-nec-cyan">02</i>方案</span>
 <span class="mono px-3 py-1 rounded-sm bg-white text-nec-navy border-[1.5px] border-nec-navy"><i class="not-italic mr-1 text-nec-cyan">03</i>Hotfix</span>
 <span class="mono px-3 py-1 rounded-sm bg-white text-nec-navy border-[1.5px] border-nec-navy"><i class="not-italic mr-1 text-nec-cyan">04</i>归档</span>
          </div>
        </div>

        <!-- 破晓太阳 -->
        <svg class="absolute -right-6 sm:right-8 top-16 w-28 sm:w-44 opacity-40 sm:opacity-90 z-0 pointer-events-none" viewBox="0 0 800 800" fill="none" aria-hidden="true">
          <defs><linearGradient id="sunG" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#4FC3F7" /><stop offset="1" stop-color="#1FA9E8" /></linearGradient></defs>
          <circle cx="400" cy="400" r="330" stroke="url(#sunG)" stroke-width="10" />
          <circle cx="400" cy="400" r="282" stroke="#1FA9E8" stroke-width="2.5" stroke-dasharray="3 14" opacity=".85" />
          <g stroke="#141B5E" stroke-width="2"><line x1="400" y1="368" x2="400" y2="432" /><line x1="368" y1="400" x2="432" y2="400" /></g>
          <circle cx="400" cy="400" r="7" fill="#141B5E" />
        </svg>
      </div>
      <div class="horizon"></div>
      <div class="base-line"></div>
    </header>

    <!-- embedded 模式下的紧凑导航 -->
    <div v-else class="max-w-5xl mx-auto px-4 pt-4">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-lg font-black text-nec-ink">NEC 评分看板</h1>
        <span class="mono text-xs text-nec-gray">ASPIEC-DCB v0.1.0</span>
      </div>
    </div>

    <main class="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <!-- 01 总览 stat 卡 -->
      <StatsGrid />

      <!-- 02 评分标尺 -->
      <ScaleRuler />

      <!-- 03 迭代轨迹 -->
      <TrajectoryChart />

      <!-- 04 六大评分维度 -->
      <DimensionGrid />

      <!-- 05 A416::REVIEW 评审流程 -->
      <ReviewFlow />

      <!-- 06 色彩规范 -->
      <ColorTable />

      <!-- 07 Hotfix 执行范式 -->
      <HotfixList />

      <!-- 08 页脚：治理徽章 + 认证签名 -->
 <footer class="nec-card p-5 border-t-[3px] border-nec-cyan">
        <div class="flex flex-wrap gap-2">
          <span v-for="b in GOV_BADGES" :key="b" class="gov-badge">{{ b }}</span>
        </div>
        <p class="mono mt-4 text-sm text-nec-navy">{{ STANDARD.signature }}</p>
        <p class="mt-2 text-xs text-nec-gray leading-relaxed">
          数据来源：本看板内容复原自 NEC-Pi5 备份（<span class="mono">darrenpig/.bash_history</span> 第 60–247 行）
          中一次终端启动横幅的多轮 AI 设计评审会话。A416 / DCB / ASPIEC 的英文全称未在备份片段中给出，
          现行用法为社区约定俗成的内部标准。备份中无原始横幅成品代码，6.0 → 9.0 之间的中间轮次（7.x / 8.x）未留存。
          数据截至 2026-10-14：已全量检索近 3 个月本机 openClaw / Kimi Code 会话日志，确认无新增评审轮次，9.3 仍为最高记录。
        </p>
 <div class="mt-4 pt-3 flex flex-wrap gap-2 border-t border-dashed border-nec-line">
          <span class="gov-badge">AUTH=宿主设备 PI5</span>
          <span class="gov-badge">MGMT=管理面 CLAW/openClaw</span>
          <span class="gov-badge">STD=遵循标准 ASPIEC</span>
          <span class="gov-badge">DCB=标准运行状态 ACTIVE</span>
        </div>
      </footer>
    </main>
  </div>
</template>
