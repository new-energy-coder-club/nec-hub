<script setup lang="ts">
// 顶部 Tab 导航：更多分组展开/收起；登录门控 Tab（图纸评审/硬件评审/合同审批）未登录始终隐藏
// 更多展开时按组渲染小标题（工作/评审/资源）；组内无实际折叠成员的组不渲染（task-schedule、my-tasks 均在折叠组外）
import { tabs, switchTab, toggleMoreTabs, TAB_IDS, TAB_LABELS, MORE_TABS, isTabVisible, gateVisible, type TabId } from '@portal/composables/useTabs'

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

// 「更多」分组标题：以实际 MORE_TABS 成员为准（工作组成员 task-schedule/my-tasks 不在折叠组，组空自动不渲染）
const MORE_GROUPS: Array<{ label: string; members: TabId[] }> = [
  { label: '工作', members: (['task-schedule', 'my-tasks'] as TabId[]).filter(t => MORE_TABS.includes(t)) },
  { label: '评审', members: ['hardware-review', 'contract-approval'] },
  { label: '资源', members: ['skills', 'docs', 'repos'] },
]
const GROUP_LABEL_OF: Record<string, string> = {}
for (const grp of MORE_GROUPS) for (const t of grp.members) if (!(t in GROUP_LABEL_OF)) GROUP_LABEL_OF[t] = grp.label

/** 仅在组内首个可见 Tab 前渲染一次组标题 */
function moreGroupLabel(tab: TabId): string {
  return GROUP_LABEL_OF[tab] ?? ''
}
</script>

<template>
  <nav class="bg-white shadow-sm">
    <div class="max-w-5xl mx-auto px-4 sm:px-6 flex gap-4 sm:gap-6 text-sm font-medium text-gray-500 overflow-x-auto whitespace-nowrap scrollbar-hide">
      <template v-for="tab in TAB_IDS" :key="tab">
        <span v-if="tabs.more && moreGroupLabel(tab) && gateVisible(tab)"
              class="self-center text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 shrink-0 -mr-2">{{ moreGroupLabel(tab) }}</span>
        <button v-show="isTabVisible(tab)" :data-tab="tab" :id="tab === 'drawing-review' ? 'tab-btn-drawing-review' : undefined"
                :class="btnClass(tab)" @click="onClick(tab)">{{ TAB_LABELS[tab] }}</button>
      </template>
      <button id="nav-more-btn" @click="toggleMoreTabs"
              class="py-3 shrink-0 text-gray-400 hover:text-gray-600"
              :class="{ 'tab-active': MORE_TABS.includes(tabs.active) }">{{ tabs.more ? '收起 ▴' : '更多 ▾' }}</button>
    </div>
  </nav>
</template>
