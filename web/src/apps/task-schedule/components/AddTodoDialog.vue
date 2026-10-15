<script setup lang="ts">
// Add Todo 弹窗（原生 <dialog>，点遮罩关闭；打开时默认截止时间为本地当前时间）
import { ref, nextTick } from 'vue'
import type { TaskLine } from '../store'

const props = defineProps<{ lines: TaskLine[] }>()
const emit = defineEmits<{ (e: 'add', t: { title: string; date: string; line: string; note: string }): void }>()

const dlg = ref<HTMLDialogElement | null>(null)
const titleEl = ref<HTMLInputElement | null>(null)
const title = ref('')
const date = ref('')
const line = ref('')
const note = ref('')

function defaultDate() {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 16)
}

function open() {
  title.value = ''
  note.value = ''
  date.value = defaultDate()
  line.value = props.lines[0]?.id || ''
  dlg.value?.showModal()
  nextTick(() => titleEl.value?.focus())
}
function close() { dlg.value?.close() }
function onBackdropClick(e: MouseEvent) { if (e.target === dlg.value) close() }

function submit() {
  emit('add', { title: title.value.trim(), date: date.value, line: line.value, note: note.value.trim() })
  close()
}

defineExpose({ open })
</script>

<template>
  <dialog ref="dlg" class="bg-neutral-950 text-white border border-neutral-800 rounded-2xl p-6 w-[92vw] max-w-md" @click="onBackdropClick">
    <h2 class="text-lg font-bold mb-5">Add Todo</h2>
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <div>
        <label class="text-xs text-neutral-400 block mb-1.5">任务标题</label>
        <input ref="titleEl" v-model="title" required maxlength="80" placeholder="要做点什么？"
          class="w-full bg-black border border-neutral-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-white" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs text-neutral-400 block mb-1.5">截止时间</label>
          <input v-model="date" type="datetime-local" required
            class="w-full bg-black border border-neutral-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-white [color-scheme:dark]" />
        </div>
        <div>
          <label class="text-xs text-neutral-400 block mb-1.5">所属线路</label>
          <select v-model="line" class="w-full bg-black border border-neutral-700 rounded-lg pl-3 pr-9 py-2.5 text-sm focus:outline-none focus:border-white">
            <option v-for="l in lines" :key="l.id" :value="l.id" class="bg-black">{{ l.name }}</option>
          </select>
        </div>
      </div>
      <div>
        <label class="text-xs text-neutral-400 block mb-1.5">备注（可选）</label>
        <textarea v-model="note" rows="2" maxlength="300" placeholder="补充说明…"
          class="w-full bg-black border border-neutral-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-white resize-none"></textarea>
      </div>
      <div class="flex justify-end gap-3 mt-1">
        <button type="button"
          class="px-5 py-2 rounded-full text-sm border border-neutral-700 hover:border-neutral-400 transition"
          @click="close">取消</button>
        <button type="submit"
          class="px-5 py-2 rounded-full text-sm bg-white text-black font-semibold hover:bg-neutral-200 transition">添加</button>
      </div>
    </form>
  </dialog>
</template>
