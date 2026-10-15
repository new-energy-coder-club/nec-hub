// 报销 OCR：PDF 逐页渲染 → Tesseract 识别；从识别文本提取金额/日期/发票号
import { loadPdfJs, TESS_OPTS } from '@shared/cdn'

/** PDF → 逐页渲染成 canvas → Tesseract 识别（最多前 3 页，全电发票通常 1 页） */
export async function ocrPdfText(file: File, Tesseract: any, st: { textContent: string }): Promise<string> {
  const pdfjsLib = await loadPdfJs()
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const pages = Math.min(pdf.numPages, 3)
  let text = ''
  for (let p = 1; p <= pages; p++) {
    st.textContent = '🔍 PDF 识别中（第 ' + p + '/' + pages + ' 页，首次需加载识别引擎）…'
    const page = await pdf.getPage(p)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    const res = await Tesseract.recognize(canvas, 'chi_sim+eng', TESS_OPTS)
    text += '\n' + ((res && res.data && res.data.text) || '')
  }
  return text
}

/** 从 OCR 文本里提取金额、日期与发票号（发票/收据/付款截图的常见版式） */
export function parseFinanceText(text: string): { amount?: string; date?: string; invno?: string } {
  const t = String(text || '').replace(/[，\s]/g, '')
  const out: { amount?: string; date?: string; invno?: string } = {}
  const amtPatterns = [
    /[（(]小写[)）][^0-9]{0,8}(\d{1,7}(?:\.\d{1,2})?)/,
    /价税合计[^0-9]{0,25}(\d{1,7}(?:\.\d{1,2})?)/,
    /(?:合计|总计|实付|金额|付款|支付)\D{0,6}(\d{1,7}(?:\.\d{1,2})?)/,
    /[¥￥]\s*(\d{1,7}(?:\.\d{1,2})?)/,
  ]
  for (const re of amtPatterns) { const m = t.match(re); if (m) { out.amount = m[1]; break } }
  const di = t.match(/开票日期\D{0,4}(20\d{2})[-\/年.]?(\d{1,2})[-\/月.]?(\d{1,2})/)
  const d = di || t.match(/(20\d{2})[-\/年.](\d{1,2})[-\/月.](\d{1,2})/)
  if (d) out.date = d[1] + '-' + String(d[2]).padStart(2, '0') + '-' + String(d[3]).padStart(2, '0')
  const inv = t.match(/发票号码\D{0,4}(\d{20}|\d{8})/) || t.match(/\b(\d{20})\b/)
  if (inv) out.invno = inv[1]
  return out
}
