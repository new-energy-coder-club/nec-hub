<script setup lang="ts">
// 图纸评审 · 评审单详情：状态操作 + 询价流转（生成/回填报价/比价/选定供应商）
import { ref, reactive, onMounted } from 'vue'
import { apiDr } from '../../api'
import { DR_INQ_STATUS } from './dr-status'

const props = defineProps<{ review: any }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const tip = ref('')
const tipOk = ref(true)
const tipWarn = ref(false)
const inquiries = ref<any[] | null>(null)
const inqError = ref('')
const compare = ref<any>(null)
// 回填报价行内表单：inquiryId → { supplier, price, deliveryDate }
const quoteForms = reactive<Record<string, { supplier: string; price: string; deliveryDate: string }>>({})

function quoteFormOf(q: any) {
  if (!quoteForms[q.inquiryId]) {
    quoteForms[q.inquiryId] = { supplier: q.supplierName === '待定' ? '' : (q.supplierName || ''), price: '', deliveryDate: '' }
  }
  return quoteForms[q.inquiryId]
}

function setTip(ok: boolean, msg: string) {
  tipOk.value = ok
  tipWarn.value = false
  tip.value = msg
}

async function drAct(path: string, body: any, okMsg: string) {
  try {
    await apiDr(`/${props.review.reviewId}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    setTip(true, okMsg)
    setTimeout(() => emit('changed'), 600)
  } catch (err: any) {
    setTip(false, '失败：' + err.message)
  }
}

async function drMeeting() {
  try {
    const data = await apiDr(`/${props.review.reviewId}/meeting`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (data.meeting?.mock) {
      tipOk.value = false
      tipWarn.value = true
      tip.value = `会议 API 未打通（${data.meeting.mockReason || '权限/网络'}），已生成占位会议号 ${data.meeting.meetingId}，请人工建会后补录链接`
    } else {
      setTip(true, '会议已预约')
    }
    setTimeout(() => emit('changed'), 600)
  } catch (err: any) {
    setTip(false, '失败：' + err.message)
  }
}
function drRectify() { drAct('/rectify', {}, '整改已完成，进入 BOM 生成') }
function drConclude() {
  const c = prompt('评审结论：passed（通过）/ conditional（有条件通过）/ rejected（不通过）', 'passed')
  if (c === null) return
  if (!['passed', 'conditional', 'rejected'].includes(c)) { alert('无效结论'); return }
  drAct('/conclusion', { conclusion: c }, '评审结论已提交')
}
function drBom() {
  const sample = JSON.stringify([
    { materialName: '伺服电机', materialCode: 'M-001', specification: 'AK10-9', quantity: 2, unit: '台', source: 'purchased' },
    { materialName: '联轴器', materialCode: 'M-002', specification: 'LK-20', quantity: 4, unit: '个', source: 'standard' },
    { materialName: '安装支架', quantity: 1, unit: '件', source: 'self-made', process: 'machining' },
  ], null, 2)
  const raw = prompt('粘贴或修改 BOM JSON 数组（source: purchased 外购 / standard 标准件 / self-made 自制）：', sample)
  if (raw === null) return
  let items: any
  try { items = JSON.parse(raw) } catch { alert('JSON 格式错误'); return }
  if (!Array.isArray(items) || items.length === 0) { alert('必须是非空数组'); return }
  drAct('/bom/generate', { items }, 'BOM 已生成，可继续生成询价单')
}

// ---- 询价流转与比价 ----
const noBom = ref(false)

async function drGenerateInquiries() {
  const requiredDate = prompt('需求日期（YYYY-MM-DD，可留空）：', '')
  if (requiredDate === null) return
  noBom.value = false
  try {
    const data = await apiDr(`/${props.review.reviewId}/inquiries/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requiredDate: requiredDate.trim() || undefined }),
    })
    setTip(true, `已生成 ${data.created.length} 张询价单` + (data.skipped.length ? `，跳过已存在 ${data.skipped.length} 项` : ''))
    loadInquiries()
  } catch (err: any) {
    if (/尚无 BOM/.test(err.message)) {
      noBom.value = true
      setTip(false, '生成失败：' + err.message)
    } else {
      setTip(false, '生成失败：' + err.message)
    }
  }
}

