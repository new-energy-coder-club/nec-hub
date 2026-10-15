<script setup lang="ts">
// 提交图纸报告书表单（原 #view-submit）：字段、校验、提交报文与原单文件版一致
import { reactive, ref } from 'vue'
import { apiDr } from '@shared/api'

const emit = defineEmits<{ (e: 'submitted'): void }>()

const form = reactive({
  projectId: '',
  machineName: '',
  drawingVersion: '',
  designerId: '',
  designNotes: '',
})
const result = ref<{ ok: boolean; text: string } | null>(null)

async function onSubmit() {
  try {
    const data = await apiDr('/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: form.projectId,
        machineName: form.machineName,
        drawingVersion: form.drawingVersion,
        designerId: form.designerId,
        drawingFiles: [],
        designNotes: form.designNotes,
      }),
    })
    result.value = { ok: true, text: `提交成功：${data.reviewId}` }
    Object.keys(form).forEach(k => { (form as Record<string, string>)[k] = '' })
    emit('submitted')
  } catch (err) {
    result.value = { ok: false, text: '失败：' + (err as Error).message }
  }
}
</script>

<template>
  <section id="view-submit">
    <div class="nec-card p-5">
      <h2 class="text-lg font-bold text-nec-ink mb-1">提交图纸报告书</h2>
      <p class="mono text-xs text-nec-gray mb-4 tracking-wider">DRAWING REVIEW SUBMISSION</p>
      <form id="submit-form" class="space-y-4" @submit.prevent="onSubmit">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-nec-navy mb-1">项目编号</label>
            <input type="text" v-model="form.projectId" required class="mono w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="PRJ-2026-001" />
          </div>
          <div>
            <label class="block text-sm font-medium text-nec-navy mb-1">机型名称</label>
            <input type="text" v-model="form.machineName" required class="w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="R1 底盘" />
          </div>
          <div>
            <label class="block text-sm font-medium text-nec-navy mb-1">图纸版本</label>
            <input type="text" v-model="form.drawingVersion" required class="mono w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="V1.0" />
          </div>
          <div>
            <label class="block text-sm font-medium text-nec-navy mb-1">设计负责人 open_id</label>
            <input type="text" v-model="form.designerId" required class="mono w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="ou_xxx" />
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-nec-navy mb-1">设计说明</label>
          <textarea v-model="form.designNotes" rows="3" required class="w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="关键设计参数、变更点"></textarea>
        </div>
        <div class="flex justify-end">
          <button type="submit" class="btn-primary text-sm font-medium px-5 py-2 rounded-lg">提交评审单</button>
        </div>
      </form>
      <p v-if="result" id="submit-result" class="mt-3 text-sm" :class="result.ok ? 'text-green-600' : 'text-red-600'">{{ result.text }}</p>
    </div>
  </section>
</template>
