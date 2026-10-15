<script setup lang="ts">
// 「申请新域名」表单：字段 / pattern / 文案逐字对齐原页 claim-form
import { store, submitClaim } from '../store'
</script>

<template>
  <h2 class="font-bold text-slate-800 mb-1">申请新域名</h2>
  <p class="text-xs text-gray-500 mb-1">每个成员最多持有 <span id="limit-label">{{ store.limit }}</span> 个。常见目标：Cloudflare Pages（<span class="mono">xxx.pages.dev</span>）、Vercel（<span class="mono">cname.vercel-dns.com</span>）、GitHub Pages（<span class="mono">&lt;user&gt;.github.io</span>）或服务器 IP。目标平台侧通常也要绑定该自定义域名。</p>
  <p class="text-xs text-gray-500 mb-4">支持四级域名：子域名里带点即可，如 <span class="mono">my-app.dev</span> → <span class="mono">my-app.dev.newenergycoder.club</span>。注意四级域名不受 Cloudflare 免费证书覆盖，将强制「仅 DNS」，HTTPS 由目标平台签发。</p>
  <form id="claim-form" class="grid grid-cols-1 md:grid-cols-12 gap-3 items-end" @submit="submitClaim">
    <div class="md:col-span-4">
      <label class="block text-xs text-gray-500 mb-1">子域名</label>
      <div class="flex items-center gap-1">
        <input id="f-sub" v-model="store.form.subdomain" class="field mono" placeholder="my-app 或 my-app.dev（四级）" pattern="[a-z0-9][a-z0-9\-\.]{0,250}[a-z0-9]" required />
        <span id="f-suffix" class="mono text-xs text-gray-400 whitespace-nowrap">.{{ store.zone }}</span>
      </div>
    </div>
    <div class="md:col-span-2">
      <label class="block text-xs text-gray-500 mb-1">记录类型</label>
      <select id="f-type" v-model="store.form.type" class="field mono">
        <option value="CNAME">CNAME</option>
        <option value="A">A</option>
        <option value="AAAA">AAAA</option>
      </select>
    </div>
    <div class="md:col-span-3">
      <label class="block text-xs text-gray-500 mb-1">解析目标</label>
      <input id="f-target" v-model="store.form.target" class="field mono" placeholder="my-app.pages.dev" required />
    </div>
    <div class="md:col-span-3">
      <label class="block text-xs text-gray-500 mb-1">用途说明（可选）</label>
      <input id="f-desc" v-model="store.form.description" class="field" placeholder="我的赛季项目演示站" maxlength="120" />
    </div>
    <label class="md:col-span-9 flex items-center gap-2 text-xs text-gray-500">
      <input id="f-proxied" v-model="store.form.proxied" type="checkbox" class="accent-blue-600" />
      走 Cloudflare 代理（橙云，自带 HTTPS；部分平台如 Vercel 要求关闭）
    </label>
    <div class="md:col-span-3">
      <button id="f-submit" type="submit" class="btn-primary w-full rounded-lg px-4 py-2 text-sm" :disabled="store.submitting">申请域名</button>
    </div>
  </form>
</template>
