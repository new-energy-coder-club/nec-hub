// 图纸评审状态字典（看板/列表/流程看板共用）
export const DR_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: '待提交', cls: 'bg-gray-100 text-gray-600' },
  pending_review: { label: '待评审', cls: 'bg-blue-50 text-blue-700' },
  in_review: { label: '评审中', cls: 'bg-amber-50 text-amber-700' },
  rectifying: { label: '待整改', cls: 'bg-orange-50 text-orange-700' },
  bom_generating: { label: 'BOM生成中', cls: 'bg-purple-50 text-purple-700' },
  assessing: { label: '评估中', cls: 'bg-indigo-50 text-indigo-700' },
  scheduling: { label: '排期中', cls: 'bg-pink-50 text-pink-700' },
  procuring: { label: '采购中', cls: 'bg-teal-50 text-teal-700' },
  archived: { label: '已归档', cls: 'bg-green-50 text-green-700' },
}

// 询价单状态
export const DR_INQ_STATUS: Record<string, { label: string; cls: string }> = {
  sent: { label: '已发出', cls: 'bg-blue-50 text-blue-700' },
  quoted: { label: '已报价', cls: 'bg-amber-50 text-amber-700' },
  selected: { label: '已选定', cls: 'bg-green-50 text-green-700' },
  rejected: { label: '未中选', cls: 'bg-gray-100 text-gray-400' },
}

// 甘特图节点
export const DR_GANTT_MS: Record<string, string> = { submit: '提交', meeting: '会议', conclusion: '结论', bom: 'BOM', archived: '归档' }
