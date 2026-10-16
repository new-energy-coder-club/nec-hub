// 报销助手：OCR（Tesseract.js 本地识别，回填选中行；不覆盖用户手改）
import { loadTesseract, TESS_OPTS } from '@shared/cdn'
import { ocrPdfText, parseFinanceText } from '@shared/ocr'
import { newLine } from './types'
import { store } from './state'

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
