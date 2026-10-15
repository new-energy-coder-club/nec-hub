<script setup lang="ts">
// 硬件评审流程主视图：独立页（/apps/hardware-review/）与门户 iframe 嵌入共用本视图
// embedded：隐藏 KV Hero、改用紧凑导航，背景切为 paper（原 ?embedded=1 / iframe 嵌入语义）
import { onMounted, onBeforeUnmount } from 'vue'
import { store, router, initApp } from './store'
import HeroHeader from './components/HeroHeader.vue'
import SubmitForm from './components/SubmitForm.vue'
import ReviewList from './components/ReviewList.vue'
import ReviewDetail from './components/ReviewDetail.vue'
import './hr.css'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

onMounted(() => {
  if (props.embedded) document.body.style.background = 'var(--nec-paper)'
  initApp()
})
onBeforeUnmount(() => {
  if (props.embedded) document.body.style.background = ''
})
</script>

<template>
  <div class="nec-hw min-h-screen">
    <!-- KV Hero：蓝图 × 破晓（embedded 模式隐藏） -->
    <HeroHeader v-if="!embedded" />

    <!-- embedded 模式下的紧凑导航 -->
    <div v-else class="max-w-5xl mx-auto px-4 pt-4">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-lg font-black text-nec-ink">硬件评审流程</h1>
        <nav class="flex gap-2">
          <button class="nav-btn mono px-3 py-1.5 text-sm rounded-lg" :class="{ on: store.view === 'list' }" @click="router('list')">评审单</button>
          <button class="nav-btn mono px-3 py-1.5 text-sm rounded-lg" :class="{ on: store.view === 'submit' }" @click="router('submit')">提交</button>
        </nav>
      </div>
    </div>

    <div class="max-w-5xl mx-auto px-4 py-6">
      <!-- 未配置提示 -->
      <div v-if="!store.configured" class="rounded-lg p-4 mb-6" style="background:#FFF8E6;border:1px solid #F5D876">
        <p class="font-medium" style="color:#8A6D1A">流程尚未配置</p>
        <p class="text-sm" style="color:#A8892E">请先让 Agent 调用 MCP 的 <span class="mono">config_hardware_review</span> 配置 Base 表。</p>
      </div>

      <!-- 提交视图 -->
      <SubmitForm v-show="store.view === 'submit'" />

      <!-- 评审单视图（列表 / 看板 一体） -->
      <ReviewList v-show="store.view === 'list'" />

      <!-- 详情视图 -->
      <section v-show="store.view === 'detail'">
        <div class="mb-4">
          <button class="text-sm link hover:underline mono" @click="router('list')">← 返回评审单</button>
        </div>
        <ReviewDetail />
      </section>
    </div>
  </div>
</template>
