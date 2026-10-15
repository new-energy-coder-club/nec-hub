<script setup lang="ts">
// 合同文件选择器：① 本地上传（/api/approvals/upload，XHR 实时进度）② URL 粘贴 ③ 飞书端说明卡
// 提交时由父组件把 upload 型映射为 {name, token:'r2:'+key}，url 型映射为 {name, url}
import { ref } from 'vue'
import { store, formatSize, fileIcon, filePreviewHref } from '../store'

export type FileDraft =
  | { kind: 'upload'; name: string; size: number; key: string }
  | { kind: 'url'; name: string; url: string }
interface UploadingEntry { name: string; size: number; progress: number | null }

const props = withDefaults(defineProps<{ modelValue: FileDraft[]; error?: string; disabled?: boolean }>(),
  { error: '', disabled: false })
const emit = defineEmits<{ (e: 'update:modelValue', v: FileDraft[]): void }>()

const uploading = ref<UploadingEntry[]>([])
const urlText = ref('')
const uploadError = ref('')
const urlError = ref('')
const dragover = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function ul() { return props.modelValue as FileDraft[] }
function sync(v: FileDraft[]) {
  emit('update:modelValue', v)
  uploadError.value = ''
}

/* ---------- 上传：XHR + progress 事件（401 沿用 store.authFailed 标记） ---------- */
function uploadOne(file: File, onProgress: (p: number | null) => void): Promise<{ key: string; name: string; size: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/approvals/upload')
    xhr.upload.onprogress = (e) => {
      onProgress(e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null)
    }
    xhr.onload = () => {
      let data: any = {}
      try { data = JSON.parse(xhr.responseText) } catch { /* ignore */ }
      if (xhr.status === 401) {
        store.authFailed = true
        reject(new Error(data.error || '请先登录'))
        return
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(data.error || `HTTP ${xhr.status}`))
        return
      }
      const saved = data.files?.[0]
      if (!saved?.key) {
        reject(new Error('上传接口未返回文件 key'))
        return
      }
      resolve({ key: saved.key, name: saved.name || file.name, size: saved.size ?? file.size })
    }
    xhr.onerror = () => reject(new Error('网络错误，上传失败'))
    const fd = new FormData()
    fd.append('file', file)
    xhr.send(fd)
  })
}

async function uploadFiles(fileList: FileList | null) {
  if (!fileList || props.disabled) return
  for (const file of Array.from(fileList)) {
    if (file.size > 10 * 1024 * 1024) {
      uploadError.value = `「${file.name}」超过 10MB 上限`
      continue
    }
    const ent: UploadingEntry = { name: file.name, size: file.size, progress: null }
    uploading.value.push(ent)
    try {
      const saved = await uploadOne(file, (p) => {
        ent.progress = p === null ? p : Math.max(2, p)
      })
      sync([...ul(), { kind: 'upload', name: saved.name, size: saved.size, key: saved.key }])
    } catch (err: any) {
      uploadError.value = `「${file.name}」上传失败：${err.message}`
    } finally {
      uploading.value = uploading.value.filter(e => e !== ent)
    }
  }
}

function onDrop(e: DragEvent) {
  dragover.value = false
  uploadFiles(e.dataTransfer?.files || null)
}
function onPick() {
  if (!props.disabled) fileInput.value?.click()
}
function onFileChange() {
  uploadFiles(fileInput.value?.files || null)
  if (fileInput.value) fileInput.value.value = ''
}

/* ---------- URL 粘贴 ---------- */
function urlName(u: string): string {
  try {
    const path = new URL(u).pathname
    const tail = path.split('/').filter(Boolean).pop()
    if (tail) return decodeURIComponent(tail)
  } catch { /* ignore */ }
  return u
}
function addUrl() {
  urlError.value = ''
  const u = urlText.value.trim()
  if (!u) return
  if (!/^https?:\/\//i.test(u)) {
    urlError.value = '请输入 http(s):// 开头的链接'
    return
  }
  sync([...ul(), { kind: 'url', name: urlName(u), url: u }])
  urlText.value = ''
}

