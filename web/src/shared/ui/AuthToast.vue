<script setup lang="ts">
// 登录错误内联提示（替代原生 alert）：读取 shared/auth 的 auth.error，任意挂载点放一次即可
import { computed } from 'vue'
import { auth, startLogin } from '@shared/auth'

const error = computed(() => auth.error)
function dismiss() { auth.error = '' }
</script>

<template>
  <teleport to="body">
    <div v-if="error" class="fixed top-3 left-1/2 -translate-x-1/2 z-50 max-w-[92vw] flex items-center gap-3 px-4 py-2.5 rounded-lg shadow-lg bg-white border border-red-100 text-xs" role="alert">
      <span class="text-red-500 font-medium shrink-0">登录失败</span>
      <span class="text-gray-600 break-all">{{ error }}</span>
 <button @click="startLogin" class="shrink-0 px-2 py-1 rounded text-white bg-nec-navy">重试</button>
      <button @click="dismiss" class="shrink-0 text-gray-400 hover:text-gray-600 px-1" aria-label="关闭">✕</button>
    </div>
  </teleport>
</template>
