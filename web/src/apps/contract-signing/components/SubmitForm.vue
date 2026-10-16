<script setup lang="ts">
// 提交审批单（抽屉内容，不再独占视图）：金额/币种、自动编号预览、MembersPicker 会签、
// FilePicker 三模式、防丢（关闭确认 + 800ms 节流自动草稿）、到期<生效即时红字校验
import { reactive, ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { store, api, typeMap, parseParties, formatAmount, MAX_AMOUNT } from '../store'
import { useDraft } from '@shared/composables/useDraft'
import { confirmDialog } from '@shared/ui/feedback'
import MembersPicker, { type ApproverChip } from './MembersPicker.vue'
import FilePicker, { type FileDraft } from './FilePicker.vue'

const emit = defineEmits<{ (e: 'submitted', approvalId: string): void }>()

const form = reactive({
  contractName: '',
  contractNumber: '',
  contractType: 'service',
  parties: '',
  amountRaw: '',      // 数值字符串（可 parseFloat），展示层千分位
  currency: 'CNY',
  effectiveDate: '',
  expirationDate: '',
  summary: '',
})
const chips = ref<ApproverChip[]>([])
const files = ref<FileDraft[]>([])

const errors = reactive<Record<string, string>>({
  contractName: '', contractNumber: '', amount: '', expirationDate: '', contractFiles: '', approvers: '',
})
const submitting = ref(false)
const resultMsg = ref('')
const resultColor = ref('')
const nextNumber = ref('')
const nextNumberLoading = ref(false)
const nextNumberError = ref('')
const draftRestored = ref(false)

/* ---------- 金额：内部存数值字符串，渲染千分位 ---------- */
const amountDisplay = computed(() => formatAmount(form.amountRaw))

function onAmountInput(e: Event) {
  let v = (e.target as HTMLInputElement).value.replace(/,/g, '').replace(/[^\d.]/g, '')
  const dot = v.indexOf('.')
  if (dot >= 0) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '')
  const [int, dec] = v.split('.')
  form.amountRaw = dec !== undefined ? int.slice(0, 7) + '.' + dec.slice(0, 2) : int.slice(0, 7)
  setFieldError('amount', '')
}

function amountError(): string {
  const raw = form.amountRaw.trim()
  if (!raw) return '请填写合同金额'
  const n = parseFloat(raw)
  if (isNaN(n) || n <= 0) return '金额必须大于 0'
  if (n > MAX_AMOUNT) return '金额不能超过 9,999,999.99'
  if ((raw.split('.')[1] || '').length > 2) return '金额最多两位小数'
  return ''
}

/* ---------- 日期：到期必须晚于生效（缺一则跳过） ---------- */
function dateError(): string {
  if (!form.effectiveDate || !form.expirationDate) return ''
  return form.expirationDate <= form.effectiveDate ? '到期日期必须晚于生效日期' : ''
}

