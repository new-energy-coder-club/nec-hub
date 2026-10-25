<script setup lang="ts">
// 用户盒：登录态徽章 / 飞书登录按钮 / 账号密码登录（本地账号，实习生等无飞书身份成员用）
import { computed, ref } from 'vue'
import { auth, getLastLogin, loginWithPassword, logout, startLogin } from '@shared/auth'
import AuthToast from '@shared/ui/AuthToast.vue'

// 角色徽标补充权限说明（external 等非常规角色用户常不知道边界）
const ROLE_TIPS: Record<string, string> = { external: '外部协作者：可查看公开数据，审批/报销等功能需队长开通' }

const me = computed(() => auth.me)
const config = computed(() => auth.config)
const exchanging = computed(() => auth.phase === 'exchanging')
// “记住上次登录”：登录成功后后端写入非 HttpOnly 的 nec_last_login Cookie（30 天，仅展示信息）
const last = computed(() => getLastLogin())
const roleTip = computed(() => (me.value.user?.role && ROLE_TIPS[me.value.user.role]) || '')

// 账号密码登录（内联表单）
const showPwdForm = ref(false)
const pwdUser = ref('')
const pwdPass = ref('')
const pwdBusy = ref(false)
const pwdErr = ref('')
async function submitPwd() {
  if (pwdBusy.value) return
  pwdErr.value = ''
  if (!pwdUser.value.trim() || !pwdPass.value) { pwdErr.value = '请输入账号和密码'; return }
  pwdBusy.value = true
  try {
    await loginWithPassword(pwdUser.value, pwdPass.value)
    showPwdForm.value = false
    pwdPass.value = ''
  } catch (e: any) {
    pwdErr.value = e.message || '登录失败'
  } finally {
    pwdBusy.value = false
  }
}
</script>

<template>
  <div id="user-box" class="text-xs flex items-center gap-2">
    <template v-if="me.authenticated && me.user">
      <img v-if="me.user.avatar_url" :src="me.user.avatar_url" class="w-6 h-6 rounded-full" alt="" />
      <span class="font-medium" style="color:var(--nec-navy)">{{ me.user.name }}</span>
      <span class="px-1.5 py-0.5 rounded text-[10px] text-white" :title="roleTip || undefined"
            :style="roleTip ? 'background:var(--nec-cyan);cursor:help' : 'background:var(--nec-cyan)'">{{ me.user.role || '队员' }}</span>
      <span v-if="me.user.group" class="text-gray-400 hidden sm:inline">{{ me.user.group }}</span>
      <button @click="logout" class="text-gray-400 hover:text-gray-600 ml-1">登出</button>
    </template>
    <template v-else-if="exchanging">
      <!-- OAuth 回跳兑换会话中：过渡态占位，避免闪现"未登录" -->
      <span class="inline-block w-3.5 h-3.5 border-2 border-gray-200 rounded-full animate-spin" style="border-top-color:var(--nec-cyan)"></span>
      <span class="text-gray-500">飞书登录中…</span>
    </template>
    <template v-else-if="config.loginEnabled">
      <template v-if="last && last.name">
        <img v-if="last.avatar_url" :src="last.avatar_url" class="w-6 h-6 rounded-full opacity-70" alt="" />
        <span class="text-xs text-gray-400" :title="last.at ? new Date(last.at).toLocaleString('zh-CN') : ''">上次登录：{{ last.name }}</span>
      </template>
      <button @click="startLogin" class="px-3 py-1 rounded text-white" style="background:var(--nec-navy)">{{ last && last.name ? '以 ' + last.name + ' 继续登录' : '飞书登录' }}</button>
    </template>
    <!-- 账号密码登录：本地账号（实习生等无飞书身份成员），与飞书登录互斥展开 -->
    <button v-if="!showPwdForm" @click="showPwdForm = true" class="text-gray-400 hover:text-gray-600">账号登录</button>
    <form v-else class="flex items-center gap-1" @submit.prevent="submitPwd">
      <input v-model="pwdUser" placeholder="账号" autocomplete="username"
             class="w-20 px-1.5 py-1 border border-gray-200 rounded text-xs" :disabled="pwdBusy" />
      <input v-model="pwdPass" type="password" placeholder="密码" autocomplete="current-password"
             class="w-20 px-1.5 py-1 border border-gray-200 rounded text-xs" :disabled="pwdBusy" />
      <button type="submit" class="px-2 py-1 rounded text-white text-xs" style="background:var(--nec-cyan)"
              :disabled="pwdBusy">{{ pwdBusy ? '登录中…' : '登录' }}</button>
      <button type="button" class="text-gray-400 hover:text-gray-600" :disabled="pwdBusy" @click="showPwdForm = false; pwdErr = ''">取消</button>
    </form>
  </div>
  <div v-if="pwdErr" class="text-xs mt-1" style="color:var(--nec-red, #c0392b)">{{ pwdErr }}</div>

  <!-- 登录错误提示：内联横幅（替代原生 alert），可手动关闭/重试 -->
  <AuthToast />
</template>
