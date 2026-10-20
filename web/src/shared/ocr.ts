// 报销 OCR：PDF 优先直取文字层（数电票内嵌文字，毫秒级且准确），扫描件回退 Tesseract；从识别文本提取金额/日期/发票号/费用类目
import { loadPdfJs, loadTesseract, TESS_OPTS } from '@shared/cdn'

/** 目录结构（与 reimburse store 的 CatalogGroup 同形，此处内联避免跨层依赖） */
export interface CatalogLike { group: string; items: { code: string; name: string }[] }

/** PDF 文字层直取（数电票/全电发票均内嵌文字层）；返回空串表示扫描件需 OCR。
 *  文字流按绘制顺序返回，标签与值常分离（如「发票号码：」与号码相隔数行），
 *  故按 transform 坐标把 item 聚成视觉行（y 容差聚类，行内 x 排序）还原「标签 值」同行结构。 */
export async function extractPdfTextLayer(file: File, maxPages = 3): Promise<string> {
  const pdfjsLib = await loadPdfJs()
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const pages = Math.min(pdf.numPages, maxPages)
  let text = ''
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p)
    const tc = await page.getTextContent()
    const rows: { y: number; items: { x: number; s: string }[] }[] = []
    for (const it of tc.items || []) {
      const s = (it && it.str) || ''
      if (!s.trim()) continue
      const x = it.transform ? it.transform[4] : 0
      const y = it.transform ? it.transform[5] : 0
      const row = rows.find(r => Math.abs(r.y - y) < 2.5)
      if (row) row.items.push({ x, s })
      else rows.push({ y, items: [{ x, s }] })
    }
    rows.sort((a, b) => b.y - a.y) // PDF 用户空间 y 向上：降序 = 视觉从上到下
    text += '\n' + rows.map(r => r.items.sort((a, b) => a.x - b.x).map(i => i.s).join(' ')).join('\n')
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
  const raw = String(text || '')
  // 清理全/半角逗号与空白：千分位金额（1,250.00）需先归并再匹配
  const t = raw.replace(/[，,\s]/g, '')
  const out: { amount?: string; date?: string; invno?: string } = {}
  // ---- 金额：价税合计优先 ----
  // 乱序文字层（拼多多票）标签与值分离：先在原始文本收集全部 ¥ 数字，取「小写」标签附近窗口内的，否则取最大值（价税合计=含税最大额）
  const yenAll: { v: number; s: string; i: number }[] = []
  const yenRe = /[¥￥]\s*([\d,]+(?:\.\d{1,2})?)/g
  let ym: RegExpExecArray | null
  while ((ym = yenRe.exec(raw))) {
    const v = Number(ym[1].replace(/,/g, ''))
    if (v > 0 && v < 10000000) yenAll.push({ v, s: ym[1].replace(/,/g, ''), i: ym.index })
  }
  if (yenAll.length) {
    const xiao = raw.search(/[（(]小写[)）]/)
    const near = xiao >= 0 ? yenAll.filter(y => y.i >= xiao && y.i < xiao + 200) : []
    const pick = (near.length ? near : yenAll).reduce((a, b) => (b.v >= a.v ? b : a))
    out.amount = pick.s
  } else {
    const amtPatterns = [
      /[（(]小写[)）][^0-9]{0,8}(\d{1,7}(?:\.\d{1,2})?)/,
      /价税合计[^0-9]{0,25}(\d{1,7}(?:\.\d{1,2})?)/,
      /(?:合计|总计|实付|金额|付款|支付)\D{0,6}(\d{1,7}(?:\.\d{1,2})?)/,
    ]
    for (const re of amtPatterns) { const m = t.match(re); if (m) { out.amount = m[1]; break } }
  }
  const di = t.match(/开票日期\D{0,4}(20\d{2})[-\/年.]?(\d{1,2})[-\/月.]?(\d{1,2})/)
  const d = di || t.match(/(20\d{2})[-\/年.](\d{1,2})[-\/月.](\d{1,2})/)
  if (d) out.date = d[1] + '-' + String(d[2]).padStart(2, '0') + '-' + String(d[3]).padStart(2, '0')
  // ---- 发票号：全电票 20 位 / 旧版 8 位；8 位必须带标签避免误吞金额 ----
  // 原始文本优先（去空白后票号可能与日期粘连成超长串）；环视确保恰好 20 位，不会误吞信用代码（18 位）
  const inv = raw.match(/发票号码[：:\s]{0,4}(\d{20}|\d{8})/)
    || raw.match(/(?<!\d)(\d{20})(?!\d)/)
    || t.match(/发票号码[^0-9]{0,8}(\d{20}|\d{8})/)
    || t.match(/发票号[^0-9]{0,8}(\d{20}|\d{8})/)          // OCR 噪声下"码"字丢失
    || t.match(/票据号码[^0-9]{0,8}(\d{20}|\d{8})/)
  if (inv) out.invno = inv[1]
  return out
}

