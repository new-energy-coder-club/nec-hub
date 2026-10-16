// 报销助手：我的报销 / 单据列表台账 / 单据详情与复制 / 登录后元数据（目录 + 默认收款账户）
import { auth } from '@shared/auth'
import { toast } from '@shared/ui/feedback'
import { canManageLedger, newLine, type CatalogGroup, type LedgerRow } from './types'
import { store } from './state'
import { resetAll } from './submit'

/* ========== 我的报销（优先 D1 单据快照；无快照时回退审批底表列表） ========== */

export async function loadMine() {
  const mine = store.mine
  mine.state = 'loading'
  try {
    const r1 = await fetch('/api/erp/reimburse/docs/mine')
    if (r1.status === 401) { mine.state = 'login'; return }
    if (r1.ok) {
      const d1 = await r1.json()
      if ((d1.docs || []).length) { mine.docs = d1.docs; mine.state = 'erp'; return }
    }
  } catch { /* 回退审批底表 */ }
  try {
    const resp = await fetch('/api/approvals/mine?type=reimburse')
    if (resp.status === 401) { mine.state = 'login'; return }
    const d = await resp.json()
    if (d.hint && !(d.records || []).length) { mine.hint = d.hint; mine.state = 'hint'; return }
    mine.records = d.records || []
    mine.state = 'bitable'
  } catch {
    mine.state = 'error'
  }
}

/* ========== 单据列表台账（费用报销单列表：队长/财务全量分页 + 普通成员回退「我的报销」映射） ========== */

/** manage 行 → LedgerRow（后端坏值时逐字段兜底） */
function mapManageRow(r: any): LedgerRow {
  return {
    application_id: String(r.application_id || ''),
    title: String(r.title || '未填事项'),
    applicant: String(r.applicant || ''),
    status: String(r.status || ''),
    total: Number(r.total) || 0,
    paid: r.paid == null ? null : Number(r.paid) || 0,
    handler: String((r.handler != null && r.handler !== '') ? r.handler : r.applicant || ''),
    created_at: Number(r.created_at) || 0,
    lines: Number(r.lines) || 0,
  }
}

/** docs/mine 行 → LedgerRow（本人摘要：已付现金额无、处理人为本人、申请人为登录用户） */
function mapMineRow(d: any): LedgerRow {
  const name = (auth.me.user && auth.me.user.name) || ''
  return {
    application_id: String(d.application_id || ''),
    title: String(d.firstItem || '未填事项'),
    applicant: name,
    status: String(d.status || ''),
    total: Number(d.total) || 0,
    paid: null,
    handler: name,
    created_at: Number(d.created_at) || 0,
    lines: Number(d.lines) || 0,
  }
}

/** 台账「我的报销」数据源：docs/mine 列表映射为同形行（无 total 字段时按行长兜底） */
export async function loadLedgerMine() {
  const l = store.ledger
  try {
    const resp = await fetch('/api/erp/reimburse/docs/mine')
    if (resp.status === 401) { l.state = 'login'; return }
    const d = await resp.json()
    if (!resp.ok || d.error) { l.state = 'error'; return }
    const docs = (Array.isArray(d.docs) ? d.docs : []).map(mapMineRow)
    l.docs = docs
    l.total = Number(d.total) || docs.length
    l.page = 1
    l.state = 'mine'
  } catch {
    l.state = 'error'
  }
}

/** 加载单据列表：队长/财务走 manage 分页接口，其余或接口不可用时走本人单据映射 */
export async function loadLedger() {
  const l = store.ledger
  l.state = 'loading'
  if (canManageLedger()) {
    try {
      const params = new URLSearchParams({ page: String(l.page), pageSize: String(l.pageSize), sort: l.sort })
      const q = l.q.trim()
      if (q) params.set('q', q)
      const resp = await fetch('/api/erp/reimburse/manage?' + params.toString())
      if (resp.status === 401) { l.state = 'login'; return }
      const d = await resp.json()
      if (!resp.ok || d.error) { await loadLedgerMine(); return }
      l.docs = (Array.isArray(d.docs) ? d.docs : []).map(mapManageRow)
      l.total = Number(d.total) || 0
      l.page = Number(d.page) || l.page
      l.pageSize = Number(d.pageSize) || l.pageSize
      l.state = 'idle'
      return
    } catch {
      await loadLedgerMine()
      return
    }
  }
  await loadLedgerMine()
}

/** 台账搜索（回车/点按钮）：重置页码后重新加载 */
export function searchLedger() {
  store.ledger.page = 1
  loadLedger()
}

/** 台账「新增报销」：切回填报视图并滚动顶部 */
export function gotoForm() {
  store.view = 'form'
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/* ========== 单据详情 / 复制为新增 ========== */

export async function openDoc(id: string, copy: boolean) {
  let d: any
  try {
    const resp = await fetch('/api/erp/reimburse/docs/' + encodeURIComponent(id))
    d = await resp.json()
    if (!resp.ok || d.error) throw new Error(d.error || ('HTTP ' + resp.status))
  } catch (e: any) {
    toast('单据加载失败：' + (e.message || e))
    return
  }
  if (copy) { copyDocToForm(d); return }
  store.docModal.doc = d
  store.lastAttachments = (d.payload && d.payload.attachments) || []
  store.docModal.open = true
}

export function copyDocToForm(d: any) {
  const p = d.payload || {}
  resetAll()
  store.lines = (p.lines && p.lines.length ? p.lines : [newLine()]).map((l: any) => Object.assign(newLine(), l))
  store.selected = 0
  store.noinv = p.noinv || ''
  store.note = p.note || ''
  if (p.payee) {
    store.payee.method = p.payee.method || ''
    store.payee.account_name = p.payee.account_name || ''
    store.payee.account_no = p.payee.account_no || ''
    store.payee.bank = p.payee.bank || ''
  }
  store.docModal.open = false
  store.submitStatus = '📋 已复制 ' + d.application_id + ' 的明细与收款信息（附件需重新上传）'
}

/* ========== 登录后元数据：D1 费用项目目录 + 我的默认收款账户 ========== */

export async function loadErpMeta() {
  try {
    const resp = await fetch('/api/erp/reimburse/meta')
    if (!resp.ok) return
    const d = await resp.json()
    if (Array.isArray(d.items) && d.items.length) {
      const groups: CatalogGroup[] = []
      for (const it of d.items) {
        let g = groups.find(x => x.group === it.grp)
        if (!g) { g = { group: it.grp, items: [] }; groups.push(g) }
        g.items.push({ code: it.code, name: it.name })
      }
      store.catalog = groups
      if (!store.catalog.some(g => g.group === store.catModal.group)) store.catModal.group = store.catalog[0].group
    }
    if (d.payee) {
      if (d.payee.method) store.payee.method = d.payee.method
      if (d.payee.account_name) store.payee.account_name = d.payee.account_name
      if (d.payee.account_no) store.payee.account_no = d.payee.account_no
      if (d.payee.bank) store.payee.bank = d.payee.bank
    }
  } catch { /* 目录兜底，收款留空 */ }
}
