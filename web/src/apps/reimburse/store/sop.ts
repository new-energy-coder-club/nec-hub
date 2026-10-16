// 报销助手：SOP 校验（财务报销规范 · 全部通过后方可提交）
import { computed } from 'vue'
import { validAmount, dateInSeason, type SopCheck } from './types'
import { store } from './state'

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
