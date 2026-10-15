// 报销助手（ERP 费用报销单）共享状态与业务逻辑：独立入口（/apps/reimburse/）与门户「报销」Tab 复用同一套
// 端点 / localStorage 键 / OCR 语义逐条对齐原 public/apps/reimburse/index.html
import { reactive, computed, watch } from 'vue'
import { auth } from '@shared/auth'
import { loadTesseract, TESS_OPTS } from '@shared/cdn'
import { ocrPdfText, parseFinanceText } from '@shared/ocr'

export interface ReimburseLine { cat: string; item: string; date: string; invno: string; amount: string; note: string }
export interface Payee { method: string; account_name: string; account_no: string; bank: string }
export interface CatalogGroup { group: string; items: { code: string; name: string }[] }

/* ========== 费用项目目录（D1 expense_items；未登录/接口失败时用内置兜底） ========== */

export const DEFAULT_CATALOG: CatalogGroup[] = [
  { group: '研发费用支出', items: [{ code: 'F38.01', name: '材料费' }, { code: 'F38.02', name: '差旅费' }, { code: 'F38.03', name: '招待费' }, { code: 'F38.04', name: '检测费' }, { code: 'F38.05', name: '认证费' }, { code: 'F38.06', name: '服务费' }] },
  { group: '生产加工', items: [{ code: 'F39.01', name: '打样费' }, { code: 'F39.02', name: '外协加工费' }, { code: 'F39.03', name: '模具费' }] },
  { group: '物料采购', items: [{ code: 'F40.01', name: '元器件' }, { code: 'F40.02', name: '结构件' }, { code: 'F40.03', name: '工具耗材' }] },
  { group: '运营办公', items: [{ code: 'F41.01', name: '办公用品' }, { code: 'F41.02', name: '快递运费' }, { code: 'F41.03', name: '宣传物料' }, { code: 'F41.04', name: '团建活动' }] },
  { group: '其他', items: [{ code: 'F99.01', name: '其他费用' }] },
]

export const fmtMoneyErp = (n: unknown) => '¥' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const STATUS_COLORS: Record<string, string> = {
  '审批中': '#1FA9E8', '已通过': '#16A34A', '已驳回': '#DC2626',
  '已撤销': '#9CA3AF', '已打款': '#15803D', '已完成': '#141B5E',
}
export function statusColor(s: string): string { return STATUS_COLORS[s] || '#5A6472' }

export function fmtSize(n: number) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB' }

export const today = () => new Date().toLocaleDateString('sv-SE') // 本地时区 YYYY-MM-DD

export function newLine(): ReimburseLine { return { cat: '', item: '', date: '', invno: '', amount: '', note: '' } }

/* ========== 费用报销单据列表（台账） ========== */

export interface LedgerRow {
  application_id: string
  title: string
  applicant: string
  status: string
  total: number
  paid: number | null
  handler: string
  created_at: number
  lines: number
}

/** 队长/财务：可见全员单据台账（与后端 canSeeFinanceDetail 同口径：auth.me.user.role 含 队长/财务） */
export const canManageLedger = () => !!(auth.me.authenticated && auth.me.user && /队长|财务/.test(auth.me.user.role || ''))

export const store = reactive({
  lines: [newLine()] as ReimburseLine[],
  selected: 0,
  docStatus: '暂存' as string, // 暂存 / 审批中
  docNo: '提交后自动生成',
  docDate: today(),
  noinv: '',
  note: '',
  payee: { method: '', account_name: '', account_no: '', bank: '' } as Payee,
  saveDefault: true,
  receiptFile: null as File | null,
  paymentFile: null as File | null,
  receiptStatus: '',
  paymentStatus: '',
  /** 自增即重挂载文件输入框（清空已选文件） */
  fileGen: 0,
  submitStatus: '',
  submitting: false,
  ocrRunning: 0,
  catalog: DEFAULT_CATALOG as CatalogGroup[],
  /** 最近一次提交/查看的单据附件 R2 keys（「查看附件」弹窗数据源） */
  lastAttachments: [] as string[],
  successId: '',
  successVisible: false,
  catModal: { open: false, group: DEFAULT_CATALOG[0].group, temp: '', search: '' },
  flowModalOpen: false,
  attachModalOpen: false,
  docModal: { open: false, doc: null as any },
  mine: { state: 'idle' as 'idle' | 'loading' | 'login' | 'erp' | 'bitable' | 'hint' | 'error', docs: [] as any[], records: [] as any[], hint: '' },
  /** 视图：填报 / 我的报销 / 单据列表（台账） */
  view: 'form' as 'form' | 'mine' | 'ledger',
  /** 单据列表台账：队长/财务走 /api/erp/reimburse/manage（全量分页），普通成员回退 docs/mine 映射 */
  ledger: {
    state: 'idle' as 'idle' | 'loading' | 'login' | 'error' | 'mine',
    docs: [] as LedgerRow[],
    total: 0,
    page: 1,
    pageSize: 20,
    q: '',
    sort: 'desc' as 'desc' | 'asc',
    statusFilter: '全部',
  },
})

