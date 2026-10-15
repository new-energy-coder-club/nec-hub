// Tab 切换 + Hash 路由：/#/dashboard 等深链可直达对应面板，刷新/分享不丢位置（旧式 #tab-dashboard 自动升级）
import { reactive } from 'vue'
import { auth } from '@shared/auth'
import { pendingHash } from '@shared/pendingTab'

export const TAB_IDS = ['home', 'my-tasks', 'drawing-review', 'reimburse', 'task-schedule', 'season-goals', 'apps', 'skills', 'docs', 'repos', 'hardware-review', 'contract-approval', 'dashboard', 'prd', 'agent'] as const
export type TabId = (typeof TAB_IDS)[number]

// 低频 Tab（Skill 中心/资料页/开源仓库/硬件评审/合同审批）默认收进「更多」，保持导航高频入口精简
export const MORE_TABS: TabId[] = ['skills', 'docs', 'repos', 'hardware-review', 'contract-approval']

// 登录门控 Tab（gate-off）：未登录时始终隐藏；登录后，属「更多」分组的随折叠状态显隐
export const GATE_TABS: TabId[] = ['drawing-review', 'hardware-review', 'contract-approval']

export const TAB_LABELS: Record<TabId, string> = {
  home: '我的首页',
  'my-tasks': '我的任务',
  'drawing-review': '图纸评审',
  reimburse: '报销',
  'task-schedule': '任务排期',
  'season-goals': '赛季目标',
  apps: '应用广场',
  skills: 'Skill 中心',
  docs: '资料页',
  repos: '开源仓库',
  'hardware-review': '硬件评审',
  'contract-approval': '合同审批',
  dashboard: '数据看板',
  prd: 'PRD 看板',
  agent: 'NEC-MCP',
}

export const tabs = reactive({
  active: 'home' as TabId,
  more: false,
})

/** 登录门控：图纸评审/硬件评审/合同审批登录后可见 */
export function gateVisible(tab: TabId): boolean {
  if (!GATE_TABS.includes(tab)) return true
  return !!(auth.me.authenticated && auth.me.user)
}

export function isTabVisible(tab: TabId): boolean {
  if (!gateVisible(tab)) return false
  if (MORE_TABS.includes(tab)) return tabs.more
  return true
}

export function switchTab(tab: string, opts: { silent?: boolean } = {}): boolean {
  if (!(TAB_IDS as readonly string[]).includes(tab)) return false
  const t = tab as TabId
  // 目标在「更多」分组里时先展开，否则视为当前不可见（如未登录时的图纸评审）
  // gate-off 优先于「更多」折叠：未登录时登录门控 Tab 不可通过展开「更多」进入
  if (!isTabVisible(t)) {
    if (MORE_TABS.includes(t) && gateVisible(t)) tabs.more = true
    else return false
  }
  tabs.active = t
  if (!opts.silent) {
    const canonical = '#/' + tab
    if (location.hash !== canonical) history.replaceState(null, '', location.pathname + location.search + canonical)
  }
  return true
}

export function parseHashTab(): string | null {
  let m = location.hash.match(/^#\/([a-z-]+)$/)
  if (m) return m[1]
  m = location.hash.match(/^#tab-([a-z-]+)$/) // 旧式断链兼容
  return m ? m[1] : null
}

export function applyHashRoute() {
  const tab = parseHashTab() || pendingHash.tab
  if (!tab) return
  if (switchTab(tab, { silent: true })) {
    pendingHash.tab = null
    const canonical = '#/' + tab
    if (location.hash !== canonical) history.replaceState(null, '', location.pathname + location.search + canonical)
  } else if ((TAB_IDS as readonly string[]).includes(tab)) {
    // 目标 Tab 当前不可见（如未登录）：暂存待门控放开后重放，不再抹掉 hash
    pendingHash.tab = tab
  } else {
    // 未知 hash：落回首页
    pendingHash.tab = null
    switchTab('home', { silent: true })
    history.replaceState(null, '', location.pathname + location.search + '#/home')
  }
}

export function setMoreTabs(expanded: boolean) {
  tabs.more = expanded
}

export function toggleMoreTabs() {
  tabs.more = !tabs.more
}

export function initTabs() {
  window.addEventListener('hashchange', applyHashRoute)
  applyHashRoute()
}

/** OAuth 往返后恢复暂存的深链目标；同时重放所有登录门控 Tab 的 pendingHash（ST-02） */
export function replayLoginReturn() {
  const returnTab = sessionStorage.getItem('nec_login_return_tab')
  if (returnTab) {
    sessionStorage.removeItem('nec_login_return_tab')
    if (!parseHashTab()) pendingHash.tab = returnTab
  }
  applyHashRoute()
}
