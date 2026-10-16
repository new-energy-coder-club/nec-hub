// 报销助手：共享状态（填报表单 / 弹窗 / 我的报销 / 单据台账）
import { reactive } from 'vue'
import { DEFAULT_CATALOG, newLine, today, type ReimburseLine, type Payee, type CatalogGroup, type LedgerRow } from './types'

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
