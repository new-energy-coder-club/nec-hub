<script setup lang="ts">
// 询价（外购 / 标准件）面板：生成询价单、回填报价、比价建议、选定供应商
// 端点、提示文案、confirm/prompt 交互与原单文件版 dr* 函数逐一对应
import { ref, reactive, onMounted } from 'vue'
import { apiDr } from '@shared/api'
import { drInqStatus, type Inquiry, type CompareResult } from '../types'
import { confirmDialog } from '@shared/ui/feedback'

const props = defineProps<{ reviewId: string }>()

const inquiries = ref<Inquiry[] | null>(null)
const loadError = ref('')
const compare = ref<CompareResult | null>(null)
const tip = ref<{ ok: boolean; text: string } | null>(null)

// 回填报价草稿（key: inquiryId；重新加载询价单时重置，与原 innerHTML 重绘一致）
const quoteForms = reactive<Record<string, { supplier: string; price: string; deliveryDate: string }>>({})

async function load() {
  loadError.value = ''
  try {
    const list: Inquiry[] = await apiDr(`/${props.reviewId}/inquiries`)
    inquiries.value = list
    Object.keys(quoteForms).forEach(k => delete quoteForms[k])
    for (const q of list) {
      quoteForms[q.inquiryId] = {
        supplier: q.supplierName === '待定' ? '' : q.supplierName,
        price: '',
        deliveryDate: '',
      }
    }
  } catch (err) {
    loadError.value = (err as Error).message
  }
}

async function generate() {
  const requiredDate = prompt('需求日期（YYYY-MM-DD，可留空）：', '')
  if (requiredDate === null) return
  try {
    const data = await apiDr(`/${props.reviewId}/inquiries/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requiredDate: requiredDate.trim() || undefined }),
    })
    tip.value = { ok: true, text: `已生成 ${data.created.length} 张询价单` + (data.skipped.length ? `，跳过已存在 ${data.skipped.length} 项` : '') }
    load()
  } catch (err) {
    const msg = (err as Error).message
    tip.value = { ok: false, text: /尚无 BOM/.test(msg) ? '生成失败：' + msg + '（请先在上方「生成 BOM」）' : '生成失败：' + msg }
  }
}

async function quoteSubmit(q: Inquiry) {
  const f = quoteForms[q.inquiryId]
  const supplier = f.supplier.trim()
  const price = parseFloat(f.price)
  const deliveryDate = f.deliveryDate || undefined
  if (!supplier || !(price > 0)) {
    tip.value = { ok: false, text: '请填写供应商与大于 0 的报价' }
    return
  }
  try {
    await apiDr(`/inquiries/${q.inquiryId}/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ supplier, price, deliveryDate }),
    })
    tip.value = { ok: true, text: `询价单 ${q.inquiryId} 报价已回填` }
    load()
  } catch (err) {
    tip.value = { ok: false, text: '报价失败：' + (err as Error).message }
  }
}

async function runCompare() {
  try {
    compare.value = await apiDr(`/${props.reviewId}/inquiries/compare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
  } catch (err) {
    tip.value = { ok: false, text: '比价失败：' + (err as Error).message }
  }
}

async function selectSupplier(q: Inquiry) {
  const materialKey = q.materialCode || q.bomItemId
  if (!(await confirmDialog(`确认选定询价单 ${q.inquiryId} 的供应商？同物料其他报价将置为未中选`))) return
  try {
    await apiDr(`/${props.reviewId}/inquiries/compare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selections: { [materialKey]: q.inquiryId } }),
    })
    tip.value = { ok: true, text: `已选定 ${q.inquiryId}` }
    load()
    runCompare()
  } catch (err) {
    tip.value = { ok: false, text: '选定失败：' + (err as Error).message }
  }
}

onMounted(load)
</script>

