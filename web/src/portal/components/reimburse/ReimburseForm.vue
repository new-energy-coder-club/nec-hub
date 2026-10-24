<script setup lang="ts">
// 报销提交：报销时间 + 单据/付款凭证 OCR 识别（Tesseract.js 本地识别，不上传第三方）
// 草稿持久化：文本字段防抖写入 localStorage，刷新/误关页面后可恢复（文件选择无法持久化，需重传）
import { ref, reactive, watch, onMounted, onBeforeUnmount } from 'vue'
import { loadTesseract, TESS_OPTS } from '@shared/cdn'
import { ocrPdfText, parseFinanceText } from '@shared/ocr'

const emit = defineEmits<{ (e: 'submitted'): void }>()

const REIMBURSE_DRAFT_KEY = 'nec_reimburse_draft'

const today = () => new Date().toLocaleDateString('sv-SE') // 本地时区 YYYY-MM-DD

const form = reactive({
  item: '',
  amount: '',
  date: today(),
  invno: '',
  note: '',
})

// data-ocr="1" 表示当前值是自动生成的（默认可被 OCR 覆盖），用户一旦手动编辑即清除该标记与高亮
const ocrFlags = reactive({ amount: false, date: true, invno: false })
const ocrFilled = reactive({ amount: false, date: false, invno: false })

const receiptFile = ref<File | null>(null)
const paymentFile = ref<File | null>(null)
const receiptStatus = ref('发票/收据图片或 PDF 自动识别金额、日期与发票号（≤10MB）')
const paymentStatus = ref('微信/支付宝付款截图可识别金额（≤10MB）')
const submitStatus = ref('')
const submitting = ref(false)
let ocrRunning = 0 // 进行中的 OCR 任务数，提交时用于拦截

// ---- 草稿持久化 ----
let draftTimer: ReturnType<typeof setTimeout> | null = null
function queueDraft() {
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(() => {
    const draft = { ...form, savedAt: Date.now() }
    try {
      if (draft.item || draft.amount || draft.invno || draft.note) {
        localStorage.setItem(REIMBURSE_DRAFT_KEY, JSON.stringify(draft))
      } else {
        localStorage.removeItem(REIMBURSE_DRAFT_KEY)
      }
    } catch { /* 隐私模式等场景写不进就跳过 */ }
  }, 400)
}
watch(() => ({ ...form }), queueDraft)

function restoreDraft() {
  let draft: any = null
  try { draft = JSON.parse(localStorage.getItem(REIMBURSE_DRAFT_KEY) || 'null') } catch { return }
  if (!draft) return
  // 恢复的草稿视为用户内容：清掉 OCR 标记，避免被后续 OCR 覆盖
  if (draft.item) form.item = draft.item
  if (draft.amount) { form.amount = draft.amount; ocrFlags.amount = false }
  if (draft.date) { form.date = draft.date; ocrFlags.date = false }
  if (draft.invno) { form.invno = draft.invno; ocrFlags.invno = false }
  if (draft.note) form.note = draft.note
  if (draft.item || draft.amount || draft.invno || draft.note) {
    submitStatus.value = '📝 已恢复 ' + new Date(draft.savedAt).toLocaleString('zh-CN') + ' 的未提交草稿（凭证文件需重新上传）'
  }
}

function clearDraft() {
  if (draftTimer) clearTimeout(draftTimer)
  try { localStorage.removeItem(REIMBURSE_DRAFT_KEY) } catch { /* ignore */ }
}

onMounted(restoreDraft)
onBeforeUnmount(() => { if (draftTimer) clearTimeout(draftTimer) })

/** 用户手动编辑：清除 OCR 标记与高亮 */
function onManualEdit(field: 'amount' | 'date' | 'invno') {
  ocrFlags[field] = false
  ocrFilled[field] = false
}

/** OCR 回填守卫：字段为空、或当前值来自上一次 OCR/默认值（data-ocr=1）时才写入，不覆盖用户手改 */
function ocrFill(field: 'amount' | 'date' | 'invno', value: string): boolean {
  if (!value) return false
  if (form[field] && !ocrFlags[field]) return false
  form[field] = value
  ocrFlags[field] = true
  ocrFilled[field] = true
  return true
}

async function recognizeFile(kind: 1 | 2, ev: Event) {
  const input = ev.target as HTMLInputElement
  const st = kind === 1 ? receiptStatus : paymentStatus
  const f = input.files && input.files[0]
  if (kind === 1) receiptFile.value = f
  else paymentFile.value = f
  if (!f) return
  if (f.size > 10 * 1024 * 1024) {
    st.value = '⚠ 文件超过 10MB 上限，请压缩后再上传'
    input.value = ''
    if (kind === 1) receiptFile.value = null
    else paymentFile.value = null
    return
  }
  ocrRunning++
  const stObj = { set textContent(v: string) { st.value = v }, get textContent() { return st.value } }
  st.value = '🔍 识别中（首次需加载识别引擎，约十几秒）…'
  try {
    const Tesseract = await loadTesseract()
    let text: string
    if (f.type === 'application/pdf') {
      text = await ocrPdfText(f, Tesseract, stObj)
    } else {
      const res = await Tesseract.recognize(f, 'chi_sim+eng', Object.assign({}, TESS_OPTS, {
        logger: (m: any) => { if (m.status === 'recognizing text') st.value = '🔍 识别中 ' + Math.round(m.progress * 100) + '%…' },
      }))
      text = res && res.data && res.data.text
    }
    const found = parseFinanceText(text)
    const hints: string[] = []
    const skipped: string[] = []
    if (found.amount) (ocrFill('amount', found.amount) ? hints : skipped).push('金额 ¥' + found.amount)
    if (found.date) (ocrFill('date', found.date) ? hints : skipped).push('日期 ' + found.date)
    if (found.invno && kind === 1) (ocrFill('invno', found.invno) ? hints : skipped).push('发票号 ' + found.invno)
    st.value = (hints.length ? '✅ 已识别回填：' + hints.join(' · ') : '')
      + (skipped.length ? (hints.length ? '；' : '') + '识别到 ' + skipped.join(' · ') + '，因已手动填写未覆盖' : '')
      + (hints.length || skipped.length ? '（可手动修改）' : '⚠ 未识别到有效信息，请手动填写')
  } catch (e: any) {
    st.value = '⚠ 识别失败：' + (e.message || e) + '，请手动填写'
  } finally {
    ocrRunning--
  }
}

