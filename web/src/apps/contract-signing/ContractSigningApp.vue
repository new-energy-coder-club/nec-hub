<script setup lang="ts">
// 协议签署 OA 审批（/apps/contract-signing/）：独立页与门户 Tab 复用本视图
// embedded：隐藏 Hero、改用紧凑导航（原 ?embedded=1 / iframe 嵌入语义）
// 列表为主视图；「＋ 提交审批单」打开 SubmitForm 抽屉（≥768px 右滑 560px + 遮罩，<768px 全屏层）
import { ref, onMounted } from 'vue'
import { store, router, loadCurrentUser, probeConfig, openSubmit, markHighlight } from './store'
import ApprovalList from './components/ApprovalList.vue'
import SubmitForm from './components/SubmitForm.vue'
import ApprovalDetail from './components/ApprovalDetail.vue'
import './app.css'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const submitFormRef = ref<InstanceType<typeof SubmitForm> | null>(null)

/** 提交成功：关抽屉、回到列表、刷新并置顶高亮新单 3 秒 */
function onSubmitted(approvalId: string) {
  store.drawerOpen = false
  store.view = 'list'
  markHighlight(approvalId)
  store.listTick++
}

/** 遮罩 / × 关闭：表单有改动时确认（SubmitForm.confirmClose 暴露，异步内联确认框） */
async function onDrawerCloseRequest() {
  const ok = submitFormRef.value ? await submitFormRef.value.confirmClose() : true
  if (ok) store.drawerOpen = false
}

onMounted(async () => {
  await loadCurrentUser()
  await probeConfig()
})
</script>

<template>
  <div class="nec-cs min-h-screen" :class="{ embedded: props.embedded }">
    <!-- KV Hero：蓝图 × 破晓（embedded 模式隐藏） -->
    <header v-if="!embedded" id="app-header" class="hero">
      <div class="max-w-5xl mx-auto px-4 sm:px-6 pt-5 sm:pt-6 pb-6 sm:pb-8 relative">
        <div class="flex items-center gap-3 relative z-10 flex-wrap">
          <img src="/brand/nec-logo.svg" alt="NEC" class="h-8 w-auto" />
          <div class="leading-tight">
            <div class="font-black text-base text-nec-navy">常州工NEC <span class="text-sm font-extrabold text-nec-cyan">in CIT</span></div>
            <div class="mono text-[11px] text-nec-gray tracking-wider">newenergycoder.club</div>
          </div>
          <nav class="ml-auto flex gap-2">
            <a href="/" class="nav-btn mono px-3 py-2 text-sm rounded-lg">← 门户</a>
            <button class="nav-btn mono px-3 py-2 text-sm rounded-lg" :class="{ on: store.view === 'list' }" @click="router('list')">审批单</button>
            <button class="nav-btn mono px-3 py-2 text-sm rounded-lg" @click="openSubmit()">＋ 提交审批单</button>
          </nav>
        </div>

        <div class="mt-5 relative z-10">
          <p class="mono text-xs tracking-[.22em] mb-2 text-nec-navy"><b>NEC HUB</b> · 协议签署 · KEEP BUILDING</p>
          <h1 class="hero-title text-3xl sm:text-4xl">协议签署 <span class="accent">OA 审批</span></h1>
          <div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span class="flow-step done"><span class="dot">01</span><span class="lbl">提交合同</span></span>
            <span class="flow-conn" style="max-width:24px"></span>
            <span class="flow-step"><span class="dot">02</span><span class="lbl">开始审批</span></span>
            <span class="flow-conn" style="max-width:24px"></span>
            <span class="flow-step"><span class="dot">03</span><span class="lbl">会签审批</span></span>
            <span class="flow-conn" style="max-width:24px"></span>
            <span class="flow-step"><span class="dot">04</span><span class="lbl">归档</span></span>
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

    <!-- embedded 模式下的紧凑导航 -->
    <div v-else id="embed-nav" class="max-w-5xl mx-auto px-4 pt-4">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-lg font-black text-nec-ink">协议签署 OA 审批</h1>
        <nav class="flex gap-2">
          <button class="nav-btn mono px-3 py-1.5 text-sm rounded-lg" :class="{ on: store.view === 'list' }" @click="router('list')">审批单</button>
          <button class="nav-btn mono px-3 py-1.5 text-sm rounded-lg" @click="openSubmit()">＋ 提交审批单</button>
        </nav>
      </div>
    </div>

    <div class="max-w-5xl mx-auto px-4 py-6">
      <!-- 未配置提示 -->
      <div v-if="store.notConfigured" id="not-configured" class="rounded-lg p-4 mb-6" style="background:#FFF8E6;border:1px solid #F5D876">
        <p class="font-medium" style="color:#8A6D1A">流程尚未配置</p>
        <p class="text-sm" style="color:#A8892E">请联系管理员配置飞书 Base（调用 <span class="mono">POST /api/contract-approval/config</span> 设置 base 与 tables）后再使用本应用。</p>
      </div>

      <!-- 未登录提示 -->
      <div v-if="store.authFailed" id="not-authed" class="rounded-lg p-4 mb-6" style="background:#E8ECFB;border:1px solid var(--nec-line)">
        <p class="font-medium text-nec-navy">需要登录</p>
        <p class="text-sm text-nec-gray">本应用需要飞书登录态，请回到 <a href="/" class="link hover:underline">门户首页</a> 完成登录后再访问。</p>
      </div>

      <!-- 审批单列表（主视图） -->
      <section v-show="store.view === 'list'" id="view-list">
        <ApprovalList />
      </section>

      <!-- 详情视图 -->
      <section v-show="store.view === 'detail'" id="view-detail">
        <ApprovalDetail v-if="store.view === 'detail'" :key="store.detailId" :approval-id="store.detailId" />
      </section>
    </div>

    <!-- 提交审批单抽屉：≥768px 右滑 560px + 遮罩；<768px 全屏层 -->
    <template v-if="store.drawerOpen">
      <div class="cs-overlay" @click="onDrawerCloseRequest"></div>
      <aside class="cs-drawer" role="dialog" aria-modal="true" aria-label="提交审批单">
        <div class="cs-drawer-head">
          <div>
            <h2 class="text-base font-bold text-nec-ink">提交审批单</h2>
            <p class="mono text-[11px] text-nec-gray tracking-wider">CONTRACT APPROVAL SUBMISSION</p>
          </div>
          <button type="button" class="cs-drawer-x" title="关闭" @click="onDrawerCloseRequest">×</button>
        </div>
        <div class="cs-drawer-body">
          <SubmitForm ref="submitFormRef" @submitted="onSubmitted" />
        </div>
      </aside>
    </template>
  </div>
</template>