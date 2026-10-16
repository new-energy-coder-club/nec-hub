// 域名分发：共享状态与业务逻辑，fetch 端点 / 提示文案 / 权限门控逐条对齐原 public/apps/domains/index.html
import { reactive } from 'vue'
import { confirmDialog } from '@shared/ui/feedback'

export interface DomainRow {
  fqdn: string
  type: string
  target: string
  description?: string
  owner?: string
  status: string
  subdomain: string
  deep?: boolean
}

export interface DomainForm {
  subdomain: string
  type: string
  target: string
  description: string
  proxied: boolean
}

export const store = reactive({
  /** 由 /api/domains 的 zone 字段驱动（zone-label / 表单后缀） */
  zone: 'newenergycoder.club',
  /** 由 /api/domains/mine 的 limit 字段驱动 */
  limit: 3,
  /** false 时展示「待同步」提示条（原 #tip-sync） */
  syncEnabled: true,
  me: null as { name: string; role?: string } | null,
  mine: [] as DomainRow[],
  publicList: [] as DomainRow[],
  mineLoading: true,
  publicLoading: true,
  form: { subdomain: '', type: 'CNAME', target: '', description: '', proxied: false } as DomainForm,
  submitting: false,
  toast: { msg: '', ok: true, visible: false },
})

/* ========== fetch 封装（401 → 跳回门户，与原页一致） ========== */

async function api(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(path, options)
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) { location.href = '/'; throw new Error('请先登录') }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

/* ========== toast（3.2s 自动隐藏） ========== */

let toastTimer: ReturnType<typeof setTimeout> | null = null
export function toast(msg: string, ok = true) {
  store.toast = { msg, ok, visible: true }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { store.toast.visible = false }, 3200)
}

/* ========== 状态徽章 ========== */

const STATUS_MAP: Record<string, [string, string]> = {
  active: ['bg-green-50 text-green-700', '已生效'],
  pending: ['bg-amber-50 text-amber-700', '待同步'],
  failed: ['bg-red-50 text-red-600', '同步失败'],
}
export function statusOf(status: string): [string, string] {
  return STATUS_MAP[status] || ['bg-gray-100 text-gray-500', status]
}

/* ========== 数据加载 ========== */

export async function loadMine() {
  const data = await api('/api/domains/mine')
  store.limit = data.limit ?? 3
  store.mine = data.domains || []
  store.mineLoading = false
}

export async function loadPublic() {
  const data = await api('/api/domains')
  store.zone = data.zone
  store.syncEnabled = !!data.syncEnabled
  store.publicList = data.domains || []
  store.publicLoading = false
}

/* ========== 权限门控：未登录跳回门户（与原页启动 IIFE 一致） ========== */

export async function boot() {
  try {
    const me = await api('/api/whoami')
    if (!me.authenticated) { location.href = '/'; return }
    store.me = me.user
    await Promise.all([loadMine(), loadPublic()])
  } catch (e: any) {
    if (e.message !== '请先登录') toast(e.message, false)
  }
}

/* ========== 释放 / 重试同步 ========== */

export async function delDomain(sub: string) {
  if (!(await confirmDialog(`确定释放 ${sub} 域名？DNS 记录将一并删除。`))) return
  try {
    await api('/api/domains/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subdomain: sub }) })
    toast('已释放')
    await Promise.all([loadMine(), loadPublic()])
  } catch (e: any) { toast(e.message, false) }
}

export async function retryDomain(sub: string) {
  try {
    const data = await api('/api/domains/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subdomain: sub }) })
    toast(data.hint || '同步完成')
    await Promise.all([loadMine(), loadPublic()])
  } catch (e: any) { toast(e.message, false) }
}

/* ========== 申请新域名 ========== */

export async function submitClaim(ev: Event) {
  ev.preventDefault()
  store.submitting = true
  try {
    const data = await api('/api/domains', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subdomain: store.form.subdomain,
        type: store.form.type,
        target: store.form.target,
        description: store.form.description,
        proxied: store.form.proxied,
      }),
    })
    toast(data.hint || '申请成功')
    // 等价于原页 form.reset()：v-model 下需手动复位各字段
    store.form = { subdomain: '', type: 'CNAME', target: '', description: '', proxied: false }
    await Promise.all([loadMine(), loadPublic()])
  } catch (e: any) { toast(e.message, false) }
  finally { store.submitting = false }
}
