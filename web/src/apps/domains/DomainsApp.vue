<script setup lang="ts">
// 域名分发系统：独立页（/apps/domains/）与门户 Tab 共用本视图
// embedded：隐藏页头（?embedded=1 / iframe 嵌入语义，供门户复用）
// skipAuthBoot：门户内复用时登录态由门户统一引导（portal/main.ts 已 bootAuth），本子应用不再重复 whoami 门禁跳转
import { computed, onMounted, watch } from 'vue'
import { auth } from '@shared/auth'
import { store, boot, loadMine, loadPublic } from './store'
import ClaimForm from './components/ClaimForm.vue'
import DomainTable from './components/DomainTable.vue'
import './domains.css'

const props = withDefaults(defineProps<{ embedded?: boolean; skipAuthBoot?: boolean }>(), { embedded: false, skipAuthBoot: false })

const authed = computed(() => !!(auth.me.authenticated && auth.me.user))
const whoami = computed(() => {
  const u = props.skipAuthBoot ? auth.me.user : store.me
  return u ? u.name + (u.role ? ' · ' + u.role : '') : ''
})

function loadAll() { void Promise.all([loadMine(), loadPublic()]) }

onMounted(() => {
  if (props.skipAuthBoot) { if (authed.value) loadAll() }
  else void boot()
})
watch(authed, now => { if (now && props.skipAuthBoot) loadAll() })
</script>

<template>
  <div class="nec-domains min-h-screen">
    <div class="max-w-5xl mx-auto px-4 py-6">
      <!-- 页头（embedded 隐藏） -->
      <header v-if="!embedded" class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 class="text-xl font-black text-slate-800">NEC 域名分发系统</h1>
            <p class="text-xs text-gray-500 mono">$ nec domain claim &lt;name&gt; — 自助申请 <span id="zone-label" class="font-semibold">*.{{ store.zone }}</span> 三级域名，绑定你自己的部署</p>
          </div>
          <div class="flex items-center gap-3 text-xs text-gray-500">
            <a href="/" class="hover:text-slate-800 underline">← 返回门户</a>
            <span id="whoami">{{ whoami }}</span>
          </div>
        </div>
      </header>

      <div v-if="!store.syncEnabled" id="tip-sync" class="mb-6 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3">
        Cloudflare 凭证尚未配置，新申请会先存为「待同步」，管理员配置后自动生效。
      </div>

      <!-- 申请表单 -->
      <section class="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6 fade-in">
        <ClaimForm />
      </section>

      <!-- 我的域名 -->
      <section class="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6 fade-in">
        <h2 class="font-bold text-slate-800 mb-3">我的域名</h2>
        <div id="mine-list" class="text-sm text-gray-400">
          <DomainTable :rows="store.mine" :mine="true" :loading="store.mineLoading" />
        </div>
      </section>

      <!-- 公开目录 -->
      <section class="bg-white rounded-xl shadow-sm border border-gray-200 p-5 fade-in">
        <h2 class="font-bold text-slate-800 mb-3">域名目录（已生效）</h2>
        <div id="public-list" class="text-sm text-gray-400">
          <DomainTable :rows="store.publicList" :mine="false" :loading="store.publicLoading" />
        </div>
      </section>
    </div>

    <div id="toast" v-show="store.toast.visible"
      class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm text-white shadow-lg"
      :class="store.toast.ok ? 'bg-green-600' : 'bg-red-600'">{{ store.toast.msg }}</div>
  </div>
</template>