/* ---------- 字段级错误与滚动定位 ---------- */
function setFieldError(field: keyof typeof errors, msg: string) {
  errors[field] = msg || ''
}
function scrollToError(field: string) {
  document.querySelector(`.field-error[data-for="${field}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/* ---------- 编号预览（只预览不占用） ---------- */
async function previewNumber() {
  nextNumberError.value = ''
  nextNumber.value = ''
  nextNumberLoading.value = true
  try {
    const data = await api('/api/contract-approval/next-number')
    nextNumber.value = data?.number || '—'
  } catch (err: any) {
    nextNumberError.value = '预览失败：' + err.message
  } finally {
    nextNumberLoading.value = false
  }
}

/* ---------- 校验与提交 ---------- */
function collectApprovers() {
  return chips.value.map(c => ({ level: c.level, approverId: c.approverId, ...(c.name ? { name: c.name } : {}) }))
}
function collectContractFiles() {
  return files.value.map(f => f.kind === 'upload'
    ? { name: f.name, token: 'r2:' + f.key, size: f.size }
    : { name: f.name, url: f.url })
}

function validateSubmit(): boolean {
  let firstBad = ''
  const mark = (field: keyof typeof errors, bad: boolean, msg: string) => {
    setFieldError(field, bad ? msg : '')
    if (bad && !firstBad) firstBad = field as string
  }
  mark('contractName', !form.contractName.trim(), '请填写合同名称')
  mark('amount', !!amountError(), amountError())
  mark('expirationDate', !!dateError(), dateError())
  mark('contractFiles', files.value.length === 0, '请至少添加一份合同文件')
  mark('approvers', chips.value.length === 0, '请至少指定一名审批人')
  if (!firstBad && store.currentUser && chips.value.some(c => c.approverId === store.currentUser!.open_id)) {
    mark('approvers', true, '提交人不能兼任审批人')
  }
  if (firstBad) scrollToError(firstBad)
  return !firstBad
}

async function onSubmit() {
  nextNumberError.value = ''
  if (!validateSubmit()) {
    resultColor.value = '#C22E2E'
    resultMsg.value = '请先补全上方标记为必填的内容'
    return
  }
  submitting.value = true
  resultMsg.value = ''
  try {
    const data = await api('/api/contract-approval/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contractName: form.contractName.trim(),
        ...(form.contractNumber.trim() ? { contractNumber: form.contractNumber.trim() } : {}),
        contractType: form.contractType,
        amount: Math.round(parseFloat(form.amountRaw) * 100) / 100,
        currency: form.currency,
        ...(parseParties(form.parties).length ? { parties: parseParties(form.parties) } : {}),
        ...(form.effectiveDate ? { effectiveDate: form.effectiveDate } : {}),
        ...(form.expirationDate ? { expirationDate: form.expirationDate } : {}),
        contractFiles: collectContractFiles(),
        ...(form.summary.trim() ? { summary: form.summary.trim() } : {}),
        approvers: collectApprovers(),
      }),
    })
    clearDraft()
    resetForm()
    emit('submitted', data.approvalId)
  } catch (err: any) {
    // 编号重复：错误落回编号字段下方红字
    if (/合同编号已存在/.test(String(err.message))) {
      setFieldError('contractNumber', err.message)
      scrollToError('contractNumber')
      return
    }
    resultColor.value = '#C22E2E'
    resultMsg.value = '提交失败：' + err.message
  } finally {
    submitting.value = false
  }
}

function resetForm() {
  Object.assign(form, {
    contractName: '', contractNumber: '', contractType: 'service', parties: '',
    amountRaw: '', currency: 'CNY', effectiveDate: '', expirationDate: '', summary: '',
  })
  chips.value = []
  files.value = []
  ;(Object.keys(errors) as (keyof typeof errors)[]).forEach(k => setFieldError(k, ''))
  nextNumber.value = ''
  nextNumberError.value = ''
  resultMsg.value = ''
  resultColor.value = ''
  draftRestored.value = false
  draftSnapshot = draftPayload()
}

/* ---------- 防丢：自动草稿（800ms 节流走 shared useDraft） + 关闭确认 ---------- */
const DRAFT_KEY = 'nec-contract-draft'
let draftSnapshot = ''

function draftPayload(): string {
  return JSON.stringify({ ...form, chips: chips.value, files: files.value })
}
const dirty = computed(() => draftPayload() !== draftSnapshot)

interface CsDraft { form: Record<string, string>; chips: ApproverChip[]; files: FileDraft[] }
const draftStore = useDraft<CsDraft>(DRAFT_KEY, {
  delay: 800,
  collect: () => ({ form: { ...form }, chips: chips.value, files: files.value }),
})
const saveDraftThrottled = draftStore.schedule

function loadDraft(): boolean {
  const d = draftStore.read()
  if (!d || typeof d !== 'object' || !d.form) return false
  const f = d.form
  Object.assign(form, {
    contractName: typeof f.contractName === 'string' ? f.contractName : '',
    contractNumber: typeof f.contractNumber === 'string' ? f.contractNumber : '',
    contractType: typeof f.contractType === 'string' ? f.contractType : 'service',
    parties: typeof f.parties === 'string' ? f.parties : '',
    amountRaw: typeof f.amountRaw === 'string' ? f.amountRaw : '',
    currency: typeof f.currency === 'string' ? f.currency : 'CNY',
    effectiveDate: typeof f.effectiveDate === 'string' ? f.effectiveDate : '',
    expirationDate: typeof f.expirationDate === 'string' ? f.expirationDate : '',
    summary: typeof f.summary === 'string' ? f.summary : '',
  })
  chips.value = Array.isArray(d.chips)
    ? d.chips.filter((c: any) => c && typeof c.approverId === 'string' && typeof c.level === 'string')
        .map((c: any) => ({ level: c.level, approverId: c.approverId, name: typeof c.name === 'string' ? c.name : '' }))
    : []
  files.value = Array.isArray(d.files)
    ? d.files.filter((x: any) => x && typeof x.name === 'string' && (x.kind === 'upload' ? typeof x.key === 'string' : typeof x.url === 'string'))
    : []
  return true
}

const clearDraft = draftStore.clear

function onClearDraft() {
  clearDraft()
  resetForm()
}

// 关闭前确认（父组件通过 defineExpose 调用）
async function confirmClose(): Promise<boolean> {
  if (!dirty.value) return true
  return confirmDialog('放弃本次填写？')
}
defineExpose({ confirmClose })

watch([form, chips, files], saveDraftThrottled, { deep: true })
// 有效期任一变化即重算倒挂校验；到期 blur 时即时提示
watch(() => [form.effectiveDate, form.expirationDate], () => {
  setFieldError('expirationDate', dateError())
})

onMounted(async () => {
  const blank = draftPayload()
  loadDraft()
  draftRestored.value = draftPayload() !== blank
  draftSnapshot = draftPayload()
  // 原 /start 填写指引（幂等，后端保证）
  try { await api('/api/contract-approval/start') } catch { /* ignore */ }
})

onBeforeUnmount(() => {
  draftStore.cancel()
})
</script>

<template>
  <div class="cs-form">
    <!-- 草稿恢复提示 -->
    <div v-if="draftRestored" class="cs-draft-bar">
      <span>🕘 已恢复上次草稿</span>
      <button type="button" class="link text-xs" @click="onClearDraft">清除草稿</button>
    </div>

    <form id="submit-form" novalidate class="space-y-5" @submit.prevent="onSubmit">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="req block text-sm font-medium text-nec-navy mb-1">合同名称</label>
          <input type="text" name="contractName" v-model="form.contractName" @input="setFieldError('contractName', '')"
            class="w-full rounded-lg border border-nec-line px-3 py-2.5 text-sm" :class="{ 'input-invalid': errors.contractName }"
            placeholder="示例：XX 项目设备采购合同" />
          <p class="field-error" :class="{ hidden: !errors.contractName }" data-for="contractName">{{ errors.contractName }}</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-nec-navy mb-1">合同编号</label>
          <div class="flex items-center gap-2">
            <input type="text" name="contractNumber" v-model="form.contractNumber" @input="setFieldError('contractNumber', '')"
              class="mono w-full rounded-lg border border-nec-line px-3 py-2.5 text-sm"
              :class="{ 'input-invalid': errors.contractNumber }"
              placeholder="留空自动生成 HT-2026-XXX" />
            <button type="button" class="cs-num-btn flex-none" :disabled="nextNumberLoading" @click="previewNumber">
              {{ nextNumberLoading ? '…' : '预览' }}
            </button>
          </div>
          <p v-if="nextNumber" class="cs-num-preview mono">自动编号预览：{{ nextNumber }}（不占用）</p>
          <p v-if="nextNumberError" class="field-error">{{ nextNumberError }}</p>
          <p class="field-error" :class="{ hidden: !errors.contractNumber }" data-for="contractNumber">{{ errors.contractNumber }}</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-nec-navy mb-1">合同类型</label>
          <select name="contractType" v-model="form.contractType" class="w-full rounded-lg border border-nec-line px-3 py-2.5 text-sm bg-white">
            <option v-for="(label, value) in typeMap" :key="value" :value="value">{{ label }}</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-nec-navy mb-1">合同各方</label>
          <input type="text" name="parties" v-model="form.parties" class="w-full rounded-lg border border-nec-line px-3 py-2.5 text-sm" placeholder="多方用逗号分隔，如：甲方公司, 乙方公司" />
        </div>
        <div>
          <label class="req block text-sm font-medium text-nec-navy mb-1">合同金额</label>
          <div class="flex items-stretch gap-2">
            <div class="relative flex-1">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-nec-gray">¥</span>
              <input type="text" inputmode="decimal" name="amount" :value="amountDisplay" @input="onAmountInput" @blur="setFieldError('amount', amountError())"
                class="w-full rounded-lg border border-nec-line pl-7 pr-3 py-2.5 text-sm"
                :class="{ 'input-invalid': errors.amount }" placeholder="0.00" />
            </div>
            <select name="currency" v-model="form.currency" class="rounded-lg border border-nec-line px-2 py-2.5 text-sm bg-white flex-none">
              <option v-for="(label, value) in { CNY: 'CNY · 人民币', USD: 'USD · 美元', EUR: 'EUR · 欧元', JPY: 'JPY · 日元', GBP: 'GBP · 英镑', HKD: 'HKD · 港币' }" :key="value" :value="value">{{ label }}</option>
            </select>
          </div>
          <p class="mono text-xs text-nec-gray mt-1">大于 0，不超过 9,999,999.99，最多两位小数</p>
          <p class="field-error" :class="{ hidden: !errors.amount }" data-for="amount">{{ errors.amount }}</p>
        </div>
        <div class="hidden md:block"></div>
        <div>
          <label class="block text-sm font-medium text-nec-navy mb-1">生效日期</label>
          <input type="date" name="effectiveDate" v-model="form.effectiveDate" placeholder="YYYY-MM-DD"
            class="mono w-full rounded-lg border border-nec-line px-3 py-2.5 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-nec-navy mb-1">到期日期</label>
          <input type="date" name="expirationDate" v-model="form.expirationDate" placeholder="YYYY-MM-DD"
            @blur="setFieldError('expirationDate', dateError())"
            class="mono w-full rounded-lg border border-nec-line px-3 py-2.5 text-sm"
            :class="{ 'input-invalid': errors.expirationDate }" />
          <p class="field-error" :class="{ hidden: !errors.expirationDate }" data-for="expirationDate">{{ errors.expirationDate }}</p>
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium text-nec-navy mb-1">合同摘要</label>
        <textarea name="summary" rows="3" v-model="form.summary" class="w-full rounded-lg border border-nec-line px-3 py-2.5 text-sm" placeholder="合同背景、金额、关键条款、需要审批人重点关注的内容"></textarea>
      </div>

      <div>
        <label class="req block text-sm font-medium text-nec-navy mb-1">合同文件</label>
        <FilePicker v-model="files" :error="errors.contractFiles" :disabled="submitting" />
      </div>

      <div>
        <label class="req block text-sm font-medium text-nec-navy mb-1">审批人</label>
        <MembersPicker v-model="chips" :error="errors.approvers" :disabled="submitting" />
      </div>

      <div class="flex items-center justify-end gap-3 pt-2" style="border-top:1px solid var(--nec-line)">
        <p id="submit-result" class="mr-auto text-sm" :style="{ color: resultColor }">{{ resultMsg }}</p>
        <button type="submit" class="btn-primary text-sm font-medium px-5 py-2 rounded-lg" :disabled="submitting">{{ submitting ? '提交中…' : '提交审批单' }}</button>
      </div>
    </form>
  </div>
</template>