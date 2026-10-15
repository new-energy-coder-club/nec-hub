<script setup lang="ts">
// 用户盒：登录态徽章 / 登录按钮（带"上次登录"提示）
import { computed } from 'vue'
import { auth, getLastLogin, logout, startLogin } from '@shared/auth'

// 角色徽标补充权限说明（external 等非常规角色用户常不知道边界）
const ROLE_TIPS: Record<string, string> = { external: '外部协作者：可查看公开数据，审批/报销等功能需队长开通' }

const me = computed(() => auth.me)
const config = computed(() => auth.config)
// “记住上次登录”：登录成功后后端写入非 HttpOnly 的 nec_last_login Cookie（30 天，仅展示信息）
const last = computed(() => getLastLogin())
const roleTip = computed(() => (me.value.user?.role && ROLE_TIPS[me.value.user.role]) || '')
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
    <template v-else-if="config.loginEnabled">
      <template v-if="last && last.name">
        <img v-if="last.avatar_url" :src="last.avatar_url" class="w-6 h-6 rounded-full opacity-70" alt="" />
        <span class="text-xs text-gray-400" :title="last.at ? new Date(last.at).toLocaleString('zh-CN') : ''">上次登录：{{ last.name }}</span>
      </template>
      <button @click="startLogin" class="px-3 py-1 rounded text-white" style="background:var(--nec-navy)">{{ last && last.name ? '以 ' + last.name + ' 继续登录' : '飞书登录' }}</button>
    </template>
  </div>
</template>
