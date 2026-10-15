<script setup lang="ts">
// 提交图纸审批表单：外协加工显成本、加急显原因、驳回重提横幅（沿用图号 + 版本 +0.1）
import { ref, computed, nextTick } from 'vue'
import { store, cancelResubmit, submitDrawing } from '../store'

const errorsEl = ref<HTMLElement | null>(null)

const showCost = computed(() => store.form.processType === '外协加工')
const showUrgentReason = computed(() => store.form.urgency === '加急')

async function onSubmit() {
  const result = await submitDrawing()
  if (result === 'invalid') {
    await nextTick()
    errorsEl.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}
</script>

<template>
  <section id="view-submit">
    <div class="nec-card p-5">
      <h2 class="text-lg font-bold text-nec-ink mb-1">提交图纸审批</h2>
      <p class="mono text-xs text-nec-gray mb-4 tracking-wider">DRAWING APPROVAL SUBMISSION</p>

      <!-- 重提模式横幅 -->
      <div v-if="store.resubmitFrom" id="resubmit-banner" class="rounded-lg p-3 mb-4 text-sm" style="background:#E8ECFB;border:1px solid var(--nec-royal)">
        <span class="font-medium text-nec-royal">驳回重提模式：</span>
        <span class="text-nec-navy">沿用图号 <span class="mono">{{ store.resubmitFrom.fields['图号'] || '' }}</span>，版本自动 +0.1。旧版本行保留只读，不会被覆盖。</span>
        <button type="button" class="link ml-2 text-xs hover:underline" @click="cancelResubmit">取消重提，改为新图</button>
      </div>

      <form id="submit-form" class="space-y-4" @submit.prevent="onSubmit">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-nec-navy mb-1">图纸名称 <span class="text-red-500">*</span></label>
            <input type="text" v-model="store.form.drawingName" required class="w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="6014 电机转接板" />
          </div>
          <div>
            <label class="block text-sm font-medium text-nec-navy mb-1">图号</label>
            <input type="text" id="drawing-no-preview" disabled :value="store.drawingNoPreview" class="mono w-full rounded-lg border border-nec-line px-3 py-2 text-sm bg-nec-fog text-nec-gray" />
            <p class="text-xs text-nec-gray mt-1">新图提交后自动分配（MECH-年-序号），底表保证唯一。</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-nec-navy mb-1">版本 <span class="text-red-500">*</span></label>
            <input type="text" v-model="store.form.version" required class="mono w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="V1.0" />
          </div>
          <div>
            <label class="block text-sm font-medium text-nec-navy mb-1">所属机构 <span class="text-red-500">*</span></label>
            <select v-model="store.form.mechanism" required class="w-full rounded-lg border border-nec-line px-3 py-2 text-sm bg-white">
              <option value="">请选择</option>
              <option>底盘</option>
              <option>机械臂</option>
              <option>发射机构</option>
              <option>夹取机构</option>
              <option>其他</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-nec-navy mb-1">材料与工艺 <span class="text-red-500">*</span></label>
            <input type="text" v-model="store.form.material" required class="w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="7075 铝合金 / CNC" />
          </div>
          <div>
            <label class="block text-sm font-medium text-nec-navy mb-1">加工方式 <span class="text-red-500">*</span></label>
            <select v-model="store.form.processType" id="process-type" required class="w-full rounded-lg border border-nec-line px-3 py-2 text-sm bg-white">
              <option>自加工</option>
              <option>外协加工</option>
            </select>
          </div>
          <div v-show="showCost" id="cost-wrap">
            <label class="block text-sm font-medium text-nec-navy mb-1">预估加工费（元） <span class="text-red-500">*</span></label>
            <input type="number" v-model="store.form.cost" id="cost-input" min="0.01" step="0.01" class="mono w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="0.00" />
            <p class="text-xs text-nec-gray mt-1">≥ 500 元会自动提醒队长会签复核。</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-nec-navy mb-1">紧急程度 <span class="text-red-500">*</span></label>
            <select v-model="store.form.urgency" id="urgency" required class="w-full rounded-lg border border-nec-line px-3 py-2 text-sm bg-white">
              <option>常规</option>
              <option>加急</option>
            </select>
          </div>
          <div v-show="showUrgentReason" id="urgent-reason-wrap" class="md:col-span-2">
            <label class="block text-sm font-medium text-nec-navy mb-1">加急原因 <span class="text-red-500">*</span></label>
            <input type="text" v-model="store.form.urgentReason" id="urgent-reason" class="w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="如：周六赛前必须完成装配" />
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-nec-navy mb-1">图纸文件 <span class="text-red-500">*</span>（每行一个，≥1）</label>
          <textarea v-model="store.form.files" id="files-input" rows="3" required class="mono w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="https://xxx.feishu.cn/drive/xxx.pdf&#10;adapter_plate_v2.step"></textarea>
          <p class="text-xs text-nec-gray mt-1">PDF / STEP；大文件请先传飞书云盘后粘贴链接。</p>
        </div>
        <div v-if="store.formErrors.length" id="form-errors" ref="errorsEl" class="rounded-lg p-3 text-sm" style="background:#FDECEC;border:1px solid #F0A8A8;color:#B02323"><b>请先补全：</b>{{ store.formErrors.join('；') }}</div>
        <div class="flex justify-end">
          <button type="submit" id="submit-btn" :disabled="store.submitting" class="btn-primary text-sm font-medium px-5 py-2 rounded-lg">{{ store.submitting ? '提交中…' : '提交审批' }}</button>
        </div>
      </form>
      <p v-if="store.submitError" id="submit-result" class="mt-3 text-sm text-red-600">{{ store.submitError }}</p>
    </div>
  </section>
</template>
