<script setup lang="ts">
// KV Hero：蓝图 × 破晓（embedded 模式不渲染，对应原 ?embedded=1 隐藏 app-header）
</script>

<template>
  <header id="app-header" class="hero">
    <div class="max-w-5xl mx-auto px-4 sm:px-6 pt-5 sm:pt-6 pb-8 sm:pb-12 relative">
      <div class="flex items-center justify-between gap-3 relative z-10">
        <div class="flex items-center gap-3">
          <img src="/brand/nec-logo.svg" alt="NEC" class="h-8 w-auto" />
          <div class="leading-tight">
            <div class="font-black text-base text-nec-navy">常州工NEC <span class="text-sm font-extrabold text-nec-cyan">in CIT</span></div>
            <div class="mono text-[11px] text-nec-gray tracking-wider">newenergycoder.club</div>
          </div>
        </div>
        <a href="/" class="text-xs text-nec-gray hover:text-nec-navy">← 返回中台门户</a>
      </div>

      <div class="mt-8 relative z-10">
        <p class="mono text-xs tracking-[.22em] mb-3 text-nec-navy"><b>NEC HUB</b> · G-02 · 审批与通知中心</p>
        <h1 class="hero-title text-3xl sm:text-5xl">合规<span class="accent">申请</span></h1>
        <p class="mono mt-3 text-xs text-nec-gray tracking-widest">对外发布 / 商务合作 / 授权使用先过审再发布 · 驳回原因标准化可统计</p>
        <div class="mt-5 flex flex-wrap gap-2 text-sm">
 <span class="mono px-3 py-1 rounded-sm bg-white text-nec-navy border-[1.5px] border-nec-navy"><i class="not-italic mr-1 text-nec-cyan">01</i>提交申请</span>
 <span class="mono px-3 py-1 rounded-sm bg-white text-nec-navy border-[1.5px] border-nec-navy"><i class="not-italic mr-1 text-nec-cyan">02</i>待我审批</span>
 <span class="mono px-3 py-1 rounded-sm bg-white text-nec-navy border-[1.5px] border-nec-navy"><i class="not-italic mr-1 text-nec-cyan">03</i>我的申请</span>
 <span class="mono px-3 py-1 rounded-sm bg-white text-nec-navy border-[1.5px] border-nec-navy"><i class="not-italic mr-1 text-nec-cyan">04</i>回填发布链接</span>
        </div>
      </div>

      <!-- 破晓太阳 -->
      <svg class="absolute -right-6 sm:right-8 top-16 w-28 sm:w-44 opacity-40 sm:opacity-90 z-0 pointer-events-none" viewBox="0 0 800 800" fill="none" aria-hidden="true">
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