/* ========== 明细行校验与派生 ========== */

export function validAmount(v: unknown) { return /^\d{1,7}(\.\d{1,2})?$/.test(String(v).trim()) && Number(v) > 0 }
export function seasonStart() { return new Date(new Date().getFullYear(), 0, 1) }
export function dateInSeason(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + 'T00:00:00')
  const t = new Date(); t.setHours(23, 59, 59, 999)
  return d >= seasonStart() && d <= t
}

export const lineTotal = computed(() => store.lines.reduce((s, l) => s + (validAmount(l.amount) ? Number(l.amount) : 0), 0))

export function addLine() {
  store.lines.push(newLine())
  store.selected = store.lines.length - 1
}

export function delLines(checked: number[]) {
  const drop = new Set(checked.length ? checked : [store.selected])
  if (store.lines.length - drop.size < 1) { alert('至少保留一行明细'); return }
  store.lines = store.lines.filter((_, i) => !drop.has(i))
  store.selected = Math.min(store.selected, store.lines.length - 1)
}

export function selectLine(i: number) { store.selected = i }

/* ========== 费用项目选择弹窗 ========== */

export function openCatModal(row: number) {
  store.selected = row
  store.catModal.temp = store.lines[row] ? store.lines[row].cat : ''
  store.catModal.search = ''
  if (!store.catalog.some(g => g.group === store.catModal.group)) store.catModal.group = store.catalog[0].group
  store.catModal.open = true
}
export function closeCatModal() { store.catModal.open = false }
export function pickCat(v: string) { store.catModal.temp = v }
export function confirmCat() {
  if (store.catModal.temp && store.lines[store.selected]) store.lines[store.selected].cat = store.catModal.temp
  closeCatModal()
}

/* ========== SOP 校验（财务报销规范 · 全部通过后方可提交） ========== */

export interface SopCheck { key: string; label: string; pass: boolean }

export const sopList = computed<SopCheck[]>(() => {
  const filled = store.lines.filter(l => l.cat || l.item || l.amount || l.invno || l.date)
  const linesOk = filled.length > 0 && filled.every(l => l.cat && l.item.trim() && validAmount(l.amount))
  const invnoOk = filled.every(l => !l.invno.trim() || /^\d{8}$|^\d{20}$/.test(l.invno.trim()))
  const dateOk = filled.every(l => !l.date || dateInSeason(l.date))
  const hasReceipt = !!store.receiptFile
  const noinv = store.noinv.trim()
  // 与审批引擎 conditional 对齐：无发票照片附件 → 无票说明必填；有票时至少一行填合规发票号
  const materialOk = hasReceipt || !!noinv
  const invnoRequiredOk = noinv ? true : filled.some(l => /^\d{8}$|^\d{20}$/.test(l.invno.trim()))
  return [
    { key: 'lines', label: '至少一行明细，且每行费用项目 / 事项说明 / 金额齐全（金额 > 0，最多两位小数）', pass: linesOk },
    { key: 'invno', label: '发票号为 8 或 20 位数字；未填「无票说明」时至少一行须填发票号', pass: invnoOk && invnoRequiredOk },
    { key: 'date', label: '开票日期在本赛季内（' + new Date().getFullYear() + ' 赛季，且不晚于今天）', pass: dateOk },
    { key: 'material', label: '有发票照片（附件区上传），或填写整单「无票说明」', pass: materialOk },
    { key: 'ocr', label: '无进行中的识别任务', pass: store.ocrRunning === 0 },
  ]
})

