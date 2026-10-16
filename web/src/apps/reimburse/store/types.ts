// 报销助手：类型、常量与纯函数（自原 store.ts 按域拆出，对外经 index 重导出）
import { auth } from '@shared/auth'
import { fmtSize } from '@shared/format'
import { FINANCE_MANAGER_ROLE_RE, hasRole } from '@shared/roles'
import { useStatusMeta } from '@shared/composables/useStatusMeta'

export interface ReimburseLine { cat: string; item: string; date: string; invno: string; amount: string; note: string }
export interface Payee { method: string; account_name: string; account_no: string; bank: string }
export interface CatalogGroup { group: string; items: { code: string; name: string }[] }
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
export interface SopCheck { key: string; label: string; pass: boolean }

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
const statusMeta = useStatusMeta(STATUS_COLORS, () => '#5A6472')
export const statusColor = statusMeta.meta

export { fmtSize }

export const today = () => new Date().toLocaleDateString('sv-SE') // 本地时区 YYYY-MM-DD

export function newLine(): ReimburseLine { return { cat: '', item: '', date: '', invno: '', amount: '', note: '' } }

/* ========== 明细行校验与派生 ========== */

export function validAmount(v: unknown) { return /^\d{1,7}(\.\d{1,2})?$/.test(String(v).trim()) && Number(v) > 0 }
export function seasonStart() { return new Date(new Date().getFullYear(), 0, 1) }
export function dateInSeason(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + 'T00:00:00')
  const t = new Date(); t.setHours(23, 59, 59, 999)
  return d >= seasonStart() && d <= t
}

/** 队长/财务：可见全员单据台账（与后端 canSeeFinanceDetail 同口径：auth.me.user.role 含 队长/财务） */
export const canManageLedger = () => !!(auth.me.authenticated && auth.me.user && hasRole(auth.me.user.role, FINANCE_MANAGER_ROLE_RE))
