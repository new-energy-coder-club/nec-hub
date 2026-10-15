<script setup lang="ts">
// 提交视图：评审单表单 + 规格参数编辑器 + 文件上传 + 草稿自动保存
import { ref } from 'vue'
import {
  store,
  addSpecRow,
  removeSpecRow,
  applySpecTemplate,
  insertDesignTemplate,
  uploadFiles,
  removeFile,
  formatSize,
  saveDraft,
  restoreDraft,
  discardDraft,
  scheduleDraftSave,
  setFieldError,
  onDesignerOverride,
  submitReview,
} from '../store'

const fileInput = ref<HTMLInputElement | null>(null)
const designNotesEl = ref<HTMLTextAreaElement | null>(null)
const dragOver = ref(false)

function onFormInput(e: Event) {
  const t = e.target as HTMLInputElement | null
  if (t?.classList?.contains('field-error')) return
  if (t?.name) setFieldError(t.name, '')
  scheduleDraftSave()
}

function onPickFiles() {
  const input = fileInput.value
  if (!input?.files) return
  uploadFiles(input.files)
  input.value = ''
}

function onDrop(e: DragEvent) {
  if (e.dataTransfer?.files) uploadFiles(e.dataTransfer.files)
}

function onInsertTemplate() {
  insertDesignTemplate()
  designNotesEl.value?.focus()
}
</script>

