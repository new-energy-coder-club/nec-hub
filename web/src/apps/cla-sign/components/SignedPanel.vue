<script setup lang="ts">
// 签署成功 / 已签署面板：PDF 证书导出（浏览器打印引擎，文字可选中可复制）
// 证书模板通过 Teleport 挂到 body 直属节点，配合打印 CSS（body.printing > #cert）只输出证书页
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { AGREEMENT_UPDATED_AT, certAgreementText, certId, fmtCN, fmtDate } from '../agreement'
import { store } from '../store'

const panelEl = ref<HTMLElement | null>(null)
const exporting = ref(false)

const cert = reactive({
  version: '',
  updatedAt: '',
  name: '',
  github: '',
  org: '',
  signedAt: '',
  certId: '',
  agreement: '',
})

const signedMsg = computed(() => {
  const sig = store.currentSig
  if (!sig) return ''
  return store.alreadySigned
    ? `✓ @${sig.github} 已签署协议 v${sig.version}（${fmtDate(sig.signedAt)}），可随时导出 PDF 证书。`
    : `✓ 协议 v${sig.version} 签署完成，点击下方按钮留存 PDF 证书。`
})

watch(() => store.currentSig, async sig => {
  if (!sig) return
  await nextTick()
  panelEl.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
})

async function onExportPdf() {
  const sig = store.currentSig
  if (!sig) return
  exporting.value = true
  cert.version = sig.version
  cert.updatedAt = AGREEMENT_UPDATED_AT
  cert.name = sig.name
  cert.github = '@' + sig.github
  cert.org = sig.org || '—'
  cert.signedAt = fmtCN(sig.signedAt)
  cert.certId = await certId(sig)
  cert.agreement = certAgreementText()
  await nextTick()
  // 等证书里的队标图片就绪后再唤起打印，避免打印出占位空白
  const imgs = [...document.querySelectorAll<HTMLImageElement>('#cert img')]
  await Promise.all(imgs.map(img => img.complete
    ? Promise.resolve()
    : new Promise(r => { img.onload = r; img.onerror = r })))
  document.body.classList.add('printing')
  window.print()
  document.body.classList.remove('printing')
  exporting.value = false
}
</script>

<template>
  <section v-if="store.currentSig" ref="panelEl" class="mt-6 terminal fade-in">
    <div class="terminal-bar flex items-center gap-2 px-4 py-2.5">
      <span class="dot bg-red-400"></span><span class="dot bg-yellow-400"></span><span class="dot bg-green-400"></span>
      <img src="/brand/nec-logo-white.svg" alt="" class="h-4 w-auto ml-1" />
      <span class="mono text-xs text-slate-300 ml-2">nec cla export --pdf</span>
    </div>
    <div class="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
      <p class="mono text-xs ok flex-1">{{ signedMsg }}</p>
      <button type="button" :disabled="exporting" class="pdf-btn mono rounded-lg px-5 py-2.5 text-sm whitespace-nowrap" @click="onExportPdf">
        ⬇ 导出 PDF 证书
      </button>
    </div>
  </section>

  <!-- PDF 证书模板（屏幕外，打印导出时由浏览器排版引擎渲染为可选中文字） -->
  <Teleport to="body">
    <div id="cert" aria-hidden="true">
      <div style="display:flex; justify-content:space-between; align-items:flex-end;">
        <img src="/brand/nec-lockup-h.svg" alt="NEC 常州工学院 NEC 战队" style="height:56px; width:auto;" />
        <p class="mono" style="font-size:11px; color:var(--nec-gray); text-align:right;">hub.newenergycoder.club<br/>BUILT TO DAWN · 为黎明而造</p>
      </div>
      <div class="cert-horizon" style="margin:18px 0 28px;"></div>

      <h1 style="font-size:26px; color:var(--nec-ink);">贡献者许可协议（CLA）签署证明</h1>
      <p class="mono" style="font-size:12px; color:var(--nec-gray); margin-top:6px;">
        Contributor License Agreement Certificate · 协议版本 v{{ cert.version }} · {{ cert.updatedAt }} 生效
      </p>

      <div class="cert-box" style="margin-top:24px; border:1px solid var(--nec-line); border-radius:10px; padding:18px 20px; background:var(--nec-fog);">
        <dl style="display:grid; grid-template-columns:1fr 1fr; row-gap:10px;">
          <div class="cert-kv"><dt>签署人</dt><dd>{{ cert.name }}</dd></div>
          <div class="cert-kv"><dt>GitHub</dt><dd class="mono">{{ cert.github }}</dd></div>
          <div class="cert-kv"><dt>单位 / 组织</dt><dd>{{ cert.org }}</dd></div>
          <div class="cert-kv"><dt>签署时间</dt><dd class="mono">{{ cert.signedAt }}</dd></div>
          <div class="cert-kv" style="grid-column:1 / -1;"><dt>存证编号</dt><dd class="mono">{{ cert.certId }}</dd></div>
        </dl>
      </div>

      <p style="font-size:13px; margin-top:20px; font-weight:700; color:var(--nec-navy);">附：协议全文</p>
      <pre class="cert-body mono" style="margin-top:10px;">{{ cert.agreement }}</pre>

      <div class="cert-horizon" style="margin-top:28px;"></div>
      <p style="font-size:11px; color:var(--nec-gray); margin-top:12px;">
        本证明由 NEC 团队 AI 中台自动生成，记录签署人对上述版本协议的同意。存证编号可由签署信息与协议版本重新计算校验。
      </p>
    </div>
  </Teleport>
</template>
