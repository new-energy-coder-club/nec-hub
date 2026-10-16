// 硬件评审：共享状态（视图 / 列表 / 详情 / 提交表单 / 草稿横幅）
import { reactive } from 'vue'
import type { HwUser, Review, SpecRow, HwFile, DraftState } from './meta'

export const store = reactive({
  view: 'list' as 'list' | 'submit' | 'detail',
  displayMode: 'board' as 'board' | 'table',
  configured: true,
  currentUser: null as HwUser | null,
  reviews: [] as Review[],
  listState: 'loading' as 'loading' | 'ok' | 'error' | 'unconfigured',
  listError: '',
  detail: null as Review | null,
  detailState: 'loading' as 'loading' | 'ok' | 'error',
  detailError: '',
  // 提交表单
  form: {
    projectId: '',
    hardwareName: '',
    hardwareType: 'other',
    hardwareVersion: '',
    designerId: '',
    designNotes: '',
  },
  designerName: '加载中…',
  designerGray: true,
  designerAvatar: '',
  designerOverride: '',
  specRows: [] as SpecRow[],
  filesBatch: '',
  uploadedFiles: [] as HwFile[],
  fieldErrors: {} as Record<string, string>,
  submitting: false,
  submitResult: { text: '', ok: false },
  draftStatus: '',
  draftBanner: false,
  draftTime: '',
  pendingDraft: null as DraftState | null,
  prefilled: false,
  designNotesTemplate: '',
})
