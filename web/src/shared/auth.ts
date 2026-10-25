// 飞书登录态（FE-01）：OAuth 跳转登录 + 会话 Cookie + 角色徽章
import { reactive } from 'vue'
import { pendingHash } from '@shared/pendingTab'
import { LEADER_ROLE_RE, CONFIG_ADMIN_ROLE_RE, hasRole } from '@shared/roles'

export interface HubUser {
  name: string
  open_id: string
  role?: string
  group?: string
  avatar_url?: string
}

/** boot=启动初始化中；exchanging=拿到回调 code 正在兑换会话；ready=就绪（已登录或未登录看 me.authenticated） */
export type AuthPhase = 'boot' | 'exchanging' | 'ready'

export const auth = reactive({
  config: { loginEnabled: false, feishuAppId: null as string | null },
  me: { authenticated: false, user: null as HubUser | null },
  /** 登录流程阶段：兑换 code 期间 UI 显示"登录中"，避免回跳后先闪现未登录态 */
  phase: 'boot' as AuthPhase,
  /** 最近一次登录错误（state 不匹配 / code 兑换失败），页面内联展示，不再用 alert 打断 */
  error: '' as string,
  /** 登录/登出/启动完成后自增，各面板监听它重载数据 */
  tick: 0,
})

// Hero 版式：全尺寸只给未登录访客的首次访问；登录用户与已见过的回访一律压缩成品牌细条
export function heroCompact(): boolean {
  let seen = false
  try { seen = localStorage.getItem('nec_hero_seen') === '1' } catch { /* ignore */ }
  const compact = auth.me.authenticated || seen
  if (!compact) {
    try { localStorage.setItem('nec_hero_seen', '1') } catch { /* ignore */ }
  }
  return compact
}

// Cookie 名转义正则为常量：避免每次 readCookie 调用重建
const COOKIE_NAME_ESC_RE = /[.*+?^${}()|[\]\\]/g
export function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(COOKIE_NAME_ESC_RE, '\\$&') + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}

export interface LastLogin { name?: string; avatar_url?: string; at?: number; local?: boolean }

