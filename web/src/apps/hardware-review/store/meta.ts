// 硬件评审：类型、常量与纯函数（自原 store.ts 按域拆出，对外经 index 重导出）
import { apiMod } from '@shared/api'
import { fmtSize } from '@shared/format'
import { useStatusMeta } from '@shared/composables/useStatusMeta'

export interface HwUser { open_id: string; name?: string; avatar_url?: string }
export interface SpecRow { key: string; value: string; note: string }
export interface HwFile { name: string; token?: string; url?: string; size?: number; uploading?: boolean }
export interface Review {
  reviewId: string
  projectId: string
  hardwareName: string
  hardwareType: string
  hardwareVersion: string
  status: string
  designNotes: string
  designerId: string
  specification?: string
  meetingId?: string
  meetingLink?: string
  meetingStartTime?: number
  createdAt: number
}
export interface DraftState {
  projectId?: string
  hardwareName?: string
  hardwareType?: string
  hardwareVersion?: string
  designerId?: string
  designerName?: string
  spec?: SpecRow[]
  filesBatch?: string
  uploadedFiles?: HwFile[]
  designNotes?: string
  savedAt?: string
}
export interface MeetingForm { startTime: string; durationMinutes: number | string; attendeeOpenIds: string }
export interface MinutesForm {
  meetingTime: string
  attendees: string
  topics: string
  discussion: string
  issues: string
  nextActions: string
  conclusion: string
  conclusionNotes: string
}
export interface ReportForm { summary: string; checklist: string }

// 与原单文件版 api() 同语义：非 2xx 抛出带后端 error 文案的 Error
export const api = (path: string, options: RequestInit = {}) => apiMod('', path, options)
export const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err))

export const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: '待提交', color: 'background:#EEF1F8;color:#5A6472' },
  pending_review: { label: '待评审', color: 'background:#E8ECFB;color:#1A2FA0' },
  in_review: { label: '评审中', color: 'background:#FFF4DB;color:#92610B' },
  rectifying: { label: '待整改', color: 'background:#FDEADD;color:#B04A0F' },
  report_generating: { label: '报告生成中', color: 'background:#EFE9FB;color:#6A3FB5' },
  assessing: { label: '评估中', color: 'background:#E7EAFB;color:#3D4BA8' },
  approved: { label: '已通过', color: 'background:#E3F6EC;color:#177A4C' },
  archived: { label: '已归档', color: 'background:#EDF0F7;color:#141B5E' },
}
export const TYPE_MAP: Record<string, string> = {
  controller: '控制器',
  sensor: '传感器',
  actuator: '执行器',
  motor: '电机/驱动',
  power: '电源/电池',
  communication: '通信模块',
  structure: '结构件',
  other: '其他',
}
// 流程步骤条：提交 → 预约会议 → 保存纪要 → 评审报告 → 评估归档
export const FLOW_STEPS = ['提交评审单', '预约会议', '保存纪要', '评审报告', '评估归档']
export const STATUS_STEP: Record<string, number> = {
  draft: 0, pending_review: 1, in_review: 2, rectifying: 2,
  report_generating: 3, assessing: 4, approved: 4, archived: 5,
}
// 规格参数：键值对编辑器 + 类型模板
export const SPEC_TEMPLATES: Record<string, string[]> = {
  controller: ['主控芯片', '工作电压', '工作电流', '通信接口', '防护等级'],
  sensor: ['测量范围', '精度', '供电电压', '输出接口', '防护等级'],
  actuator: ['额定电压', '额定电流', '行程/角度', '负载能力', '防护等级'],
  motor: ['额定电压', '额定功率', '额定转速', '额定扭矩', '防护等级'],
  power: ['额定电压', '容量', '充放电倍率', '循环寿命', '防护等级'],
  communication: ['通信协议', '工作频段', '传输速率', '供电电压', '防护等级'],
  structure: ['材料', '外形尺寸', '重量', '表面处理', '公差等级'],
  other: [],
}
export const DRAFT_KEY = 'hw-review-draft'

const statusMeta = useStatusMeta(STATUS_MAP, status => ({ label: status, color: 'background:#EEF1F8;color:#5A6472' }))
export const statusOf = statusMeta.meta

export function typeLabel(t: string) {
  return TYPE_MAP[t] || t || '其他'
}
export function stepOf(status: string) {
  return STATUS_STEP[status] ?? 0
}

export function parseLines(text: string) {
  return (text || '').split('\n').map(s => s.trim()).filter(Boolean)
}
export function parseOpenIds(text: string) {
  return (text || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean)
}

export function defaultMeetingTime() {
  const d = new Date(Date.now() + 24 * 3600 * 1000)
  d.setHours(14, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const formatSize = fmtSize
