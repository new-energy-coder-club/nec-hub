<script setup lang="ts">
// 顶部 Tab 导航：更多分组展开/收起；登录门控 Tab（图纸评审/硬件评审/合同审批）未登录始终隐藏
import { tabs, switchTab, toggleMoreTabs, TAB_IDS, TAB_LABELS, MORE_TABS, isTabVisible, type TabId } from '@portal/composables/useTabs'

function isMoreTab(tab: TabId): boolean {
  return MORE_TABS.includes(tab)
}

function btnClass(tab: TabId) {
  return [
    'tab-btn py-3 shrink-0',
    isMoreTab(tab) ? 'tab-more' : '',
    tabs.active === tab ? 'tab-active' : '',
  ]
}

function onClick(tab: TabId) {
  switchTab(tab)
}
</script>

<template>
  <nav class="bg-white shadow-sm">
    <div class="max-w-5xl mx-auto px-4 sm:px-6 flex gap-4 sm:gap-6 text-sm font-medium text-gray-500 overflow-x-auto whitespace-nowrap scrollbar-hide">
      <template v-for="tab in TAB_IDS" :key="tab">
        <button v-show="isTabVisible(tab)" :data-tab="tab" :id="tab === 'drawing-review' ? 'tab-btn-drawing-review' : undefined"
                :class="btnClass(tab)" @click="onClick(tab)">{{ TAB_LABELS[tab] }}</button>
      </template>
      <button id="nav-more-btn" @click="toggleMoreTabs"
              class="py-3 shrink-0 text-gray-400 hover:text-gray-600"
              :class="{ 'tab-active': MORE_TABS.includes(tabs.active) }">{{ tabs.more ? '收起 ▴' : '更多 ▾' }}</button>
    </div>
  </nav>
</template>