async function loadInquiries() {
  inqError.value = ''
  try {
    inquiries.value = await apiDr(`/${props.review.reviewId}/inquiries`)
  } catch (err: any) {
    inqError.value = err.message
  }
}

async function drQuoteSubmit(inquiryId: string) {
  const f = quoteForms[inquiryId]
  const supplier = (f?.supplier ?? '').trim()
  const price = parseFloat(f?.price ?? '')
  const deliveryDate = f?.deliveryDate || undefined
  if (!supplier || !(price > 0)) {
    setTip(false, '请填写供应商与大于 0 的报价')
    return
  }
  try {
    await apiDr(`/inquiries/${inquiryId}/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ supplier, price, deliveryDate }),
    })
    setTip(true, `询价单 ${inquiryId} 报价已回填`)
    loadInquiries()
  } catch (err: any) {
    setTip(false, '报价失败：' + err.message)
  }
}

async function drCompare() {
  try {
    compare.value = await apiDr(`/${props.review.reviewId}/inquiries/compare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
  } catch (err: any) {
    setTip(false, '比价失败：' + err.message)
  }
}

async function drSelectSupplier(materialKey: string, inquiryId: string) {
  if (!confirm(`确认选定询价单 ${inquiryId} 的供应商？同物料其他报价将置为未中选`)) return
  try {
    await apiDr(`/${props.review.reviewId}/inquiries/compare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selections: { [materialKey]: inquiryId } }),
    })
    setTip(true, `已选定 ${inquiryId}`)
    loadInquiries()
    drCompare()
  } catch (err: any) {
    setTip(false, '选定失败：' + err.message)
  }
}

function inqStatus(s: string) {
  return DR_INQ_STATUS[s] || DR_INQ_STATUS.sent
}

onMounted(loadInquiries)
</script>

<template>
  <div class="mt-3 pt-3 border-t border-gray-100 space-y-2 text-sm">
    <p v-if="review.meetingId && review.meetingLink">会议：<a :href="review.meetingLink" target="_blank" class="underline" style="color:var(--nec-cyan)">{{ review.meetingId }}</a>{{ review.meetingStartTime ? ' · ' + new Date(review.meetingStartTime).toLocaleString() : '' }}</p>
    <p v-else-if="review.meetingId">会议：<span class="mono">{{ review.meetingId }}</span> <span class="text-amber-600">（占位会议号，会议 API 未打通，请人工建会后补录链接）</span>{{ review.meetingStartTime ? ' · ' + new Date(review.meetingStartTime).toLocaleString() : '' }}</p>
    <p v-if="review.conclusion">评审结论：{{ review.conclusion }}{{ review.conclusionNotes ? ' · ' + review.conclusionNotes : '' }}</p>
    <div class="flex flex-wrap gap-2 pt-1">
      <button v-if="review.status === 'pending_review'" @click="drMeeting" class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:var(--nec-cyan)">预约会议</button>
      <button v-if="review.status === 'in_review'" @click="drConclude" class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:var(--nec-navy)">提交评审结论</button>
      <button v-if="review.status === 'rectifying'" @click="drRectify" class="text-xs px-3 py-1.5 rounded-lg text-white bg-orange-500">整改完成</button>
      <button v-if="review.status === 'bom_generating'" @click="drBom" class="text-xs px-3 py-1.5 rounded-lg text-white bg-purple-600">生成 BOM</button>
      <p v-if="!['pending_review','in_review','rectifying','bom_generating'].includes(review.status)" class="text-xs text-gray-400">当前状态暂无可执行操作</p>
    </div>
    <div class="pt-2 mt-2 border-t border-gray-100">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <p class="text-xs font-bold text-slate-700">询价（外购 / 标准件）</p>
        <div class="flex gap-2">
          <button @click="drGenerateInquiries" class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:var(--nec-cyan)">生成询价单</button>
          <button @click="drCompare" class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:var(--nec-navy)">比价建议</button>
        </div>
      </div>
      <div class="mt-2">
        <div v-if="compare" class="border border-indigo-100 rounded-lg bg-indigo-50/40 p-3 space-y-2">
          <p class="text-xs font-bold text-indigo-800">比价建议书（价格优先，交期超需求日期按 1.2 倍折算）</p>
          <p v-if="!(compare.materials || []).length" class="text-xs text-gray-400">暂无询价数据可比价</p>
          <div v-for="(m, i) in (compare.materials || [])" :key="i" class="text-xs border-t border-indigo-100 pt-1.5">
            <p class="font-bold text-slate-700">{{ m.materialName || m.bomItemId }}{{ m.materialCode ? `（${m.materialCode}）` : '' }}</p>
            <p v-for="(q, j) in m.quotes" :key="j" class="text-gray-600 pl-2">
              {{ q.supplierName }}：{{ q.price != null ? '¥' + q.price : '未报价' }}{{ q.deliveryDate ? ' · 交期 ' + q.deliveryDate : '' }}
              <span v-if="q.late" class="text-red-500">超期</span>
              <span v-if="q.inquiryId === m.recommendedInquiryId" class="text-green-600 font-bold">★ 推荐</span>
              <span v-if="q.inquiryId === m.lowestPriceInquiryId && q.inquiryId !== m.recommendedInquiryId" class="text-blue-600">最低价</span>
              <span v-if="q.inquiryId === m.shortestDeliveryInquiryId" class="text-teal-600">最短交期</span>
            </p>
            <p v-if="m.reason" class="text-indigo-700 pl-2 mt-0.5">建议：{{ m.reason }}</p>
          </div>
        </div>
      </div>
      <div class="mt-2 space-y-2">
        <p v-if="inqError" class="text-xs text-red-500">询价单加载失败：{{ inqError }}</p>
        <p v-else-if="inquiries && !inquiries.length" class="text-xs text-gray-400">暂无询价单，点击「生成询价单」从 BOM 外购/标准件物料生成</p>
        <div v-for="q in (inquiries ?? [])" :key="q.inquiryId" class="border border-gray-100 rounded-lg p-2.5 bg-gray-50/50">
          <div class="flex items-start justify-between gap-2 flex-wrap">
            <p class="text-xs">
              <span class="font-bold text-slate-700">{{ q.inquiryId }}</span>
              <span class="text-gray-500"> {{ q.materialName || q.bomItemId }}{{ q.materialCode ? `（${q.materialCode}）` : '' }}{{ q.specification ? ' · ' + q.specification : '' }}</span>
            </p>
            <span class="text-[10px] px-2 py-0.5 rounded-full" :class="inqStatus(q.status).cls">{{ inqStatus(q.status).label }}</span>
          </div>
          <p class="text-xs text-gray-500 mt-1">
            供应商 {{ q.supplierName }} · 数量 {{ q.quantity }}{{ q.requiredDate ? ' · 需求 ' + q.requiredDate : '' }}
            <template v-if="q.price != null"> · <span class="font-bold text-slate-700">¥{{ q.price }}</span></template>{{ q.deliveryDate ? ' · 交期 ' + q.deliveryDate : '' }}
          </p>
          <div v-if="q.status === 'sent'" class="flex flex-wrap items-center gap-1.5 mt-1.5">
            <input v-model="quoteFormOf(q).supplier" placeholder="供应商" class="text-xs border border-gray-200 rounded px-2 py-1 w-24">
            <input v-model="quoteFormOf(q).price" placeholder="报价(元)" type="number" min="0" step="0.01" class="text-xs border border-gray-200 rounded px-2 py-1 w-20">
            <input v-model="quoteFormOf(q).deliveryDate" placeholder="交期" type="date" class="text-xs border border-gray-200 rounded px-2 py-1">
            <button @click="drQuoteSubmit(q.inquiryId)" class="text-xs px-2 py-1 rounded text-white" style="background:var(--nec-cyan)">回填报价</button>
          </div>
          <button v-if="q.status === 'quoted'" @click="drSelectSupplier(q.materialCode || q.bomItemId, q.inquiryId)" class="text-xs px-2 py-1 rounded text-white bg-green-600">选定</button>
        </div>
      </div>
    </div>
    <p class="text-xs" :class="tipWarn ? 'text-amber-600' : tipOk ? 'text-green-600' : 'text-red-500'">
      {{ tip }}
      <button v-if="noBom" @click="drBom" class="ml-1 px-2 py-0.5 rounded text-white bg-purple-600">去生成 BOM</button>
    </p>
  </div>
</template>
