// 登录门控 Tab 的登出守卫（drawing-review / hardware-review / contract-approval 三个评审 Tab 共用）：
// 登出后若仍停留在该 Tab 则跳回 fallbackTab；返回 authed 供模板做空态切换
import { computed, watch } from 'vue'
import { auth } from '@shared/auth'
import { tabs, switchTab, type TabId } from './useTabs'

export function useAuthGate(tabId: TabId, fallbackTab: TabId = 'home') {
  const authed = computed(() => !!(auth.me.authenticated && auth.me.user))
  watch(authed, now => { if (!now && tabs.active === tabId) switchTab(fallbackTab) })
  return { authed }
}
