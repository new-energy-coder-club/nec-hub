<script setup lang="ts">
// KV Hero：品牌头 + 视图导航 + 静态流程步骤条（embedded 模式整体隐藏）
import { store, router } from '../store'
</script>

<template>
  <header id="app-header" class="hero">
    <div class="max-w-5xl mx-auto px-4 sm:px-6 pt-5 sm:pt-6 pb-6 sm:pb-8 relative">
      <div class="flex items-center gap-3 relative z-10 flex-wrap">
        <img src="/brand/nec-logo.svg" alt="NEC" class="h-8 w-auto" />
        <div class="leading-tight">
          <div class="font-black text-base text-nec-navy">常州工NEC <span class="text-sm font-extrabold text-nec-cyan">in CIT</span></div>
          <div class="mono text-[11px] text-nec-gray tracking-wider">newenergycoder.club</div>
        </div>
        <nav class="ml-auto flex gap-2">
          <button class="nav-btn mono px-3 py-2 text-sm rounded-lg" :class="{ on: store.view === 'list' }" @click="router('list')">评审单</button>
          <button class="nav-btn mono px-3 py-2 text-sm rounded-lg" :class="{ on: store.view === 'submit' }" @click="router('submit')">提交</button>
        </nav>
      </div>

      <div class="mt-5 relative z-10">
        <p class="mono text-xs tracking-[.22em] mb-2 text-nec-navy"><b>NEC HUB</b> · 硬件评审 · KEEP BUILDING</p>
        <h1 class="hero-title text-3xl sm:text-4xl">硬件<span class="accent">评审</span>流程</h1>
        <div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span class="flow-step done"><span class="dot">01</span><span class="lbl">提交评审单</span></span>
          <span class="flow-conn" style="max-width:24px"></span>
          <span class="flow-step"><span class="dot">02</span><span class="lbl">预约会议</span></span>
          <span class="flow-conn" style="max-width:24px"></span>
          <span class="flow-step"><span class="dot">03</span><span class="lbl">保存纪要</span></span>
          <span class="flow-conn" style="max-width:24px"></span>
          <span class="flow-step"><span class="dot">04</span><span class="lbl">评审报告</span></span>
          <span class="flow-conn" style="max-width:24px"></span>
          <span class="flow-step"><span class="dot">05</span><span class="lbl">评估归档</span></span>
        </div>
      </div>

      <!-- 破晓太阳 -->
      <svg class="absolute -right-6 sm:right-8 top-12 w-24 sm:w-32 opacity-30 sm:opacity-50 z-0 pointer-events-none" viewBox="0 0 800 800" fill="none" aria-hidden="true">
        <defs><linearGradient id="sunG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#4FC3F7"/><stop offset="1" stop-color="#1FA9E8"/></linearGradient></defs>
        <circle cx="400" cy="400" r="330" stroke="url(#sunG)" stroke-width="10"/>
        <circle cx="400" cy="400" r="282" stroke="#1FA9E8" stroke-width="2.5" stroke-dasharray="3 14" opacity=".85"/>
        <g stroke="#141B5E" stroke-width="2"><line x1="400" y1="368" x2="400" y2="432"/><line x1="368" y1="400" x2="432" y2="400"/></g>
        <circle cx="400" cy="400" r="7" fill="#141B5E"/>
      </svg>
    </div>
    <div class="horizon"></div>
    <div class="base-line"></div>
  </header>
</template>
