<script setup lang="ts">
// 合规申请（G-02 · 审批与通知中心）：独立页（/apps/compliance/）与门户「合规申请」Tab 共用本视图
// embedded：隐藏 Hero、改用紧凑导航、body 底色换 paper（原 ?embedded=1 / iframe 嵌入语义）
// skipAuthBoot：门户内复用时登录态由门户统一引导（portal/main.ts 已 bootAuth），本子应用不再重复兑换 OAuth code
import { computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { auth, bootAuth, startLogin } from '@shared/auth'
import { loadMine, loadTodos } from './store'
import HeroHeader from './components/HeroHeader.vue'
import SubmitForm from './components/SubmitForm.vue'
import TodoList from './components/TodoList.vue'
import MineList from './components/MineList.vue'
import './compliance.css'

const props = withDefaults(defineProps<{ embedded?: boolean; skipAuthBoot?: boolean }>(), { embedded: false, skipAuthBoot: false })

const authed = computed(() => !!(auth.me && auth.me.authenticated))

function onAuthed() {
  loadMine()
  loadTodos()
}

function onLoginClick() {
  if (!auth.config.loginEnabled) { alert('中台未配置飞书应用，请联系管理员'); return }
  startLogin()
}

onMounted(async () => {
  if (props.embedded) document.body.style.background = 'var(--nec-paper)'
  if (!props.skipAuthBoot) await bootAuth()
  if (authed.value) onAuthed()
})
onBeforeUnmount(() => { document.body.style.background = '' })

watch(authed, now => { if (now) onAuthed() })
</script>

<template>
  <div>
    <!-- KV Hero：蓝图 × 破晓（embedded 模式隐藏） -->
    <HeroHeader v-if="!embedded" />

    <!-- embedded 模式下的紧凑导航 -->
    <div v-else id="embed-nav" class="max-w-5xl mx-auto px-4 pt-4">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-lg font-black text-nec-ink">合规申请</h1>
        <span class="mono text-xs text-nec-gray">G-02 · NEC HUB</span>
      </div>
    </div>

    <main class="max-w-5xl mx-auto px-4 py-6 space-y-6">

      <!-- 登录门禁 -->
      <section v-if="!authed" id="login-gate" class="nec-card p-6">
        <div class="flex flex-col sm:flex-row sm:items-center gap-4">
          <div class="text-3xl">🔐</div>
          <div class="flex-1">
            <h2 class="font-bold text-nec-ink">登录后使用合规申请</h2>
            <p class="text-sm text-nec-gray mt-1">使用飞书账号登录 NEC 中台。对外发布、商务合作、授权使用等内容须过审后才可发布。</p>
          </div>
          <button id="login-btn" class="btn-primary whitespace-nowrap" @click="onLoginClick">飞书登录</button>
        </div>
      </section>

      <!-- 主体（登录后可见） -->
      <div v-else id="app-body" class="space-y-6">
        <SubmitForm />
        <TodoList />
        <MineList />
      </div>

      <!-- 页脚 -->
      <footer class="nec-card p-5" style="border-top:3px solid var(--nec-cyan)">
        <p class="text-xs text-nec-gray leading-relaxed">
          合规申请 G-02 · 审批与通知中心（PRD V1.1 Plan B）：对外发布、商务合作、授权使用等内容须过审后才可发布；
          驳回原因标准化（5 个固定选项）便于统计复盘；通过后由申请人回填发布链接，状态流转为「已发布」留档。
        </p>
      </footer>
    </main>
  </div>
</template>