export const canSubmit = computed(() => sopList.value.every(c => c.pass) && store.docStatus !== '审批中' && !store.submitting)

/* ========== 草稿（localStorage） ========== */

const DRAFT_KEY = 'nec_reimburse_erp_draft'
let draftTimer: ReturnType<typeof setTimeout> | null = null
export function queueDraft() {
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(() => {
    try {
      const draft = { lines: store.lines, noinv: store.noinv, note: store.note, savedAt: Date.now() }
      const hasContent = store.lines.some(l => l.cat || l.item || l.amount) || draft.noinv || draft.note
      if (hasContent) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
      else localStorage.removeItem(DRAFT_KEY)
    } catch { /* 隐私模式跳过 */ }
  }, 400)
}
export function saveDraftNow() {
  queueDraft()
  store.submitStatus = '💾 草稿已保存到浏览器本地'
}
export function restoreDraft() {
  let draft: any = null
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') } catch { return }
  if (!draft) return
  if (Array.isArray(draft.lines) && draft.lines.length) store.lines = draft.lines.map((l: any) => Object.assign(newLine(), l))
  if (draft.noinv) store.noinv = draft.noinv
  if (draft.note) store.note = draft.note
  if (draft.lines || draft.noinv || draft.note) {
    store.submitStatus = '📝 已恢复 ' + new Date(draft.savedAt).toLocaleString('zh-CN') + ' 的未提交草稿（附件需重新上传）'
  }
}
export function clearDraft() {
  if (draftTimer) clearTimeout(draftTimer)
  try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
}

watch(() => [store.lines, store.noinv, store.note], queueDraft, { deep: true })

/* ========== OCR（Tesseract.js 本地识别，回填选中行） ========== */

export async function recognizeFile(kind: 1 | 2, f: File | null) {
  const stKey = kind === 1 ? 'receiptStatus' : 'paymentStatus'
  if (kind === 1) store.receiptFile = f
  else store.paymentFile = f
  if (!f) return
  if (f.size > 10 * 1024 * 1024) {
    store[stKey] = '⚠ 文件超过 10MB 上限，请压缩后再上传'
    if (kind === 1) store.receiptFile = null
    else store.paymentFile = null
    store.fileGen++
    return
  }
  store.ocrRunning++
  store[stKey] = '🔍 识别中（首次需加载识别引擎，约十几秒）…'
  const st = { set textContent(v: string) { store[stKey] = v }, get textContent() { return store[stKey] } }
  try {
    const Tesseract = await loadTesseract()
    let text: string
    if (f.type === 'application/pdf') {
      text = await ocrPdfText(f, Tesseract, st)
    } else {
      const res = await Tesseract.recognize(f, 'chi_sim+eng', Object.assign({}, TESS_OPTS, {
        logger: (m: any) => { if (m.status === 'recognizing text') store[stKey] = '🔍 识别中 ' + Math.round(m.progress * 100) + '%…' },
      }))
      text = res && res.data && res.data.text
    }
    const found = parseFinanceText(text)
    // OCR 回填选中行：不覆盖用户手改（行内字段已有值则跳过该字段）
    if (!store.lines[store.selected]) { store.lines.push(newLine()); store.selected = store.lines.length - 1 }
    const line = store.lines[store.selected]
    const hints: string[] = [], skipped: string[] = []
    if (found.amount) { if (line.amount) skipped.push('金额 ¥' + found.amount); else { line.amount = found.amount; hints.push('金额 ¥' + found.amount) } }
    if (found.date) { if (line.date) skipped.push('日期 ' + found.date); else { line.date = found.date; hints.push('日期 ' + found.date) } }
    if (found.invno && kind === 1) { if (line.invno) skipped.push('发票号 ' + found.invno); else { line.invno = found.invno; hints.push('发票号 ' + found.invno) } }
    store[stKey] = '✅ ' + f.name + ' · 识别回填到第 ' + (store.selected + 1) + ' 行：'
      + (hints.length ? hints.join(' · ') : '无新字段（已有值未覆盖）')
      + (skipped.length ? '；跳过 ' + skipped.join(' · ') : '')
  } catch (e: any) {
    store[stKey] = '⚠ 识别失败：' + (e.message || e) + '，请手动填写'
  } finally {
    store.ocrRunning--
  }
}

/* ========== 提交 ========== */

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
    alert('单据加载失败：' + (e.message || e))
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
