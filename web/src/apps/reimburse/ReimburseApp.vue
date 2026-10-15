<script setup lang="ts">
// 报销助手（ERP 费用报销单）：独立页（/apps/reimburse/）与门户「报销」Tab 共用本视图
// embedded：隐藏顶栏、工具栏贴顶（原 ?embedded=1 / iframe 嵌入语义）
// skipAuthBoot：门户内复用时登录态由门户统一引导（portal/main.ts 已 bootAuth），本子应用不再重复兑换 OAuth code
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { auth, bootAuth, startLogin } from '@shared/auth'
import { store, restoreDraft, loadErpMeta, loadMine, recognizeFile, today } from './store'
import TopBar from './components/TopBar.vue'
import Toolbar from './components/Toolbar.vue'
import BasicInfo from './components/BasicInfo.vue'
import LinesTable from './components/LinesTable.vue'
import PayeeSection from './components/PayeeSection.vue'
import AttachSection from './components/AttachSection.vue'
import SopSection from './components/SopSection.vue'
import MineList from './components/MineList.vue'
import CatModal from './components/CatModal.vue'
import FlowModal from './components/FlowModal.vue'
import AttachModal from './components/AttachModal.vue'
import DocModal from './components/DocModal.vue'
import './erp.css'

const props = withDefaults(defineProps<{ embedded?: boolean; skipAuthBoot?: boolean }>(), { embedded: false, skipAuthBoot: false })
const emit = defineEmits<{ (e: 'exit'): void }>()

const authed = computed(() => !!(auth.me.authenticated && auth.me.user))
const creatorTime = ref('—')

function onAuthed() {
  creatorTime.value = new Date().toLocaleString('zh-CN')
  loadErpMeta()
  loadMine()
}

function onLoginClick() {
  if (!auth.config.loginEnabled) { alert('中台未配置飞书应用，请联系管理员'); return }
  startLogin()
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
  if (authed.value) onAuthed()
})
onBeforeUnmount(() => document.removeEventListener('paste', onPaste))

watch(authed, now => { if (now) onAuthed() })
</script>

<template>
  <div class="nec-erp">
    <!-- ERP 顶栏（embedded 隐藏） -->
    <TopBar v-if="!embedded" />

    <!-- ERP 工具栏 -->
    <Toolbar :embedded="embedded" @exit="emit('exit')" />

    <main class="max-w-6xl mx-auto px-4 py-4 space-y-4">
      <!-- 登录门禁 -->
      <section v-if="!authed" id="login-gate" class="erp-section">
        <div class="body flex flex-col sm:flex-row sm:items-center gap-4">
          <div class="text-3xl">🔐</div>
          <div class="flex-1">
            <h2 class="font-bold text-nec-ink">登录后使用报销助手</h2>
            <p class="text-sm text-nec-gray mt-1">使用飞书账号登录 NEC 中台。发票识别全程在浏览器本地完成，凭证文件仅存入团队 R2 存档。</p>
          </div>
          <button id="login-btn" class="tool-btn primary" @click="onLoginClick">飞书登录</button>
        </div>
      </section>

      <div v-else id="app-body" class="space-y-4">
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
      </div>
    </main>

    <CatModal />
    <FlowModal />
    <AttachModal />
    <DocModal />
  </div>
</template>
