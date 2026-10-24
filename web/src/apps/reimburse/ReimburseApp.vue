<script setup lang="ts">
// 报销助手（ERP 费用报销单）：独立页（/apps/reimburse/）与门户「报销」Tab 共用本视图
// embedded：隐藏顶栏、工具栏贴顶（原 ?embedded=1 / iframe 嵌入语义）
// skipAuthBoot：门户内复用时登录态由门户统一引导（portal/main.ts 已 bootAuth），本子应用不再重复兑换 OAuth code
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { auth, bootAuth, tryStartLogin } from '@shared/auth'
import AuthToast from '@shared/ui/AuthToast.vue'
import { store, restoreDraft, loadErpMeta, loadMine, loadLedger, recognizeFile, today } from './store'
import TopBar from './components/TopBar.vue'
import Toolbar from './components/Toolbar.vue'
import BasicInfo from './components/BasicInfo.vue'
import LinesTable from './components/LinesTable.vue'
import PayeeSection from './components/PayeeSection.vue'
import AttachSection from './components/AttachSection.vue'
import SopSection from './components/SopSection.vue'
import MineList from './components/MineList.vue'
import LedgerList from './components/LedgerList.vue'
import CatModal from './components/CatModal.vue'
import FlowModal from './components/FlowModal.vue'
import AttachModal from './components/AttachModal.vue'
import DocModal from './components/DocModal.vue'
import './erp.css'

const props = withDefaults(defineProps<{ embedded?: boolean; skipAuthBoot?: boolean }>(), { embedded: false, skipAuthBoot: false })
const emit = defineEmits<{ (e: 'exit'): void }>()

const authed = computed(() => !!(auth.me.authenticated && auth.me.user))
const exchanging = computed(() => auth.phase === 'exchanging')
const creatorTime = ref('—')

function onAuthed() {
  creatorTime.value = new Date().toLocaleString('zh-CN')
  loadErpMeta()
  loadMine()
}

function onLoginClick() {
  tryStartLogin()
}

/** 视图切换：填报(默认) / 我的报销 / 单据列表；切到列表视图即拉数据（登录后） */
function switchView(v: 'form' | 'mine' | 'ledger') {
  store.view = v
  if (authed.value) {
    if (v === 'mine') loadMine()
    if (v === 'ledger') loadLedger()
  }
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// Ctrl+V 粘贴截图 → 优先填入空的发票槽（与 ERP「支持 ctrl+v 粘贴截图」一致）
function onPaste(ev: ClipboardEvent) {
  if (!authed.value) return
  const files = [...((ev.clipboardData && ev.clipboardData.files) || [])].filter(f => f.type.startsWith('image/') || f.type === 'application/pdf')
  if (!files.length) return
  recognizeFile(store.receiptFile ? 2 : 1, files[0])
}

onMounted(async () => {
  store.docDate = today()
  restoreDraft()
  document.addEventListener('paste', onPaste)
  if (!props.skipAuthBoot) await bootAuth()
  if (authed.value) {
    onAuthed()
    if (store.view === 'ledger') loadLedger()
  }
})
onBeforeUnmount(() => document.removeEventListener('paste', onPaste))

watch(authed, now => {
  if (now) {
    onAuthed()
    // 登录完成/门户注入登录态时，若已在单据列表视图则补拉台账
    if (store.view === 'ledger') loadLedger()
  }
})
</script>

<template>
  <div class="nec-erp">
    <!-- ERP 顶栏（embedded 隐藏） -->
    <TopBar v-if="!embedded" />

    <!-- 视图 Tab：费用报销单 / 我的报销 / 单据列表（与门户 TabNav 同款下划线样式） -->
    <nav class="view-tabs" aria-label="报销助手视图">
      <button class="view-tab" :class="{ on: store.view === 'form' }" @click="switchView('form')">费用报销单</button>
      <button class="view-tab" :class="{ on: store.view === 'mine' }" @click="switchView('mine')">我的报销</button>
      <button class="view-tab" :class="{ on: store.view === 'ledger' }" @click="switchView('ledger')">单据列表</button>
    </nav>

    <!-- ERP 工具栏（填报视图专属） -->
    <Toolbar v-if="store.view === 'form'" :embedded="embedded" @exit="emit('exit')" />

    <main class="max-w-6xl mx-auto px-4 py-4 space-y-4">
      <!-- 登录态确认中（启动 / OAuth 回跳兑换）：占位防门禁闪现 -->
      <section v-if="!authed && auth.phase !== 'ready'" class="erp-section">
        <div class="body flex items-center gap-3 text-sm text-nec-gray">
          <span class="inline-block w-4 h-4 border-2 border-gray-200 border-t-nec-cyan rounded-full animate-spin"></span>
          {{ auth.phase === 'exchanging' ? '飞书登录中…' : '正在确认登录态…' }}
        </div>
      </section>

      <!-- 登录门禁 -->
      <section v-else-if="!authed" id="login-gate" class="erp-section">
        <div class="body flex flex-col sm:flex-row sm:items-center gap-4">
          <div class="text-3xl">🔐</div>
          <div class="flex-1">
            <h2 class="font-bold text-nec-ink">登录后使用报销助手</h2>
            <p class="text-sm text-nec-gray mt-1">使用飞书账号登录 NEC 中台。发票识别全程在浏览器本地完成，凭证文件仅存入团队 R2 存档。</p>
          </div>
          <button id="login-btn" class="tool-btn primary" :disabled="exchanging" @click="onLoginClick">{{ exchanging ? '飞书登录中…' : '飞书登录' }}</button>
        </div>
      </section>

      <div v-else id="app-body" class="space-y-4">
        <!-- 填报视图：与既有表单一致 -->
        <template v-if="store.view === 'form'">
          <BasicInfo />
          <LinesTable />
          <PayeeSection />
          <AttachSection />
          <SopSection />
          <MineList />

          <!-- 制单信息 -->
          <details class="erp-section">
            <summary>制单信息</summary>
            <div class="body flex flex-wrap gap-x-10 gap-y-2 text-sm text-nec-gray">
              <span>创建人：<b id="creator-name" class="text-nec-ink">{{ auth.me.user?.name || '—' }}</b></span>
              <span>创建时间：<b id="creator-time" class="text-nec-ink mono text-xs">{{ creatorTime }}</b></span>
              <span>数据来源：报销助手（R-01 · 审批与通知中心 PRD V1.1 Plan B）</span>
            </div>
          </details>
        </template>

        <!-- 我的报销视图 -->
        <MineList v-else-if="store.view === 'mine'" />

        <!-- 单据列表（台账）视图 -->
        <LedgerList v-else />
      </div>
    </main>

    <CatModal />
    <FlowModal />
    <AttachModal />
    <DocModal />
    <AuthToast />
  </div>
</template>
