<script setup lang="ts">
// 签署表单：勾选同意 → 提交 /api/cla/sign → 成功后面板与荣誉榜联动
import { computed, reactive, ref, watch } from 'vue'
import { fmtDate, type ClaSignature } from '../agreement'
import { store, loadSigners } from '../store'

const props = withDefaults(defineProps<{ prefillName?: string }>(), { prefillName: '' })

const form = reactive({ name: '', github: '', email: '', org: '' })
const agree = ref(false)
const submitting = ref(false)
const msg = ref('')
const msgKind = ref<'idle' | 'ok' | 'warn'>('idle')

// 已登录则预填姓名（仅当输入框为空，与原行为一致）
watch(() => props.prefillName, v => { if (v && !form.name) form.name = v }, { immediate: true })

const btnDisabled = computed(() => !agree.value || submitting.value)
const msgClass = computed(() => 'mono text-xs min-h-[1rem] ' + (msgKind.value === 'ok' ? 'ok' : msgKind.value === 'warn' ? 'warn' : 'text-slate-300'))

async function onSubmit() {
  msgKind.value = 'idle'
  msg.value = '$ nec cla sign … 提交中'
  submitting.value = true
  try {
    const res = await fetch('/api/cla/sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: form.name, github: form.github,
        email: form.email || undefined, org: form.org || undefined,
        agree: true,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    const sig = data.signature as ClaSignature
    msgKind.value = 'ok'
    msg.value = data.alreadySigned
      ? `✓ @${sig.github} 已签署过（${fmtDate(sig.signedAt)}），无需重复签署`
      : `✓ 签署成功！欢迎 @${sig.github} 成为第 ${data.count} 位签署者`
    store.currentSig = sig
    store.alreadySigned = !!data.alreadySigned
    loadSigners()
  } catch (err: any) {
    msgKind.value = 'warn'
    msg.value = `✗ 签署失败：${err.message}`
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="lg:col-span-2 terminal flex flex-col">
    <div class="terminal-bar flex items-center gap-2 px-4 py-2.5">
      <span class="dot bg-red-400"></span><span class="dot bg-yellow-400"></span><span class="dot bg-green-400"></span>
      <img src="/brand/nec-logo-white.svg" alt="" class="h-4 w-auto ml-1" />
      <span class="mono text-xs text-slate-300 ml-2">nec cla sign</span>
    </div>
    <form class="p-4 space-y-4 flex-1" @submit.prevent="onSubmit">
      <div>
        <label class="mono text-xs block mb-1"><span class="prompt">$</span> --name <span class="text-slate-400">真实姓名 *</span></label>
        <input v-model="form.name" name="name" required maxlength="40" class="field-input" placeholder="张三" />
      </div>
      <div>
        <label class="mono text-xs block mb-1"><span class="prompt">$</span> --github <span class="text-slate-400">GitHub 用户名 *</span></label>
        <input v-model="form.github" name="github" required maxlength="39" class="field-input mono" placeholder="octocat" />
      </div>
      <div>
        <label class="mono text-xs block mb-1"><span class="prompt">$</span> --email <span class="text-slate-400">邮箱（可选，不公开）</span></label>
        <input v-model="form.email" name="email" type="email" class="field-input mono" placeholder="you@example.com" />
      </div>
      <div>
        <label class="mono text-xs block mb-1"><span class="prompt">$</span> --org <span class="text-slate-400">单位 / 组织（可选）</span></label>
        <input v-model="form.org" name="org" maxlength="60" class="field-input" placeholder="常州工学院" />
      </div>
      <label class="flex items-start gap-2 text-xs text-slate-300 cursor-pointer select-none">
        <input v-model="agree" type="checkbox" class="mt-0.5 accent-[#1FA9E8]" />
        <span>我已完整阅读左侧《贡献者许可协议 v{{ store.version }}》，并同意按其条款授予许可。</span>
      </label>
      <button type="submit" :disabled="btnDisabled" class="sign-btn mono w-full rounded-lg py-2.5 text-sm transition">
        ⏎ 执行签署
      </button>
      <p :class="msgClass">{{ msg }}</p>
    </form>
  </section>
</template>