/* ========== 费用类目推断：发票「*大类*品名」明细 + 全文关键词打分 → 目录项 ========== */

/** 关键词表：names 为目录项候选链（按顺序在目录中找第一个存在的，兼容 D1 动态目录命名差异） */
const CAT_KEYWORDS: { names: string[]; kws: string[] }[] = [
  { names: ['差旅费'], kws: ['客运', '火车票', '高铁', '机票', '航空', '酒店', '住宿', '打车', '出租', '网约车', '汽油', '加油', '通行费', '过路费', '停车'] },
  { names: ['招待费'], kws: ['餐饮', '餐费', '食品', '饮料', '茶叶', '烟酒', '宴请', '饭店'] },
  { names: ['快递运费'], kws: ['快递', '物流', '货运', '运费'] },
  { names: ['图书资料', '资料费', '材料费'], kws: ['图书', '书籍', '出版', '书店', '当当', '文轩', '读买', '书屋', '尚书', '入门到精通', '教程'] },
  { names: ['元器件'], kws: ['电子元件', '元器件', '电阻', '电容', '芯片', '集成电路', '电路板', 'PCB', '模块', '传感器', '电池'] },
  { names: ['结构件'], kws: ['五金', '结构件', '外壳', '钣金', '支架', '法兰', '金属制品'] },
  { names: ['工具耗材'], kws: ['工具', '耗材', '刀具', '焊', '螺丝', '钻头', '胶枪', '热熔', '电钻', '万用表'] },
  { names: ['办公用品'], kws: ['办公', '文具', '打印', '复印', '墨盒', '硒鼓', '纸张', '存储卡', '内存卡', '内存', 'TF卡', 'tf卡', '读卡器', 'U盘', '硬盘', '移动电源', '充电宝', '耳机', '音箱', '麦克风', '电脑', '笔记本', '显示器', 'Apple', 'Mac ', '主机'] },
  { names: ['宣传物料'], kws: ['广告', '宣传', '展板', '横幅', '海报'] },
  { names: ['团建活动'], kws: ['团建', '拓展'] },
  { names: ['检测费'], kws: ['检测', '测试', '校准', '计量', '检验', '实验'] },
  { names: ['认证费'], kws: ['认证'] },
  { names: ['服务费'], kws: ['技术服务', '咨询', '软件', '信息服务', '云服务', '服务器', '域名', '会员', '租赁'] },
  { names: ['材料费'], kws: ['材料', '原料', '型材', '铝材', '钢材', '钢板', '亚克力', '树脂', '板材'] },
  { names: ['打样费'], kws: ['打样', '样品', '样件'] },
  { names: ['模具费'], kws: ['模具'] },
  { names: ['外协加工费'], kws: ['加工'] },
]

/** 票面固定标题词：每张数电票都有，剔除避免「电子」等词污染打分 */
const INVOICE_BOILERPLATE = /电子发票|普通发票|专用发票|增值税|数电|发票号码|开票日期/g

/** 从发票文本推断费用项目，返回「分组.名称」（如 研发费用支出.差旅费）；无法判断返回 undefined */
export function inferInvoiceCategory(text: string, catalog: CatalogLike[]): string | undefined {
  const t = String(text || '').replace(INVOICE_BOILERPLATE, ' ')
  if (!t.trim() || !catalog.length) return
  const scores = new Map<string, number>()
  const bump = (seg: string, w: number) => {
    if (!seg) return
    for (const c of CAT_KEYWORDS) {
      for (const kw of c.kws) {
        if (seg.includes(kw)) { scores.set(c.names[0], (scores.get(c.names[0]) || 0) + w); break }
      }
    }
  }
  // 发票明细行标准格式「*大类*品名」：品名权重最高，大类次之
  const star = /\*([^*\s]{1,12})\*([^*\s]{1,30})/g
  let m: RegExpExecArray | null
  while ((m = star.exec(t))) { bump(m[2], 3); bump(m[1], 2) }
  bump(t.replace(/\*/g, ' '), 1) // 全文兜底（付款截图/收据无星号格式）
  if (!scores.size) return
  const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0][0]
  // 沿候选链在目录中定位：item.name 精确命中优先，其次互相包含（兼容 D1 目录命名差异）
  const chain = CAT_KEYWORDS.find(c => c.names[0] === best)?.names || [best]
  for (const name of chain)
    for (const g of catalog) for (const it of g.items) if (it.name === name) return g.group + '.' + it.name
  for (const name of chain)
    for (const g of catalog) for (const it of g.items) if (it.name.includes(name) || name.includes(it.name)) return g.group + '.' + it.name
  return
}
