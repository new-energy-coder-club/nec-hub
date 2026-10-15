<script setup lang="ts">
// 签署荣誉榜：GitHub 头像 + 序号 / 协议版本 / 签署日期 / 组织
import { fmtDate } from '../agreement'
import { store } from '../store'

function hideAvatar(e: Event) {
  (e.target as HTMLImageElement).style.visibility = 'hidden'
}
</script>

<template>
  <section class="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 p-5">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold text-slate-800">签署荣誉榜</h2>
      <span class="mono text-xs text-gray-400">{{ store.listState === 'ok' ? `total ${store.count}` : '' }}</span>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <p v-if="store.listState === 'loading'" class="text-sm text-gray-400 col-span-full">加载中…</p>
      <p v-else-if="store.listState === 'error'" class="text-sm text-red-400 col-span-full">签署名单加载失败，请刷新重试。</p>
      <p v-else-if="!store.count" class="text-sm text-gray-400 col-span-full">还没有人签署，来当第一位贡献者吧。</p>
      <template v-else>
        <div v-for="(s, i) in store.signatures" :key="s.github + s.signedAt"
             class="fade-in flex items-center gap-3 border border-gray-200 rounded-lg px-3 py-2.5">
          <img :src="`https://github.com/${encodeURIComponent(s.github)}.png?size=64`" alt="" loading="lazy"
               class="w-9 h-9 rounded-full bg-gray-100" @error="hideAvatar" />
          <div class="min-w-0">
            <p class="text-sm font-semibold text-slate-800 truncate">{{ s.name }}
              <a class="mono text-xs text-sky-600 font-normal" :href="`https://github.com/${encodeURIComponent(s.github)}`" target="_blank" rel="noopener">@{{ s.github }}</a>
            </p>
            <p class="mono text-[11px] text-gray-400">#{{ i + 1 }} · v{{ s.version }} · {{ fmtDate(s.signedAt) }}{{ s.org ? ' · ' + s.org : '' }}</p>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>
