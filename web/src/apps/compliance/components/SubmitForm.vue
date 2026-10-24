<script setup lang="ts">
// STEP 01 提交合规申请：表单校验（required + conditional）→ POST /api/approvals → 成功卡片
import { computed, nextTick, ref, watch } from 'vue'
import { store, missingItems, sponsorReqMissing, submitCompliance, resetForm } from '../store'

const titleInput = ref<HTMLInputElement | null>(null)
const successCard = ref<HTMLElement | null>(null)

const submitStatus = computed(() => {
  if (store.submitting) return '发起审批中…'
  if (store.submitError) return '❌ 提交失败：' + store.submitError
  return missingItems.value.length ? '待补齐：' + missingItems.value.join('、') : '✅ 信息完整，可以提交'
})

// 表单一经编辑即清掉上次的提交失败提示
watch(() => ({ ...store.form }), () => { store.submitError = '' })

async function onSubmit() {
  await submitCompliance()
  if (store.success.visible) {
    await nextTick()
    successCard.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

function onAgain() {
  store.success.visible = false
  resetForm()
  titleInput.value?.focus()
}
</script>

<template>
  <section class="nec-card p-5">
    <div class="mb-4">
      <span class="step-badge">STEP 01</span>
      <h2 class="text-lg font-bold text-nec-ink mt-1">提交合规申请</h2>
      <p class="mono text-xs text-nec-gray tracking-wider">COMPLIANCE SUBMISSION → 审批引擎（状态机落表 + 群通知）</p>
    </div>

    <div class="space-y-4">
      <div>
        <span class="block text-sm font-medium text-nec-navy">合规类型 <span class="text-red-500">*</span></span>
        <div class="mt-2 flex flex-wrap gap-2" id="f-ctype">
          <label class="radio-pill"><input type="radio" name="ctype" value="对外发布" v-model="store.form.ctype" />对外发布</label>
          <label class="radio-pill"><input type="radio" name="ctype" value="商务合作" v-model="store.form.ctype" />商务合作</label>
          <label class="radio-pill"><input type="radio" name="ctype" value="授权使用" v-model="store.form.ctype" />授权使用</label>
          <label class="radio-pill"><input type="radio" name="ctype" value="其他" v-model="store.form.ctype" />其他</label>
        </div>
      </div>

      <label class="block text-sm font-medium text-nec-navy">标题 <span class="text-red-500">*</span>
        <input id="f-title" ref="titleInput" class="field-input" v-model="store.form.title" placeholder="如：公众号推文《赛季中期总结》发布申请" />
      </label>

      <label class="block text-sm font-medium text-nec-navy">内容说明 <span class="text-red-500">*</span>
        <textarea id="f-content" rows="4" class="field-input" v-model="store.form.content" placeholder="拟发布/合作的内容概述、涉及的平台与对象、需要审批人重点确认的点"></textarea>
      </label>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        <label class="block text-sm font-medium text-nec-navy">计划发布时间 <span class="text-red-500">*</span>
          <input id="f-publish-at" type="datetime-local" class="field-input" v-model="store.form.publishAt" />
        </label>
        <div>
          <span class="block text-sm font-medium text-nec-navy">赞助商相关 <span class="text-red-500">*</span></span>
          <div class="mt-2 flex gap-2" id="f-sponsor">
            <label class="radio-pill"><input type="radio" name="sponsor" value="是" v-model="store.form.sponsor" />是</label>
            <label class="radio-pill"><input type="radio" name="sponsor" value="否" v-model="store.form.sponsor" />否</label>
          </div>
        </div>
      </div>

      <label class="block text-sm font-medium text-nec-navy" id="f-sponsor-req-label">赞助商要求（赞助商相关=是 时必填）
        <textarea id="f-sponsor-req" rows="3" class="field-input" :class="{ invalid: sponsorReqMissing }" v-model="store.form.sponsorReq" placeholder="如：推文需带赞助商 LOGO 与指定口播文案，发布前需赞助商确认"></textarea>
        <span id="f-sponsor-req-hint" v-show="sponsorReqMissing" class="text-xs text-red-600 font-normal">已选择「赞助商相关 = 是」，请填写赞助商要求</span>
      </label>
    </div>

 <div class="mt-5 pt-4 flex flex-wrap items-center gap-3 border-t border-nec-line">
      <button id="submit-btn" class="btn-primary" :disabled="store.submitting || missingItems.length > 0" @click="onSubmit">{{ store.submitting ? '提交中…' : '提交合规申请' }}</button>
      <span id="submit-status" aria-live="polite" class="text-xs text-nec-gray">{{ submitStatus }}</span>
    </div>

    <!-- 成功卡片 -->
    <div id="success-card" v-show="store.success.visible" ref="successCard" class="mt-4 rounded-lg p-5" style="border:1.5px solid #16A34A;background:#F0FDF4">
      <div class="flex items-center gap-2 text-green-700 font-bold">✅ 已提交，审批中</div>
      <p class="mt-2 text-sm text-nec-ink">申请单号：<span id="success-id" class="mono font-black text-nec-navy">{{ store.success.id }}</span>
        <span class="ml-2">状态：<span id="success-status" class="mono font-black text-nec-navy">{{ store.success.status }}</span></span></p>
      <p class="mt-1 text-xs text-nec-gray">审批由队长/指导老师或运营、宣传组组长处理，结果将通过飞书群机器人通知；可在下方「我的申请」随时查看状态。</p>
      <button id="success-again" class="mt-3 text-sm link" @click="onAgain">再提交一条 →</button>
    </div>
  </section>
</template>
