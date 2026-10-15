<script setup lang="ts">
// 新建提交视图：合同字段 + 文件上传（/api/approvals/upload）/ 批量导入 + 审批人动态行 + 字段级校验
import { reactive, ref, onMounted, watch } from 'vue'
import { store, router, api, levelMap, parseParties, parseFileBatch, formatSize } from '../store'

interface UploadEntry { name: string; size: number; token?: string; uploading?: boolean }
interface ApproverRow { level: string; approverId: string; name: string }

const form = reactive({
  contractName: '',
  contractNumber: '',
  contractType: 'service',
  parties: '',
  effectiveDate: '',
  expirationDate: '',
  summary: '',
})
const filesBatch = ref('')
const uploadedFiles = ref<UploadEntry[]>([])
const approverRows = ref<ApproverRow[]>([])
const errors = reactive<Record<string, string>>({ contractName: '', contractFiles: '', approvers: '' })
const submitting = ref(false)
const resultMsg = ref('')
const resultColor = ref('')
const dragover = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

/* ---------- 提交表单初始化：填写指引 + 默认给一行审批人（prefilled 幂等） ---------- */
let prefilled = false
async function prefillSubmitForm() {
  if (prefilled) return
  prefilled = true
  try {
    await api('/api/contract-approval/start')
  } catch { /* ignore */ }
  if (!approverRows.value.length) addApproverRow()
}

onMounted(prefillSubmitForm)
// 原 router('submit') 每次切入都会尝试 prefill（prefilled 守护）
watch(() => store.view, v => { if (v === 'submit') prefillSubmitForm() })

/* ---------- 审批人：动态增删行 ---------- */
function addApproverRow(level = 'team_lead', approverId = '', name = '') {
  approverRows.value.push({ level, approverId, name })
}
function removeApproverRow(i: number) {
  approverRows.value.splice(i, 1)
}
function collectApprovers() {
  return approverRows.value
    .map(r => {
      const approverId = r.approverId.trim()
      if (!approverId) return null
      const name = r.name.trim()
      return { level: r.level, approverId, ...(name ? { name } : {}) }
    })
    .filter(Boolean) as { level: string; approverId: string; name?: string }[]
}

/* ---------- 合同文件：上传 + 批量导入 ---------- */
function removeFile(i: number) {
  uploadedFiles.value.splice(i, 1)
}

async function uploadFiles(fileList: FileList | null) {
  if (!fileList) return
  for (const file of Array.from(fileList)) {
    if (file.size > 10 * 1024 * 1024) {
      setFieldError('contractFiles', `「${file.name}」超过 10MB 上限`)
      continue
    }
    const entry: UploadEntry = { name: file.name, size: file.size, uploading: true }
    uploadedFiles.value.push(entry)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const data = await api('/api/approvals/upload', { method: 'POST', body: fd })
      const saved = data.files?.[0]
      entry.token = saved?.key || ''
      entry.name = saved?.name || file.name
      entry.size = saved?.size ?? file.size
    } catch (err: any) {
      uploadedFiles.value = uploadedFiles.value.filter(f => f !== entry)
      setFieldError('contractFiles', `「${file.name}」上传失败：${err.message}`)
    } finally {
      entry.uploading = false
    }
  }
}

function onDrop(e: DragEvent) {
  dragover.value = false
  uploadFiles(e.dataTransfer?.files || null)
}
function onPick() {
  fileInput.value?.click()
}
function onFileChange() {
  uploadFiles(fileInput.value?.files || null)
  if (fileInput.value) fileInput.value.value = ''
}

function collectContractFiles() {
  const batch = parseFileBatch(filesBatch.value)
  const uploaded = uploadedFiles.value.filter(f => f.token).map(f => ({ name: f.name, token: f.token!, size: f.size }))
  return [...uploaded, ...batch]
}

