<script setup lang="ts">
// 机械图纸审批：独立页（/apps/drawing/）与后续门户 Tab 共用本视图
// embedded：隐藏 Hero、改用紧凑导航（原 ?embedded=1 / iframe 嵌入语义）
// skipAuthBoot：门户内复用时登录态由门户统一引导（portal/main.ts 已 bootAuth），本子应用不再重复兑换 OAuth code
import { computed, watch, onMounted } from 'vue'
import { auth, bootAuth } from '@shared/auth'
import { store, router, resetForm, loadMine } from './store'
import SubmitForm from './components/SubmitForm.vue'
import DoneView from './components/DoneView.vue'
import MineList from './components/MineList.vue'
import './drawing.css'

const props = withDefaults(defineProps<{ embedded?: boolean; skipAuthBoot?: boolean }>(), { embedded: false, skipAuthBoot: false })

const authed = computed(() => !!(auth.me.authenticated && auth.me.user))
// 非机械组提示：队长除外（与原页 /队长/ 角色判定一致）
const groupWarn = computed(() => {
  const me = auth.me.user
  return !!(me && me.group && me.group !== '机械组' && !/队长/.test(me.role || ''))
})

function onAuthed() {
  resetForm()
  loadMine()
}

onMounted(async () => {
  if (props.embedded) document.body.style.background = 'var(--nec-paper)'
  if (!props.skipAuthBoot) await bootAuth()
  if (authed.value) onAuthed()
})

watch(authed, now => { if (now) onAuthed() })
</script>

<template>
  <div class="nec-drawing" :class="{ embedded }">
    <!-- KV Hero（embedded 模式隐藏） -->
    <header v-if="!embedded" id="app-header" class="hero">
      <div class="max-w-5xl mx-auto px-4 sm:px-6 pt-5 sm:pt-6 pb-8 sm:pb-12 relative">
        <div class="flex items-center gap-3 relative z-10 flex-wrap">
          <img src="/brand/nec-logo.svg" alt="NEC" class="h-8 w-auto" />
          <div class="leading-tight">
            <div class="font-black text-base text-nec-navy">常州工NEC <span class="text-sm font-extrabold text-nec-cyan">in CIT</span></div>
            <div class="mono text-[11px] text-nec-gray tracking-wider">newenergycoder.club</div>
          </div>
          <nav class="ml-auto flex gap-2">
            <a href="/" class="nav-btn mono px-3 py-2 text-sm rounded-lg">← 门户</a>
            <button class="nav-btn mono px-3 py-2 text-sm rounded-lg" :class="{ on: store.view === 'mine' }" @click="router('mine')">我的申请</button>
            <button class="nav-btn mono px-3 py-2 text-sm rounded-lg" :class="{ on: store.view === 'submit' }" @click="router('submit')">提交图纸</button>
          </nav>
        </div>

        <div class="mt-8 relative z-10">
          <p class="mono text-xs tracking-[.22em] mb-3 text-nec-navy"><b>NEC HUB</b> · 审批中心 · KEEP BUILDING</p>
          <h1 class="hero-title text-3xl sm:text-5xl">机械图纸<span class="accent">审批</span></h1>
          <p class="mono mt-3 text-xs text-nec-gray tracking-widest">图纸不过审不进加工 · 驳回重提版本留痕 · 加工费 ≥500 自动提醒队长会签</p>
          <div class="mt-5 flex flex-wrap gap-2 text-sm">
 <span class="mono px-3 py-1 rounded-sm bg-white text-nec-navy border-[1.5px] border-nec-navy"><i class="not-italic mr-1 text-nec-cyan">01</i>提交</span>
 <span class="mono px-3 py-1 rounded-sm bg-white text-nec-navy border-[1.5px] border-nec-navy"><i class="not-italic mr-1 text-nec-cyan">02</i>组长审批</span>
 <span class="mono px-3 py-1 rounded-sm bg-white text-nec-navy border-[1.5px] border-nec-navy"><i class="not-italic mr-1 text-nec-cyan">03</i>加工</span>
 <span class="mono px-3 py-1 rounded-sm bg-white text-nec-navy border-[1.5px] border-nec-navy"><i class="not-italic mr-1 text-nec-cyan">04</i>归档</span>
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

    <!-- embedded 模式下的紧凑导航 -->
    <div v-else id="embed-nav" class="max-w-5xl mx-auto px-4 pt-4">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-lg font-black text-nec-ink">机械图纸审批</h1>
        <nav class="flex gap-2">
          <button class="nav-btn mono px-3 py-1.5 text-sm rounded-lg" :class="{ on: store.view === 'mine' }" @click="router('mine')">我的申请</button>
          <button class="nav-btn mono px-3 py-1.5 text-sm rounded-lg" :class="{ on: store.view === 'submit' }" @click="router('submit')">提交图纸</button>
        </nav>
      </div>
    </div>

    <div class="max-w-5xl mx-auto px-4 py-6">
      <!-- 未登录 -->
      <div v-if="!authed" id="not-authed" class="nec-card p-8 text-center">
        <p class="font-bold text-nec-ink mb-2">需要登录</p>
        <p class="text-sm text-nec-gray mb-4">图纸审批仅限队内成员提交，请先回门户用飞书登录。</p>
        <a href="/" class="btn-primary text-sm font-medium px-5 py-2 rounded-lg inline-block">去门户登录 →</a>
      </div>

      <!-- 非机械组提示 -->
      <div v-if="groupWarn" id="group-warn" class="rounded-lg p-4 mb-6" style="background:#FFF8E6;border:1px solid #F5D876">
        <p class="font-medium" style="color:#8A6D1A">当前账号不属于机械组</p>
        <p class="text-sm" style="color:#A8892E">图纸审批流程仅限机械组提交（队长除外），你可以浏览规则，但提交会被拒绝（403）。</p>
      </div>

      <!-- 流程未配置提示 -->
      <div v-if="store.notConfigured" id="not-configured" class="rounded-lg p-4 mb-6" style="background:#FFF8E6;border:1px solid #F5D876">
        <p class="font-medium" style="color:#8A6D1A">流程尚未配置</p>
        <p class="text-sm" style="color:#A8892E">请先让 Agent 调用 MCP 的 <span class="mono">config_flows</span> 配置 drawing 流程的底表（tableId / base）。</p>
      </div>

      <!-- 提交视图 -->
      <SubmitForm v-show="store.view === 'submit'" />

      <!-- 成功视图 -->
      <DoneView v-show="store.view === 'done'" />

      <!-- 我的申请视图（未登录时与原页一样整块清空） -->
      <MineList v-if="authed" v-show="store.view === 'mine'" />
    </div>
  </div>
</template>