export function getLastLogin(): LastLogin | null {
  try {
    const raw = readCookie('nec_last_login')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function bootAuth() {
  try { auth.config = await (await fetch('/api/config')).json() } catch { /* ignore */ }
  const params = new URLSearchParams(location.search)
  const code = params.get('code')
  // 飞书授权失败回跳（用户拒绝/无权限等）：?error=xxx&error_description=yyy，内联提示而不是静默落回未登录态
  const oauthError = params.get('error')
  if (oauthError && !code) {
    history.replaceState(null, '', location.pathname + location.hash)
    const desc = params.get('error_description')
    auth.error = oauthError === 'access_denied'
      ? '飞书授权被拒绝或已取消，请重试'
      : `飞书登录失败（${oauthError}）${desc ? '：' + desc : ''}`
  }
  if (code) {
    // 回调兑换期：先把 URL 里的 code 抹掉（防刷新重复兑换），UI 进入"登录中"过渡态
    auth.phase = 'exchanging'
    const state = params.get('state')
    const saved = sessionStorage.getItem('nec_oauth_state')
    history.replaceState(null, '', location.pathname + location.hash)
    if (state && saved && state !== saved) {
      auth.error = '登录校验失败（state 不匹配），请重新登录'
    } else {
      try {
        const resp = await fetch('/auth/feishu', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // 本会话发起（saved 存在）的 state 已在上面对过；saved 为空说明 state 来自服务端签发
          // （如"我的任务"重新授权），交给 /auth/feishu 与 KV 里的 oauth:state:<state> 一次性比对
          body: JSON.stringify(saved ? { code } : { code, state }),
        })
        const data = await resp.json()
        if (!resp.ok || data.error) throw new Error(data.error || ('HTTP ' + resp.status))
        restoreScroll()
      } catch (e: any) {
        auth.error = '飞书登录失败：' + (e.message || e)
      }
    }
    sessionStorage.removeItem('nec_oauth_state')
  }
  await refreshMe()
  auth.phase = 'ready'
  auth.tick++
  maybeAutoLogin()
}

/** 老用户无感重登：会话过期但有"上次登录"记录时自动走一次飞书 OAuth（已授权用户被飞书秒放回）。
 *  防循环：每会话只自动发起一次；兑换失败（auth.error 非空）或用户主动登出后不再自动跳 */
function maybeAutoLogin() {
  if (auth.me.authenticated || !auth.config.loginEnabled || auth.error) return
  try {
    if (sessionStorage.getItem('nec_auto_login_off') || sessionStorage.getItem('nec_auto_login_tried')) return
  } catch { return }
  if (!getLastLogin()?.name) return
  // 上次是账号密码登录（local）不自动跳飞书 OAuth，否则本地账号会话过期后会被重定向到飞书
  if (getLastLogin()?.local) return
  try { sessionStorage.setItem('nec_auto_login_tried', '1') } catch { /* ignore */ }
  startLogin()
}

/** OAuth 往返前暂存的滚动位置，登录成功后恢复 */
function restoreScroll() {
  try {
    const y = Number(sessionStorage.getItem('nec_login_scroll') || '')
    sessionStorage.removeItem('nec_login_scroll')
    if (y > 0) setTimeout(() => window.scrollTo(0, y), 0)
  } catch { /* ignore */ }
}

export async function refreshMe() {
  try { auth.me = await (await fetch('/api/whoami')).json() }
  catch { auth.me = { authenticated: false, user: null } }
}

export function startLogin() {
  const state = crypto.randomUUID()
  sessionStorage.setItem('nec_oauth_state', state)
  // OAuth 往返会丢 hash 与滚动位置：暂存深链目标（当前 Tab 或登录门控暂存 Tab）与 scrollY，登录回来后重放
  const hashTab = location.hash.match(/^#\/([a-z-]+)$/)?.[1] ?? null
  const returnTab = pendingHash.tab || hashTab
  try {
    if (returnTab) sessionStorage.setItem('nec_login_return_tab', returnTab)
    else sessionStorage.removeItem('nec_login_return_tab')
    sessionStorage.setItem('nec_login_scroll', String(window.scrollY))
  } catch { /* ignore */ }
  const redirect = location.origin + location.pathname
  // 登录只走默认授权、不带 scope：任务/邮箱等高级权限由"我的任务"绑定流程按需追加（rebind 授权，
  // 飞书授权对同一用户是累积的）。否则后台未把这些权限对全员开放时，普通成员会在授权页被整体拦截，连门户都进不来
  location.href = 'https://open.feishu.cn/open-apis/authen/v1/authorize?app_id='
    + encodeURIComponent(auth.config.feishuAppId || '')
    + '&redirect_uri=' + encodeURIComponent(redirect)
    + '&state=' + state
}

/** 登录入口统一守卫：未配置飞书应用时写 auth.error（由 AuthToast 内联提示）并返回 false */
export function tryStartLogin(): boolean {
  if (!auth.config.loginEnabled) { auth.error = '中台未配置飞书应用，请联系管理员'; return false }
  startLogin()
  return true
}

export async function logout() {
  await fetch('/auth/logout', { method: 'POST' }).catch(() => {})
  clearLocalSession()
}

/** 退出所有设备：后端删除本人全部会话 key 后，本机走与 logout() 相同的本地清理 */
export async function logoutAllDevices(): Promise<number> {
  const resp = await fetch('/api/auth/logout-all', { method: 'POST' })
  const data = await resp.json()
  if (!resp.ok || data.error) throw new Error(data.error || ('HTTP ' + resp.status))
  clearLocalSession()
  return data.revoked ?? 0
}

/** 主动登出后的本地清理：本会话不再自动重登（避免"刚登出又被拉回登录"），清 me 并广播 tick。
 *  管理员「下线本人会话」等场景（服务端会话已删、本机 Cookie 未清）也需要同样的本地清理，故导出。 */
export function clearLocalSession() {
  try { sessionStorage.setItem('nec_auto_login_off', '1') } catch { /* ignore */ }
  auth.me = { authenticated: false, user: null }
  auth.tick++
}

/** 账号密码登录（本地账号，open_id 为 local:<username>）：与飞书登录同一 nec_session Cookie */
export async function loginWithPassword(username: string, password: string): Promise<void> {
  const resp = await fetch('/auth/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: username.trim(), password }),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok || data.error) throw new Error(data.error || ('HTTP ' + resp.status))
  // 防止"账号登录成功后又被飞书 OAuth 自动重登覆盖"：标记本会话不再自动跳 OAuth
  try { sessionStorage.setItem('nec_auto_login_off', '1') } catch { /* ignore */ }
  auth.error = ''
  await refreshMe()
  auth.tick++
}

export function isLeader(): boolean {
  return !!(auth.me.authenticated && auth.me.user && hasRole(auth.me.user.role, LEADER_ROLE_RE))
}

/** 管理 Tab 可见口径：登录且角色命中 队长/组长 或 队长/指导/管理员（真正鉴权以后端 /api/admin/overview 为准） */
export function canAccessAdmin(): boolean {
  const role = auth.me.user?.role
  return !!(auth.me.authenticated && auth.me.user && (hasRole(role, LEADER_ROLE_RE) || hasRole(role, CONFIG_ADMIN_ROLE_RE)))
}
