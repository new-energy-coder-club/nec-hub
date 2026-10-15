<script setup lang="ts">
// CLA 签署页（/apps/cla-sign/）：协议终端 + 签署表单 + PDF 证书 + 荣誉榜
// embedded：隐藏页头（原 ?embedded=1 门户 iframe 嵌入语义；页尾与原页面一致始终保留）
import { onMounted, ref } from 'vue'
import { esc } from '@shared/format'
import { fetchJson } from '@shared/api'
import { store, loadSigners } from './store'
import AgreementTerminal from './components/AgreementTerminal.vue'
import SignForm from './components/SignForm.vue'
import SignedPanel from './components/SignedPanel.vue'
import SignerList from './components/SignerList.vue'
import './cla-sign.css'

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const whoamiHtml = ref('')
const prefillName = ref('')

// 登录态：已登录则预填姓名、检查是否已签署（与原页面一致，仅拉取 /api/whoami，不做 OAuth code 兑换）
async function bootWhoami() {
  try {
    const d = await fetchJson('/api/whoami')
    if (d.authenticated && d.user) {
      whoamiHtml.value = `已登录：<b class="text-slate-700">${esc(d.user.name)}</b>（签署将绑定飞书身份）`
      prefillName.value = d.user.name
      const st = await fetchJson('/api/cla/status')
      if (st.signed) {
        store.currentSig = st.signature
        store.alreadySigned = true
      }
    } else {
      whoamiHtml.value = '未登录 · <a class="text-sky-600 underline" href="/">去门户登录</a>（可不登录直接签署）'
    }
  } catch { /* 与原页面一致：whoami 失败静默 */ }
}

onMounted(() => {
  bootWhoami()
  loadSigners()
})
</script>

<template>
  <div class="max-w-5xl mx-auto px-4 py-6">
    <header v-if="!embedded" class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div class="flex items-center gap-4 min-w-0">
          <img src="/brand/nec-lockup-h.svg" alt="NEC 常州工学院 NEC 战队" class="h-11 w-auto shrink-0" />
          <div class="border-l pl-4 min-w-0" style="border-color: var(--nec-line);">
            <h1 class="text-lg font-black text-slate-800">开源社区贡献协议签署</h1>
            <p class="text-xs text-gray-500 mono truncate">$ nec cla sign — 签署 CLA 后，你的贡献才会被合入官方仓库</p>
          </div>
        </div>
        <div class="text-xs text-gray-500 shrink-0" v-html="whoamiHtml"></div>
      </div>
      <div class="nec-horizon-fade mt-3 rounded-full"></div>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <!-- 协议正文（终端） -->
      <AgreementTerminal />

      <!-- 签署表单 -->
      <SignForm :prefill-name="prefillName" />
    </div>

    <!-- 签署成功 / 已签署：PDF 下载 -->
    <SignedPanel />

    <!-- 签署荣誉榜 -->
    <SignerList />

    <p class="mono text-center text-xs text-gray-400 mt-6">$ echo "BUILT TO DAWN · 为黎明而造 · KEEP BUILDING" · NEC 开源社区 · 协议版本 {{ store.version }}</p>
  </div>
</template>