<template>
  <div class="nec-card p-5">
    <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
      <div>
        <h3 class="text-sm font-bold text-nec-navy">询价（外购 / 标准件）</h3>
        <p class="mono text-[11px] text-nec-gray tracking-wider mt-0.5">INQUIRY &amp; COMPARISON</p>
      </div>
      <div class="flex gap-2">
        <button class="btn-accent text-xs px-3 py-1.5 rounded-lg" @click="generate">生成询价单</button>
        <button class="btn-primary text-xs px-3 py-1.5 rounded-lg" @click="runCompare">比价建议</button>
      </div>
    </div>

    <!-- 比价建议书 -->
    <div class="mb-2">
      <template v-if="compare">
        <p v-if="!compare.materials || !compare.materials.length" class="text-xs text-nec-gray">暂无询价数据可比价</p>
 <div v-else class="rounded-lg p-3 space-y-2 border border-nec-line bg-nec-royal-100">
          <p class="text-xs font-bold text-nec-navy">比价建议书（价格优先，交期超需求日期按 1.2 倍折算）</p>
 <div v-for="m in compare.materials" :key="m.bomItemId" class="text-xs pt-1.5 border-t border-nec-line">
            <p class="font-bold text-nec-ink">{{ m.materialName || m.bomItemId }}{{ m.materialCode ? `（${m.materialCode}）` : '' }}</p>
            <p v-for="q in m.quotes" :key="q.inquiryId" class="text-nec-gray pl-2">
              {{ q.supplierName }}：{{ q.price != null ? '¥' + q.price : '未报价' }}{{ q.deliveryDate ? ' · 交期 ' + q.deliveryDate : '' }}<span v-if="q.late" class="text-red-600"> 超期</span>
              <span v-if="q.inquiryId === m.recommendedInquiryId" class="font-bold" style="color:#177A4C"> ★ 推荐</span>
              <span v-if="q.inquiryId === m.lowestPriceInquiryId && q.inquiryId !== m.recommendedInquiryId" style="color:#1A2FA0"> 最低价</span>
              <span v-if="q.inquiryId === m.shortestDeliveryInquiryId" style="color:#0F7A72"> 最短交期</span>
            </p>
            <p v-if="m.reason" class="pl-2 mt-0.5" style="color:#1A2FA0">建议：{{ m.reason }}</p>
          </div>
        </div>
      </template>
    </div>

    <!-- 询价单列表 -->
    <div class="space-y-2">
      <p v-if="loadError" class="text-xs text-red-600">询价单加载失败：{{ loadError }}</p>
      <p v-else-if="inquiries && !inquiries.length" class="text-xs text-nec-gray">暂无询价单，点击「生成询价单」从 BOM 外购/标准件物料生成</p>
 <div v-for="q in inquiries || []" :key="q.inquiryId" class="rounded-lg p-3 border border-nec-line bg-nec-fog">
        <div class="flex items-start justify-between gap-2 flex-wrap">
          <p class="text-xs">
            <span class="mono font-bold text-nec-royal">{{ q.inquiryId }}</span>
            <span class="text-nec-gray"> {{ q.materialName || q.bomItemId }}{{ q.materialCode ? `（${q.materialCode}）` : '' }}{{ q.specification ? ' · ' + q.specification : '' }}</span>
          </p>
          <span class="status-badge" :style="drInqStatus(q.status).color">{{ drInqStatus(q.status).label }}</span>
        </div>
        <p class="text-xs text-nec-gray mt-1">
          供应商 {{ q.supplierName }} · 数量 {{ q.quantity }}{{ q.requiredDate ? ' · 需求 ' + q.requiredDate : '' }}
          <template v-if="q.price != null"> · <span class="mono font-bold text-nec-ink">¥{{ q.price }}</span></template>{{ q.deliveryDate ? ' · 交期 ' + q.deliveryDate : '' }}
        </p>
        <div v-if="q.status === 'sent' && quoteForms[q.inquiryId]" class="flex flex-wrap items-center gap-1.5 mt-2">
          <input v-model="quoteForms[q.inquiryId].supplier" placeholder="供应商" class="mono text-xs border border-nec-line rounded px-2 py-1 w-28" />
          <input v-model="quoteForms[q.inquiryId].price" placeholder="报价(元)" type="number" min="0" step="0.01" class="mono text-xs border border-nec-line rounded px-2 py-1 w-24" />
          <input v-model="quoteForms[q.inquiryId].deliveryDate" placeholder="交期" type="date" class="mono text-xs border border-nec-line rounded px-2 py-1" />
          <button class="btn-accent text-xs px-2.5 py-1 rounded" @click="quoteSubmit(q)">回填报价</button>
        </div>
        <button v-if="q.status === 'quoted'" class="mt-2 text-xs px-2.5 py-1 rounded text-white" style="background:#177A4C" @click="selectSupplier(q)">选定</button>
      </div>
    </div>

    <p v-if="tip" class="mt-2 text-xs" :class="tip.ok ? 'text-green-600' : 'text-red-600'">{{ tip.text }}</p>
  </div>
</template>
