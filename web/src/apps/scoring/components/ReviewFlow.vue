<script setup lang="ts">
// 05 A416::REVIEW 循环图示（手绘 SVG）
const W = 720, H = 200
const steps = [
  { x: 120, title: '诊断', sub: 'Residual Issues', code: '01' },
  { x: 360, title: '方案', sub: 'A / B / C 备选', code: '02' },
  { x: 600, title: 'Hotfix', sub: '具体改法 + 参数值', code: '03' },
]
</script>

<template>
  <section class="nec-card p-5">
    <div class="mb-4">
      <h2 class="text-lg font-bold text-nec-ink">A416::REVIEW 三段式评审流程</h2>
      <p class="mono text-xs text-nec-gray tracking-wider">DIAGNOSE → PLAN → HOTFIX LOOP</p>
    </div>
    <div class="w-full overflow-x-auto">
      <svg :viewBox="`0 0 ${W} ${H}`" class="w-full" style="min-width:480px" role="img" aria-label="A416 REVIEW 三段式评审循环">
        <line x1="185" y1="100" x2="295" y2="100" stroke="var(--nec-cyan)" stroke-width="2" stroke-dasharray="6 4" />
        <path d="M295 100 l-8 -5 v10 z" fill="var(--nec-cyan)" />
        <line x1="425" y1="100" x2="535" y2="100" stroke="var(--nec-cyan)" stroke-width="2" stroke-dasharray="6 4" />
        <path d="M535 100 l-8 -5 v10 z" fill="var(--nec-cyan)" />
        <path d="M600 132 C 600 178, 120 178, 120 132" fill="none" stroke="var(--nec-line)" stroke-width="1.5" stroke-dasharray="4 5" />
        <path d="M120 132 l-5 -8 h10 z" fill="var(--nec-gray)" />
        <template v-for="s in steps" :key="s.code">
          <circle :cx="s.x" cy="100" r="46" fill="var(--nec-paper)" stroke="var(--nec-navy)" stroke-width="2" />
          <circle :cx="s.x" cy="100" r="38" fill="none" stroke="var(--nec-cyan)" stroke-width="1" stroke-dasharray="3 5" />
          <text :x="s.x" y="95" text-anchor="middle" font-size="15" font-weight="800" fill="var(--nec-ink)">{{ s.title }}</text>
          <text :x="s.x" y="113" text-anchor="middle" font-size="9" fill="var(--nec-gray)" font-family="ui-monospace,Consolas,monospace">{{ s.sub }}</text>
          <text :x="s.x - 30" y="66" text-anchor="middle" font-size="11" font-weight="800" fill="var(--nec-cyan)" font-family="ui-monospace,Consolas,monospace">{{ s.code }}</text>
        </template>
        <text :x="W / 2" y="196" text-anchor="middle" font-size="10" fill="var(--nec-gray)" font-family="ui-monospace,Consolas,monospace"># A416::REVIEW mode | kimi &lt;target&gt; | help | status —— 循环至达标为止</text>
      </svg>
    </div>
    <p class="mt-3 text-sm text-nec-gray">
      固定三段式循环：每轮输出 <span class="mono text-nec-navy">Residual Issues</span> →
      优化方案（含 <span class="mono text-nec-navy">A/B/C</span> 备选）→ 立即可执行的
      <span class="mono text-nec-navy">Hotfix</span> 清单（含具体参数值）。
    </p>
  </section>
</template>
