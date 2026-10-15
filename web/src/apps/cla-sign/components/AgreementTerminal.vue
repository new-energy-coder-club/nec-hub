<script setup lang="ts">
// 协议正文终端：打字机逐字渲染 AGREEMENT（prefers-reduced-motion 时直接全量输出）
import { onMounted, ref } from 'vue'
import { AGREEMENT } from '../agreement'

const termEl = ref<HTMLElement | null>(null)
const typed = ref('')
const typing = ref(true)

onMounted(async () => {
  const term = termEl.value!
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced) {
    typed.value = AGREEMENT
  } else {
    for (let i = 0; i < AGREEMENT.length; i++) {
      typed.value += AGREEMENT[i]
      term.scrollTop = term.scrollHeight
      if (i % 3 === 0) await new Promise(r => setTimeout(r, 8))
    }
  }
  typing.value = false
  term.scrollTop = term.scrollHeight
})
</script>

<template>
  <section class="lg:col-span-3 terminal">
    <div class="terminal-bar flex items-center gap-2 px-4 py-2.5">
      <span class="dot bg-red-400"></span><span class="dot bg-yellow-400"></span><span class="dot bg-green-400"></span>
      <img src="/brand/nec-logo-white.svg" alt="" class="h-4 w-auto ml-1" />
      <span class="mono text-xs text-slate-300 ml-2">nec-hub — cla — zsh</span>
    </div>
    <div ref="termEl" class="term-body mono text-[13px] leading-relaxed px-4 py-4 whitespace-pre-wrap"><span class="prompt">nec@hub</span> <span class="text-slate-400">~ %</span> nec cla show{{ '\n\n' }}{{ typed }}<span v-if="typing" class="cursor">&nbsp;</span><div v-else>{{ '\n' }}<span class="prompt">nec@hub</span> <span class="text-slate-400">~ %</span> <span class="cursor">&nbsp;</span></div></div>
  </section>
</template>
