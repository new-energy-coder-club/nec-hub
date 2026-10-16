// 图纸评审共享类型与状态映射（自原 public/apps/drawing-review/index.html 内联脚本迁出，文案与配色逐字保留）

export type ViewName = 'list' | 'submit' | 'detail'

export interface Review {
  reviewId: string
  projectId: string
  machineName: string
  drawingVersion: string
  designerId: string
  designNotes: string
  status: string
  createdAt: string
  meetingId?: string
  meetingLink?: string
  meetingStartTime?: string
}

export interface Inquiry {
  inquiryId: string
  bomItemId: string
  status: string
  supplierName: string
  quantity: number | string
  materialName?: string
  materialCode?: string
  specification?: string
  requiredDate?: string
  price?: number | null
  deliveryDate?: string
}

export interface CompareQuote {
  inquiryId: string
  supplierName: string
  price?: number | null
  deliveryDate?: string
  late?: boolean
}

export interface CompareMaterial {
  bomItemId: string
  materialName?: string
  materialCode?: string
  quotes: CompareQuote[]
  recommendedInquiryId?: string
  lowestPriceInquiryId?: string
  shortestDeliveryInquiryId?: string
  reason?: string
}

export interface CompareResult {
  materials?: CompareMaterial[]
}

// 评审单状态：label / 徽标配色与原单文件版 statusMap 一致
export const DR_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: '待提交', color: 'background:#EEF1F8;color:#5A6472' },
  pending_review: { label: '待评审', color: 'background:#E8ECFB;color:#1A2FA0' },
  in_review: { label: '评审中', color: 'background:#FFF4DB;color:#92610B' },
  rectifying: { label: '待整改', color: 'background:#FDEADD;color:#B04A0F' },
  bom_generating: { label: 'BOM生成中', color: 'background:#EFE9FB;color:#6A3FB5' },
  assessing: { label: '评估中', color: 'background:#E7EAFB;color:#3D4BA8' },
  scheduling: { label: '排期中', color: 'background:#FBE7F0;color:#B02E6B' },
  procuring: { label: '采购中', color: 'background:#E0F4F2;color:#0F7A72' },
  archived: { label: '已归档', color: 'background:#E3F6EC;color:#177A4C' },
}

const DR_STATUS_FALLBACK = { label: '', color: 'background:#EEF1F8;color:#5A6472' }
export function drStatus(status: string) {
  const s = DR_STATUS[status]
  return s ? s : { ...DR_STATUS_FALLBACK, label: status }
}

// 询价单状态：与原 DR_INQ_STATUS 一致
export const DR_INQ_STATUS: Record<string, { label: string; color: string }> = {
  sent: { label: '已发出', color: 'background:#E8ECFB;color:#1A2FA0' },
  quoted: { label: '已报价', color: 'background:#FFF4DB;color:#92610B' },
  selected: { label: '已选定', color: 'background:#E3F6EC;color:#177A4C' },
  rejected: { label: '未中选', color: 'background:#EEF1F8;color:#5A6472' },
}

export function drInqStatus(status: string) {
  return DR_INQ_STATUS[status] || DR_INQ_STATUS.sent
}

// 甘特图节点（流程看板）
export const DR_GANTT_MS: Record<string, string> = { submit: '提交', meeting: '会议', conclusion: '结论', bom: 'BOM', archived: '归档' }
