<script setup lang="ts">
// 费用项目选择弹窗：左树（分组）+ 列表（可搜索）+ 已选侧栏；单击选定，双击选定并确认
import { computed } from 'vue'
import Modal from '@shared/ui/Modal.vue'
import { store, closeCatModal, pickCat, confirmCat } from '../store'

const rows = computed(() => {
  const q = store.catModal.search.trim().toLowerCase()
  const groups = q ? store.catalog : store.catalog.filter(g => g.group === store.catModal.group)
  const out: { full: string; code: string }[] = []
  groups.forEach(g => g.items.forEach(it => {
    const full = g.group + '.' + it.name
    if (q && !full.toLowerCase().includes(q) && !it.code.toLowerCase().includes(q)) return
    out.push({ full, code: it.code })
  }))
  return out
})

function dblPick(v: string) {
  pickCat(v)
  confirmCat()
}
</script>

<template>
  <Modal :open="store.catModal.open" title="费用项目" body-class="!p-0 flex flex-1 min-h-0" @close="closeCatModal">
    <template #head-extra>
      <input id="cat-search" class="line-input border border-nec-line" style="width:200px" placeholder="搜索编码/名称"
             v-model="store.catModal.search" />
    </template>
    <div id="cat-tree" class="w-44 flex-none overflow-y-auto border-r border-nec-line p-2 space-y-0.5">
      <div v-for="g in store.catalog" :key="g.group" class="tree-item" :class="{ on: g.group === store.catModal.group }"
           @click="store.catModal.group = g.group">▸ {{ g.group }}</div>
    </div>
    <div class="flex-1 overflow-y-auto" id="cat-list">
      <p v-if="!rows.length" class="p-4 text-sm text-nec-gray">无匹配项</p>
      <div v-for="r in rows" :key="r.full" class="pick-row" @click="pickCat(r.full)" @dblclick="dblPick(r.full)">
        <input type="checkbox" :checked="store.catModal.temp === r.full" style="pointer-events:none" />
        <span class="mono text-xs text-nec-gray w-14">{{ r.code }}</span>
        <span class="flex-1">{{ r.full }}</span>
        <span class="text-xs text-green-600">可用</span>
      </div>
    </div>
    <div class="w-40 flex-none border-l border-nec-line p-3">
      <p class="text-xs text-nec-gray mb-2">已选（作用于第 <b id="cat-row-no" class="text-nec-navy">{{ store.selected + 1 }}</b> 行）</p>
      <p id="cat-selected" class="text-sm font-semibold text-nec-navy break-all">{{ store.catModal.temp || '—' }}</p>
    </div>
    <template #footer>
      <span class="text-xs text-nec-gray">单击列表项即选定</span>
      <div class="flex gap-2">
        <button id="cat-cancel" class="tool-btn ghost" @click="closeCatModal">取消</button>
        <button id="cat-ok" class="tool-btn primary" @click="confirmCat">确定</button>
      </div>
    </template>
  </Modal>
</template>