async function submitReimburse() {
  if (submitting.value) return
  if (ocrRunning > 0) {
    submitStatus.value = '⏳ 凭证识别仍在进行，请稍候几秒再提交'
    return
  }
  const amountStr = form.amount.trim()
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(amountStr)) {
    submitStatus.value = '⚠ 金额格式不正确：应为数字，最多两位小数'
    return
  }
  const fd = new FormData()
  fd.set('item', form.item.trim())
  fd.set('amount', amountStr)
  fd.set('date', form.date)
  fd.set('note', form.note.trim())
  fd.set('invno', form.invno.trim())
  if (receiptFile.value) fd.set('receipt', receiptFile.value)
  if (paymentFile.value) fd.set('payment', paymentFile.value)
  submitting.value = true
  submitStatus.value = '提交中…'
  try {
    const resp = await fetch('/api/reimburse', { method: 'POST', body: fd })
    const data = await resp.json()
    if (!resp.ok || data.error) throw new Error(data.error || ('HTTP ' + resp.status))
    submitStatus.value = '✅ 已提交' + (data.recordId ? '，已写入财务报销表' : '') + (data.warning ? '；⚠ ' + data.warning : '')
    clearDraft()
    form.item = ''; form.amount = ''; form.invno = ''; form.note = ''
    form.date = today()
    ocrFlags.amount = false; ocrFlags.invno = false; ocrFlags.date = true
    ocrFilled.amount = false; ocrFilled.invno = false; ocrFilled.date = false
    receiptFile.value = null; paymentFile.value = null
    receiptStatus.value = '发票/收据图片或 PDF 自动识别金额、日期与发票号（≤10MB）'
    paymentStatus.value = '微信/支付宝付款截图可识别金额（≤10MB）'
    emit('submitted')
  } catch (e: any) {
    submitStatus.value = '❌ 提交失败：' + (e.message || e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div>
    <form id="reimburse-form" class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm" @submit.prevent="submitReimburse">
      <label class="block" style="font-size:14px">事项<div style="margin-top:4px">
        <input id="r-item" v-model="form.item" required class="mt-1 w-full border rounded px-2 py-1.5" placeholder="如：元器件采购" />
      </div></label>
      <label class="block" style="font-size:14px">金额（元）<div style="margin-top:4px">
        <input id="r-amount" v-model="form.amount" required inputmode="decimal" class="mt-1 w-full border rounded px-2 py-1.5"
               :class="{ 'ocr-filled': ocrFilled.amount }" :data-ocr="ocrFlags.amount ? '1' : ''"
               placeholder="上传凭证后自动识别，可修改" @input="onManualEdit('amount')" />
      </div></label>
      <label class="block" style="font-size:14px">报销时间<div style="margin-top:4px">
        <input id="r-date" v-model="form.date" type="date" required class="mt-1 w-full border rounded px-2 py-1.5"
               :class="{ 'ocr-filled': ocrFilled.date }" :data-ocr="ocrFlags.date ? '1' : ''" @input="onManualEdit('date')" />
      </div></label>
      <label class="block" style="font-size:14px">发票号（选填）<div style="margin-top:4px">
        <input id="r-invno" v-model="form.invno" class="mt-1 w-full border rounded px-2 py-1.5"
               :class="{ 'ocr-filled': ocrFilled.invno }" :data-ocr="ocrFlags.invno ? '1' : ''"
               placeholder="上传发票后自动识别，可修改" @input="onManualEdit('invno')" />
      </div></label>
      <label class="block" style="font-size:14px">备注（选填）<div style="margin-top:4px">
        <input id="r-note" v-model="form.note" class="mt-1 w-full border rounded px-2 py-1.5" />
      </div></label>
      <label class="block" style="font-size:14px">上传单据<div style="margin-top:4px">
        <input id="r-receipt" type="file" class="mt-1 w-full text-xs" accept="image/*,application/pdf" @change="recognizeFile(1, $event)">
        <div id="r-receipt-status" aria-live="polite" class="text-xs text-gray-400 mt-1">{{ receiptStatus }}</div>
      </div></label>
      <label class="block" style="font-size:14px">付款凭证<div style="margin-top:4px">
        <input id="r-payment" type="file" class="mt-1 w-full text-xs" accept="image/*,application/pdf" @change="recognizeFile(2, $event)">
        <div id="r-payment-status" aria-live="polite" class="text-xs text-gray-400 mt-1">{{ paymentStatus }}</div>
      </div></label>
      <div class="md:col-span-2" style="display:flex;gap:12px;align-items:center">
        <button id="r-submit-btn" :disabled="submitting" class="bg-nec-navy text-white hover:opacity-90 disabled:opacity-50 transition-opacity" style="padding:8px 16px;border-radius:6px">{{ submitting ? '提交中…' : '提交报销' }}</button>
        <span id="r-submit-status" aria-live="polite" class="text-xs text-gray-400">{{ submitStatus }}</span>
      </div>
    </form>
  </div>
</template>
