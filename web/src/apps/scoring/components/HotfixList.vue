<script setup lang="ts">
// 07 Hotfix 执行范式
import { HOTFIXES } from '../data'
</script>

<template>
  <section class="nec-card p-5">
    <div class="mb-4">
      <h2 class="text-lg font-bold text-nec-ink">Hotfix 执行范式</h2>
      <p class="mono text-xs text-nec-gray tracking-wider">HOTFIX PLAYBOOK · 每条必须含具体参数值</p>
    </div>
    <div class="space-y-4">
 <div v-for="(h, i) in HOTFIXES" :key="h.title" class="rounded-lg p-4 border border-nec-line bg-nec-fog">
        <div class="flex items-center gap-2 mb-2">
          <span class="mono text-xs font-black text-nec-cyan">HOTFIX-{{ String(i + 1).padStart(2, '0') }}</span>
          <h3 class="text-sm font-bold text-nec-navy">{{ h.title }}</h3>
        </div>
        <p class="text-xs text-nec-gray mb-2">{{ h.desc }}</p>
        <div class="code-block"><span class="before">- {{ h.before }}</span>{{ '\n' }}<span class="after">+ {{ h.after }}</span></div>
      </div>
    </div>
  </section>
</template>
