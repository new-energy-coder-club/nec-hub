<script setup lang="ts">
// ERP 顶栏：品牌 + 面包屑 + 登录用户（embedded 模式整体隐藏）
import { auth } from '@shared/auth'
</script>

<template>
  <div id="app-topbar" class="erp-topbar">
    <div class="max-w-6xl mx-auto px-4 h-12 flex items-center gap-3">
      <img src="/brand/nec-logo.svg" alt="NEC" class="h-6 w-auto" />
      <span class="font-black text-sm">NEC 中台</span>
      <span class="text-white/30">|</span>
      <nav class="erp-breadcrumb text-xs">
        <a href="/">门户首页</a>
        <span class="mx-1 text-white/40">/</span>
        <span class="text-white/80">财务报销</span>
        <span class="mx-1 text-white/40">/</span>
        <span class="text-white font-semibold">费用报销单</span>
      </nav>
      <span id="topbar-user" class="ml-auto text-xs text-white/70">{{ auth.me.user ? auth.me.user.name + (auth.me.user.group ? ' · ' + auth.me.user.group : '') : '' }}</span>
    </div>
  </div>
</template>