<template>
  <section id="view-submit">
    <div class="nec-card p-5 sm:p-7">
      <div class="flex items-start justify-between flex-wrap gap-2 mb-1">
        <div>
          <h2 class="text-lg font-bold text-nec-ink">提交硬件评审单</h2>
          <p class="mono text-xs text-nec-gray tracking-wider">HARDWARE REVIEW SUBMISSION</p>
        </div>
        <span id="draft-status" class="mono text-xs text-nec-gray self-center">{{ store.draftStatus }}</span>
      </div>

      <!-- 草稿恢复提示 -->
      <div v-if="store.draftBanner" class="rounded-lg p-3 mb-4 flex items-center justify-between flex-wrap gap-2" style="background:var(--nec-royal-100);border:1px solid var(--nec-line)">
        <p class="text-sm text-nec-navy">检测到上次未完成的草稿<span class="mono text-xs text-nec-gray ml-1">{{ store.draftTime }}</span></p>
        <div class="flex gap-2">
          <button type="button" class="text-sm font-medium px-3 py-1 rounded-lg text-white" style="background:var(--nec-royal)" @click="restoreDraft()">恢复草稿</button>
          <button type="button" class="text-sm px-3 py-1 rounded-lg link" @click="discardDraft()">丢弃</button>
        </div>
      </div>

      <form id="submit-form" novalidate class="space-y-5 mt-4" @submit.prevent="submitReview()" @input="onFormInput">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="req block text-sm font-medium text-nec-navy mb-1">项目编号</label>
            <input type="text" name="projectId" v-model="store.form.projectId" class="mono w-full rounded-lg border border-nec-line px-3 py-2.5 text-sm" :class="{ 'input-invalid': store.fieldErrors.projectId }" placeholder="示例：PRJ-2026-001" />
            <p v-show="store.fieldErrors.projectId" class="field-error" data-for="projectId">{{ store.fieldErrors.projectId }}</p>
          </div>
          <div>
            <label class="req block text-sm font-medium text-nec-navy mb-1">硬件名称</label>
            <input type="text" name="hardwareName" v-model="store.form.hardwareName" class="w-full rounded-lg border border-nec-line px-3 py-2.5 text-sm" :class="{ 'input-invalid': store.fieldErrors.hardwareName }" placeholder="主控板 / 激光雷达 / 驱动电机" />
            <p v-show="store.fieldErrors.hardwareName" class="field-error" data-for="hardwareName">{{ store.fieldErrors.hardwareName }}</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-nec-navy mb-1">硬件类型</label>
            <select name="hardwareType" v-model="store.form.hardwareType" class="w-full rounded-lg border border-nec-line px-3 py-2.5 text-sm bg-white">
              <option value="controller">控制器</option>
              <option value="sensor">传感器</option>
              <option value="actuator">执行器</option>
              <option value="motor">电机/驱动</option>
              <option value="power">电源/电池</option>
              <option value="communication">通信模块</option>
              <option value="structure">结构件</option>
              <option value="other">其他</option>
            </select>
          </div>
          <div>
            <label class="req block text-sm font-medium text-nec-navy mb-1">硬件版本</label>
            <input type="text" name="hardwareVersion" v-model="store.form.hardwareVersion" class="mono w-full rounded-lg border border-nec-line px-3 py-2.5 text-sm" :class="{ 'input-invalid': store.fieldErrors.hardwareVersion }" placeholder="V1.0" />
            <p v-show="store.fieldErrors.hardwareVersion" class="field-error" data-for="hardwareVersion">{{ store.fieldErrors.hardwareVersion }}</p>
          </div>
          <div class="md:col-span-2">
            <label class="req block text-sm font-medium text-nec-navy mb-1">设计负责人</label>
            <div class="flex items-center gap-2 flex-wrap">
              <span id="designer-chip" class="inline-flex items-center gap-2 rounded-lg border border-nec-line bg-white px-3 py-2 text-sm text-nec-ink">
                <img v-if="store.designerAvatar" :src="store.designerAvatar" class="w-5 h-5 rounded-full" alt="" />
                <span id="designer-name" :class="{ 'text-nec-gray': store.designerGray }">{{ store.designerName }}</span>
              </span>
              <details class="text-xs text-nec-gray">
                <summary class="link cursor-pointer select-none">代他人提交</summary>
                <input type="text" id="designer-override" v-model="store.designerOverride" class="mono mt-2 w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="对方 open_id（ou_ 开头），仅代提交时填写" @input="onDesignerOverride" />
              </details>
            </div>
            <p v-show="store.fieldErrors.designerId" class="field-error" data-for="designerId">{{ store.fieldErrors.designerId }}</p>
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="block text-sm font-medium text-nec-navy">规格参数</label>
            <button type="button" id="spec-template-btn" class="text-xs link" @click="applySpecTemplate()">按类型填充常用参数</button>
          </div>
          <div class="rounded-lg border border-nec-line overflow-hidden">
            <div class="hidden sm:grid grid-cols-12 gap-2 px-3 py-2 text-xs text-nec-gray" style="background:var(--nec-fog)">
              <span class="col-span-4">参数名</span><span class="col-span-4">参数值</span><span class="col-span-3">备注</span><span class="col-span-1"></span>
            </div>
            <div id="spec-rows">
              <div v-for="(row, i) in store.specRows" :key="i" class="spec-row grid grid-cols-12 gap-2 px-3 py-2 items-center" style="border-top:1px solid var(--nec-line)">
                <input type="text" v-model="row.key" class="spec-key col-span-4 rounded border border-nec-line px-2 py-1.5 text-sm" placeholder="参数名" />
                <input type="text" v-model="row.value" class="spec-value col-span-4 rounded border border-nec-line px-2 py-1.5 text-sm" placeholder="参数值" />
                <input type="text" v-model="row.note" class="spec-note col-span-3 rounded border border-nec-line px-2 py-1.5 text-sm" placeholder="备注" />
                <button type="button" class="col-span-1 text-nec-gray hover:text-red-600 text-lg leading-none" title="删除本行" @click="removeSpecRow(i)">×</button>
              </div>
            </div>
          </div>
          <button type="button" class="mt-2 text-xs link" @click="addSpecRow()">+ 添加参数行</button>
        </div>

        <div>
          <label class="req block text-sm font-medium text-nec-navy mb-1">硬件资料</label>
          <div
            id="file-drop"
            class="dropzone p-5 text-center"
            :class="{ dragover: dragOver, 'input-invalid': store.fieldErrors.hardwareFiles }"
            @click="fileInput?.click()"
            @dragenter.prevent="dragOver = true"
            @dragover.prevent="dragOver = true"
            @dragleave.prevent="dragOver = false"
            @drop.prevent="dragOver = false; onDrop($event)"
          >
            <p class="text-sm text-nec-navy font-medium">拖拽文件到这里，或 <span class="link">点击选择</span></p>
            <p class="mono text-xs text-nec-gray mt-1">PDF / XLSX / ZIP / DXF / STEP 等，单文件 ≤ 10MB，可多选</p>
            <input ref="fileInput" type="file" multiple class="hidden"
              accept=".pdf,.xlsx,.xls,.csv,.zip,.doc,.docx,.pptx,.png,.jpg,.jpeg,.dxf,.step,.stp"
              @change="onPickFiles" />
          </div>
          <div id="file-list" class="mt-2 space-y-2">
            <div v-for="(f, i) in store.uploadedFiles" :key="i" class="flex items-center gap-2 rounded-lg border border-nec-line bg-white px-3 py-2 text-sm">
              <span class="mono text-xs text-nec-royal font-bold">FILE</span>
              <span class="text-nec-ink truncate">{{ f.name }}</span>
              <span class="mono text-xs text-nec-gray flex-none">{{ f.uploading ? '上传中…' : formatSize(f.size || 0) }}</span>
              <button type="button" class="ml-auto text-nec-gray hover:text-red-600 leading-none" title="移除" @click="removeFile(i)">×</button>
            </div>
          </div>
          <p v-show="store.fieldErrors.hardwareFiles" class="field-error" data-for="hardwareFiles">{{ store.fieldErrors.hardwareFiles }}</p>
          <details class="mt-2 text-xs text-nec-gray">
            <summary class="link cursor-pointer select-none">批量导入（高级：名称|文件token|链接，每行一条）</summary>
            <textarea id="files-batch" v-model="store.filesBatch" rows="2" class="mono mt-2 w-full rounded-lg border border-nec-line px-3 py-2 text-sm" placeholder="原理图 V1.0.pdf|file_token_xxx&#10;BOM 表.xlsx"></textarea>
          </details>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="req block text-sm font-medium text-nec-navy">设计说明</label>
            <button type="button" class="text-xs link" @click="onInsertTemplate">插入模板</button>
          </div>
          <textarea ref="designNotesEl" name="designNotes" v-model="store.form.designNotes" rows="4" class="w-full rounded-lg border border-nec-line px-3 py-2.5 text-sm" :class="{ 'input-invalid': store.fieldErrors.designNotes }" placeholder="选型理由、关键设计点、风险与验证计划。可点右上角「插入模板」获取提纲。"></textarea>
          <p v-show="store.fieldErrors.designNotes" class="field-error" data-for="designNotes">{{ store.fieldErrors.designNotes }}</p>
        </div>

        <div class="flex items-center justify-end gap-3 pt-2" style="border-top:1px solid var(--nec-line)">
          <p id="submit-result" class="mr-auto text-sm" :style="store.submitResult.text ? { color: store.submitResult.ok ? '#177A4C' : '#C22E2E' } : {}">{{ store.submitResult.text }}</p>
          <button type="button" class="nav-btn text-sm font-medium px-4 py-2 rounded-lg" @click="saveDraft(true)">保存草稿</button>
          <button type="submit" class="btn-primary text-sm font-medium px-5 py-2 rounded-lg" :disabled="store.submitting">{{ store.submitting ? '提交中…' : '提交评审单' }}</button>
        </div>
      </form>
    </div>
  </section>
</template>