/* ---------- 字段级校验 ---------- */
function setFieldError(field: string, msg: string) {
  errors[field] = msg || ''
}
function scrollToError(field: string) {
  document.querySelector(`.field-error[data-for="${field}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function validateSubmitForm(): boolean {
  const approvers = collectApprovers()
  const checks: [string, unknown, string][] = [
    ['contractName', form.contractName.trim(), '请填写合同名称'],
    ['contractFiles', collectContractFiles().length, '请至少上传或导入一份合同文件'],
    ['approvers', approvers.length, '请至少指定一名审批人'],
  ]
  let firstBad = ''
  for (const [field, val, msg] of checks) {
    const bad = !val
    setFieldError(field, bad ? msg : '')
    if (bad && !firstBad) firstBad = field
  }
  // 提交人不能兼任审批人（前端先拦截，后端也会校验）
  if (!firstBad && store.currentUser && approvers.some(a => a.approverId === store.currentUser!.open_id)) {
    setFieldError('approvers', '提交人不能兼任审批人')
    firstBad = 'approvers'
  }
  if (firstBad) scrollToError(firstBad)
  return !firstBad
}

/* ---------- 提交 ---------- */
async function onSubmit() {
  if (!validateSubmitForm()) {
    resultColor.value = '#C22E2E'
    resultMsg.value = '请先补全上方标记为必填的内容'
    return
  }
  submitting.value = true
  try {
    const data = await api('/api/contract-approval/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contractName: form.contractName.trim(),
        ...(form.contractNumber.trim() ? { contractNumber: form.contractNumber.trim() } : {}),
        contractType: form.contractType,
        ...(parseParties(form.parties).length ? { parties: parseParties(form.parties) } : {}),
        ...(form.effectiveDate ? { effectiveDate: form.effectiveDate } : {}),
        ...(form.expirationDate ? { expirationDate: form.expirationDate } : {}),
        contractFiles: collectContractFiles(),
        ...(form.summary.trim() ? { summary: form.summary.trim() } : {}),
        approvers: collectApprovers(),
      }),
    })
    resultColor.value = '#177A4C'
    resultMsg.value = `提交成功：${data.approvalId}`
    form.contractName = ''
    form.contractNumber = ''
    form.contractType = 'service'
    form.parties = ''
    form.effectiveDate = ''
    form.expirationDate = ''
    form.summary = ''
    filesBatch.value = ''
    uploadedFiles.value = []
    approverRows.value = []
    prefilled = false
    router('list')
  } catch (err: any) {
    resultColor.value = '#C22E2E'
    resultMsg.value = '失败：' + err.message
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="nec-card p-5 sm:p-7">
    <div class="flex items-start justify-between flex-wrap gap-2 mb-1">
      <div>
        <h2 class="text-lg font-bold text-nec-ink">新建合同审批</h2>
        <p class="mono text-xs text-nec-gray tracking-wider">CONTRACT APPROVAL SUBMISSION</p>
      </div>
    </div>

    <form id="submit-form" novalidate class="space-y-5 mt-4" @submit.prevent="onSubmit">
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
          <input type="text" name="contractNumber" v-model="form.contractNumber" class="mono w-full rounded-lg border border-nec-line px-3 py-2.5 text-sm" placeholder="示例：HT-2026-001" />
        </div>
        <div>
          <label class="block text-sm font-medium text-nec-navy mb-1">合同类型</label>
          <select name="contractType" v-model="form.contractType" class="w-full rounded-lg border border-nec-line px-3 py-2.5 text-sm bg-white">
            <option value="purchase">采购合同</option>
            <option value="sales">销售合同</option>
            <option value="service">服务合同</option>
            <option value="partnership">合作协议</option>
            <option value="nda">保密协议</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-nec-navy mb-1">合同各方</label>
          <input type="text" name="parties" v-model="form.parties" class="w-full rounded-lg border border-nec-line px-3 py-2.5 text-sm" placeholder="多方用逗号分隔，如：甲方公司, 乙方公司" />
        </div>
        <div>
          <label class="block text-sm font-medium text-nec-navy mb-1">生效日期</label>
          <input type="date" name="effectiveDate" v-model="form.effectiveDate" class="mono w-full rounded-lg border border-nec-line px-3 py-2.5 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-nec-navy mb-1">到期日期</label>
          <input type="date" name="expirationDate" v-model="form.expirationDate" class="mono w-full rounded-lg border border-nec-line px-3 py-2.5 text-sm" />
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium text-nec-navy mb-1">合同摘要</label>
        <textarea name="summary" rows="3" v-model="form.summary" class="w-full rounded-lg border border-nec-line px-3 py-2.5 text-sm" placeholder="合同背景、金额、关键条款、需要审批人重点关注的内容"></textarea>
      </div>

      <div>
        <label class="req block text-sm font-medium text-nec-navy mb-1">合同文件</label>
        <div
          id="file-drop"
          class="dropzone p-5 text-center"
          :class="{ dragover, 'input-invalid': errors.contractFiles }"
          @click="onPick"
          @dragenter.prevent="dragover = true"
          @dragover.prevent="dragover = true"
          @dragleave.prevent="dragover = false"
          @drop.prevent="onDrop"
        >
          <p class="text-sm text-nec-navy font-medium">拖拽文件到这里，或 <span class="link">点击选择</span></p>
          <p class="mono text-xs text-nec-gray mt-1">PDF / DOCX / XLSX / ZIP 等，单文件 ≤ 10MB，可多选</p>
          <input type="file" ref="fileInput" multiple class="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.zip,.png,.jpg,.jpeg"
            @change="onFileChange" />
        </div>
        <div id="file-list" class="mt-2 space-y-2">
          <div v-for="(f, i) in uploadedFiles" :key="i" class="flex items-center gap-2 rounded-lg border border-nec-line bg-white px-3 py-2 text-sm">
            <span class="mono text-xs text-nec-royal font-bold">FILE</span>
            <span class="text-nec-ink truncate">{{ f.name }}</span>
            <span class="mono text-xs text-nec-gray flex-none">{{ f.uploading ? '上传中…' : formatSize(f.size || 0) }}</span>
            <button type="button" class="ml-auto text-nec-gray hover:text-red-600 leading-none" title="移除" @click="removeFile(i)">×</button>
          </div>
        </div>
        <p class="field-error" :class="{ hidden: !errors.contractFiles }" data-for="contractFiles">{{ errors.contractFiles }}</p>
        <details class="mt-2 text-xs text-nec-gray">
          <summary class="link cursor-pointer select-none">批量导入（高级：名称|文件token|链接，每行一条）</summary>
          <textarea v-model="filesBatch" rows="2" class="mono mt-2 w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="采购合同 V1.0.pdf|file_token_xxx&#10;附件-报价单.xlsx"></textarea>
        </details>
      </div>

      <div>
        <label class="req block text-sm font-medium text-nec-navy mb-1">审批人（会签：全部通过才生效）</label>
        <div class="rounded-lg border border-nec-line overflow-hidden" :class="{ 'input-invalid': errors.approvers }">
          <div class="hidden sm:grid grid-cols-12 gap-2 px-3 py-2 text-xs text-nec-gray" style="background:var(--nec-fog)">
            <span class="col-span-3">审批层级</span><span class="col-span-5">审批人 open_id</span><span class="col-span-3">姓名（可选）</span><span class="col-span-1"></span>
          </div>
          <div id="approver-rows">
            <div v-for="(row, i) in approverRows" :key="i" class="approver-row grid grid-cols-12 gap-2 px-3 py-2 items-center" style="border-top:1px solid var(--nec-line)">
              <select v-model="row.level" class="approver-level col-span-12 sm:col-span-3 rounded border border-nec-line px-2 py-1.5 text-sm bg-white">
                <option v-for="(label, value) in levelMap" :key="value" :value="value">{{ label }}</option>
              </select>
              <input type="text" v-model="row.approverId" class="approver-id mono col-span-12 sm:col-span-5 rounded border border-nec-line px-2 py-1.5 text-sm" placeholder="ou_ 开头的 open_id" />
              <input type="text" v-model="row.name" class="approver-name col-span-10 sm:col-span-3 rounded border border-nec-line px-2 py-1.5 text-sm" placeholder="姓名" />
              <button type="button" class="col-span-2 sm:col-span-1 text-nec-gray hover:text-red-600 text-lg leading-none" title="删除本行" @click="removeApproverRow(i)">×</button>
            </div>
          </div>
        </div>
        <button type="button" class="mt-2 text-xs link" @click="addApproverRow()">+ 添加审批人</button>
        <p class="field-error" :class="{ hidden: !errors.approvers }" data-for="approvers">{{ errors.approvers }}</p>
      </div>

      <div class="flex items-center justify-end gap-3 pt-2" style="border-top:1px solid var(--nec-line)">
        <p id="submit-result" class="mr-auto text-sm" :style="{ color: resultColor }">{{ resultMsg }}</p>
        <button type="submit" class="btn-primary text-sm font-medium px-5 py-2 rounded-lg" :disabled="submitting">{{ submitting ? '提交中…' : '提交审批单' }}</button>
      </div>
    </form>
  </div>
</template>
