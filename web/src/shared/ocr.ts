// 报销 OCR：PDF 优先直取文字层（数电票内嵌文字，毫秒级且准确），扫描件回退 Tesseract；从识别文本提取金额/日期/发票号/费用类目
import { loadPdfJs, loadTesseract, TESS_OPTS } from '@shared/cdn'

/** 目录结构（与 reimburse store 的 CatalogGroup 同形，此处内联避免跨层依赖） */
export interface CatalogLike { group: string; items: { code: string; name: string }[] }

/** PDF 文字层直取（数电票/全电发票均内嵌文字层）；返回空串表示扫描件需 OCR */
export async function extractPdfTextLayer(file: File, maxPages = 3): Promise<string> {
  const pdfjsLib = await loadPdfJs()
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const pages = Math.min(pdf.numPages, maxPages)
  let text = ''
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p)
    const tc = await page.getTextContent()
    text += '\n' + (tc.items || []).map((it: any) => (it && it.str) || '').join(' ')
  }
  return text
}

/** PDF → 优先文字层；文字量不足（扫描件）再逐页渲染成 canvas → Tesseract 识别（最多前 3 页） */
export async function ocrPdfText(file: File, Tesseract: any, st: { textContent: string }): Promise<string> {
  st.textContent = '📄 读取 PDF 文字层…'
  try {
    const layer = await extractPdfTextLayer(file)
    // 电子发票文字层通常数百字；低于阈值视为扫描件回退 OCR
    if (layer.replace(/\s/g, '').length >= 20) return layer
  } catch { /* 文字层读取失败则走 OCR */ }
  const T = Tesseract || await loadTesseract()
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
    const res = await T.recognize(canvas, 'chi_sim+eng', TESS_OPTS)
    text += '\n' + ((res && res.data && res.data.text) || '')
  }
  return text
}

/** 从 OCR 文本里提取金额、日期与发票号（发票/收据/付款截图的常见版式） */
export function parseFinanceText(text: string): { amount?: string; date?: string; invno?: string } {
  // 清理全/半角逗号与空白：千分位金额（1,250.00）需先归并再匹配
  const t = String(text || '').replace(/[，,\s]/g, '')
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
  // 发票号：全电票 20 位 / 旧版 8 位；8 位必须带标签避免误吞金额
  const inv = t.match(/发票号码[^0-9]{0,8}(\d{20}|\d{8})/)
    || t.match(/发票号[^0-9]{0,8}(\d{20}|\d{8})/)          // OCR 噪声下"码"字丢失
    || t.match(/票据号码[^0-9]{0,8}(\d{20}|\d{8})/)
    || t.match(/\b(\d{20})\b/)
  if (inv) out.invno = inv[1]
  return out
}

/* ========== 费用类目推断：发票「*大类*品名」明细 + 全文关键词打分 → 目录项 ========== */

/** 关键词表：name 对应费用目录项名称（按名称匹配，D1 动态目录亦可命中），顺序即优先级兜底 */
const CAT_KEYWORDS: { name: string; kws: string[] }[] = [
  { name: '差旅费', kws: ['客运', '火车票', '高铁', '机票', '航空', '酒店', '住宿', '打车', '出租', '网约车', '汽油', '加油', '通行费', '过路费', '停车'] },
  { name: '招待费', kws: ['餐饮', '餐费', '食品', '饮料', '茶叶', '烟酒', '宴请', '饭店'] },
  { name: '快递运费', kws: ['快递', '物流', '货运', '运费'] },
  { name: '元器件', kws: ['电子', '元器件', '电阻', '电容', '芯片', '集成电路', '电路板', 'PCB', '模块', '传感器', '电池'] },
  { name: '结构件', kws: ['五金', '结构件', '外壳', '钣金', '支架', '法兰'] },
  { name: '工具耗材', kws: ['工具', '耗材', '刀具', '焊', '螺丝', '钻头'] },
  { name: '办公用品', kws: ['办公', '文具', '打印', '复印', '墨盒', '硒鼓', '纸张'] },
  { name: '宣传物料', kws: ['广告', '宣传', '印刷', '展板', '横幅', '海报'] },
  { name: '团建活动', kws: ['团建', '拓展'] },
  { name: '检测费', kws: ['检测', '测试', '校准', '计量', '检验', '实验'] },
  { name: '认证费', kws: ['认证'] },
  { name: '服务费', kws: ['技术服务', '咨询', '软件', '信息服务', '云服务', '服务器', '域名', '会员', '租赁'] },
  { name: '材料费', kws: ['材料', '原料', '型材', '铝材', '钢材', '钢板', '亚克力', '树脂', '板材'] },
  { name: '打样费', kws: ['打样', '样品', '样件'] },
  { name: '模具费', kws: ['模具'] },
  { name: '外协加工费', kws: ['加工'] },
]

/** 从发票文本推断费用项目，返回「分组.名称」（如 研发费用支出.差旅费）；无法判断返回 undefined */
export function inferInvoiceCategory(text: string, catalog: CatalogLike[]): string | undefined {
  const t = String(text || '')
  if (!t.trim() || !catalog.length) return
  const scores = new Map<string, number>()
  const bump = (seg: string, w: number) => {
    if (!seg) return
    for (const c of CAT_KEYWORDS) {
      for (const kw of c.kws) {
        if (seg.includes(kw)) { scores.set(c.name, (scores.get(c.name) || 0) + w); break }
      }
    }
  }
  // 发票明细行标准格式「*大类*品名」：品名权重最高，大类次之
  const star = /\*([^*\s]{1,12})\*([^*\s]{1,30})/g
  let m: RegExpExecArray | null
  while ((m = star.exec(t))) { bump(m[2], 3); bump(m[1], 2) }
  bump(t.replace(/\*/g, ' '), 1) // 全文兜底（付款截图/收据无星号格式）
  if (!scores.size) return
  const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0]
  // 在目录中定位：item.name 精确命中优先，其次互相包含（兼容 D1 目录命名差异）
  for (const g of catalog) for (const it of g.items) if (it.name === best[0]) return g.group + '.' + it.name
  for (const g of catalog) for (const it of g.items) if (it.name.includes(best[0]) || best[0].includes(it.name)) return g.group + '.' + it.name
  return
}
