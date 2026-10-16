// 报销助手：凭证上传与提交（/api/approvals/upload → /api/erp/reimburse/submit）
import { auth } from '@shared/auth'
import { newLine, today, validAmount, type Payee } from './types'
import { store } from './state'
import { sopList } from './sop'
import { clearDraft } from './draft'
import { loadMine } from './ledger'

async function uploadFiles(): Promise<any[]> {
  const fd = new FormData()
  if (store.receiptFile) fd.set('receipt', store.receiptFile)
  if (store.paymentFile) fd.set('payment', store.paymentFile)
  if (!store.receiptFile && !store.paymentFile) return []
  const resp = await fetch('/api/approvals/upload', { method: 'POST', body: fd })
  const data = await resp.json()
  if (!resp.ok || data.error) throw new Error(data.error || ('凭证上传失败 HTTP ' + resp.status))
  return data.files || []
}

function currentPayee(): Payee {
  return {
    method: store.payee.method,
    account_name: store.payee.account_name.trim() || (auth.me.user ? auth.me.user.name : ''),
    account_no: store.payee.account_no.trim(),
    bank: store.payee.bank.trim(),
  }
}

export async function submitReimburse(andNew: boolean) {
  if (store.docStatus === '审批中') { store.submitStatus = '⚠ 当前单据已提交，请「再报一笔」新建'; return }
  if (!sopList.value.every(c => c.pass)) { store.submitStatus = '⚠ 请先补齐 SOP 缺项'; return }
  if (store.submitting) return
  store.submitting = true
  try {
    store.submitStatus = '上传凭证中…'
    const uploaded = await uploadFiles()
    const keys = uploaded.map((f: any) => f.key)
    const filled = store.lines.filter(l => l.cat && l.item.trim() && validAmount(l.amount))

    store.submitStatus = '发起审批中…'
    const resp = await fetch('/api/erp/reimburse/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lines: filled,
        note: store.note.trim(),
        noinv: store.noinv.trim(),
        payee: currentPayee(),
        attachments: keys,
      }),
    })
    const data = await resp.json()
    if (!resp.ok || data.error) {
      const detail = Array.isArray(data.detail) && data.detail.length ? '：' + data.detail.join('；') : ''
      throw new Error((data.error || ('HTTP ' + resp.status)) + detail)
    }

    store.lastAttachments = keys
    // 存为默认收款账户（D1，下次自动带出）
    if (store.saveDefault) {
      fetch('/api/erp/reimburse/payee', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(currentPayee()),
      }).catch(() => {})
    }

    store.docStatus = '审批中'
    store.docNo = data.application_id
    store.successId = data.application_id
    store.successVisible = true
    store.submitStatus = ''
    clearDraft()
    loadMine()
    if (andNew) {
      const doneId = data.application_id
      resetAll()
      store.submitStatus = '✅ 已提交 ' + doneId + '（审批中），可继续录入下一笔'
    }
  } catch (e: any) {
    store.submitStatus = '❌ 提交失败：' + (e.message || e)
  } finally {
    store.submitting = false
  }
}

export function resetAll() {
  store.docStatus = '暂存'
  store.docNo = '提交后自动生成'
  store.lines = [newLine()]
  store.selected = 0
  store.noinv = ''
  store.note = ''
  store.receiptFile = null
  store.paymentFile = null
  store.receiptStatus = ''
  store.paymentStatus = ''
  store.fileGen++
  store.successVisible = false
  store.docDate = today()
  store.lastAttachments = []
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
