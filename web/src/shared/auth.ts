// 飞书登录态（FE-01）：OAuth 跳转登录 + 会话 Cookie + 角色徽章
import { reactive } from 'vue'
import { pendingHash } from '@shared/pendingTab'

export interface HubUser {
  name: string
  open_id: string
  role?: string
  group?: string
  avatar_url?: string
}

export const auth = reactive({
  config: { loginEnabled: false, feishuAppId: null as string | null },
  me: { authenticated: false, user: null as HubUser | null },
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

export interface LastLogin { name?: string; avatar_url?: string; at?: number }

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
  if (code) {
    const state = params.get('state')
    const saved = sessionStorage.getItem('nec_oauth_state')
    history.replaceState(null, '', location.pathname + location.hash)
    if (state && saved && state !== saved) {
      alert('登录校验失败（state 不匹配），请重试')
    } else {
      try {
        const resp = await fetch('/auth/feishu', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code }),
        })
        const data = await resp.json()
        if (!resp.ok || data.error) throw new Error(data.error || ('HTTP ' + resp.status))
      } catch (e: any) {
        alert('飞书登录失败：' + (e.message || e))
      }
    }
    sessionStorage.removeItem('nec_oauth_state')
  }
  await refreshMe()
  auth.tick++
}

export async function refreshMe() {
  try { auth.me = await (await fetch('/api/whoami')).json() }
  catch { auth.me = { authenticated: false, user: null } }
}

export function startLogin() {
  const state = crypto.randomUUID()
  sessionStorage.setItem('nec_oauth_state', state)
  // OAuth 往返会丢 hash：把暂存的深链目标带入 sessionStorage，登录回来后由 bootAuth 重放
  if (pendingHash.tab) sessionStorage.setItem('nec_login_return_tab', pendingHash.tab)
  const redirect = location.origin + location.pathname
  // scope：task:task:read 读任务 + task:tasklist:read 读清单 + mail:user_mailbox.message:send 邮件通道发信（G-05）；
  // scope 变化后老用户需重新授权一次，"我的任务"/邮件发信才能绑定
  location.href = 'https://open.feishu.cn/open-apis/authen/v1/authorize?app_id='
    + encodeURIComponent(auth.config.feishuAppId || '')
    + '&redirect_uri=' + encodeURIComponent(redirect)
    + '&state=' + state
    + '&scope=' + encodeURIComponent('task:task:read task:tasklist:read mail:user_mailbox.message:send')
}

export async function logout() {
  await fetch('/auth/logout', { method: 'POST' }).catch(() => {})
  auth.me = { authenticated: false, user: null }
  auth.tick++
}

export function isLeader(): boolean {
  return !!(auth.me.authenticated && auth.me.user && /队长|组长/.test(auth.me.user.role || ''))
}