function removeFile(i: number) {
  sync(ul().filter((_, idx) => idx !== i))
}

/* 卡片点击：upload → /api/contract-approval/file 预览；url → 新窗口打开 */
function openFile(f: FileDraft) {
  if (f.kind === 'url') {
    window.open(f.url, '_blank', 'noopener')
    return
  }
  const href = filePreviewHref({ name: f.name, token: 'r2:' + f.key, size: f.size })
  if (href) window.open(href, '_blank', 'noopener')
}
</script>

<template>
  <div id="cs-files" class="rounded-lg border border-nec-line p-3" :class="{ 'input-invalid': error }">
    <div class="cs-file-actions">
      <!-- ① 本地文件上传 -->
      <div
        class="cs-upload-zone"
        :class="{ dragover, 'opacity-60': disabled }"
        @click="onPick" @dragenter.prevent="dragover = true" @dragover.prevent="dragover = true"
        @dragleave.prevent="dragover = false" @drop.prevent="onDrop"
      >
        <p class="text-sm text-nec-navy font-medium">拖拽文件到这里，或 <span class="link">点击选择</span></p>
        <p class="mono text-xs text-nec-gray mt-1">PDF / DOCX / XLSX，单文件 ≤ 10MB，可多选</p>
        <input type="file" ref="fileInput" multiple class="hidden" accept=".pdf,.docx,.xlsx" @change="onFileChange" />
      </div>

      <!-- ② URL 粘贴 -->
      <div class="cs-url-zone">
        <div class="flex gap-2">
          <input v-model="urlText" :disabled="disabled" type="text" class="cs-picker-q flex-1"
            placeholder="粘贴合同文件链接（http/https）" @keydown.enter.prevent="addUrl" />
          <button type="button" class="cs-add-url-btn" :disabled="disabled || !urlText.trim()" @click="addUrl">添加</button>
        </div>
        <p class="field-error" :class="{ hidden: !urlError }">{{ urlError }}</p>
      </div>
    </div>

    <!-- 上传中（进度条） -->
    <div v-if="uploading.length" class="mt-2 space-y-2">
      <div v-for="(u, i) in uploading" :key="'up-' + i" class="rounded-lg border border-nec-line bg-white px-3 py-2">
        <div class="flex items-center gap-2 text-sm">
          <span class="mono text-xs text-nec-cyan font-bold">↑</span>
          <span class="text-nec-ink truncate">{{ u.name }}</span>
          <span class="mono text-xs text-nec-gray flex-none">{{ formatSize(u.size) }}</span>
        </div>
        <div class="cs-up-progress mt-1.5">
          <div v-if="u.progress === null" class="cs-up-indeterminate"></div>
          <div v-else class="cs-up-bar" :style="{ width: u.progress + '%' }"></div>
        </div>
      </div>
    </div>
    <p class="field-error" :class="{ hidden: !uploadError }">{{ uploadError }}</p>

    <!-- 文件卡片 -->
    <div v-if="ul().length" class="mt-2 space-y-2">
      <div v-for="(f, i) in ul()" :key="i" class="cs-file-card" role="button" :title="f.kind === 'upload' ? '点击预览' : '点击新窗口打开'" @click="openFile(f)">
        <span class="cs-file-icon">{{ fileIcon(f.name) }}</span>
        <div class="min-w-0">
          <p class="cs-file-name truncate">{{ f.name }}</p>
          <p class="cs-file-sub mono truncate">{{ f.kind === 'upload' ? formatSize(f.size) : f.url }}</p>
        </div>
        <button type="button" class="cs-file-x" title="移除" @click.stop="removeFile(i)">×</button>
      </div>
    </div>

    <!-- ③ 飞书端说明卡（不提供死按钮） -->
    <div class="cs-feishu-tip">飞书端上传：在飞书应用内使用原入口</div>

    <p class="field-error" :class="{ hidden: !error }" data-for="contractFiles">{{ error }}</p>
  </div>
</template>