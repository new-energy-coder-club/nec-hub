# 批量检测：37 个 PDF 文字层 → 复刻线上 parseFinanceText + inferInvoiceCategory → JSON 结果
# 用法: python scripts/detect_invoices.py <发票目录> <输出json>
import fitz, re, os, sys, json, glob

# ===== 与 web/src/shared/ocr.ts 逐字对齐的纯函数（Python 复刻） =====
def parse_finance_text(text):
    raw = str(text or '')
    t = re.sub(r'[，,\s]', '', raw)
    out = {}
    # 金额：价税合计优先（乱序文字层：收集全部 ¥ 数字，「小写」窗口优先，否则取最大值）
    yen_all = []
    for ym in re.finditer(r'[¥￥]\s*([\d,]+(?:\.\d{1,2})?)', raw):
        v = float(ym.group(1).replace(',', ''))
        if 0 < v < 10000000:
            yen_all.append({'v': v, 's': ym.group(1).replace(',', ''), 'i': ym.start()})
    if yen_all:
        xiao = re.search(r'[（(]小写[)）]', raw)
        near = [y for y in yen_all if xiao and xiao.start() <= y['i'] < xiao.start() + 200] if xiao else []
        pick = max(near or yen_all, key=lambda y: y['v'])
        out['amount'] = pick['s']
    else:
        for re_pat in [
            r'[（(]小写[)）][^0-9]{0,8}(\d{1,7}(?:\.\d{1,2})?)',
            r'价税合计[^0-9]{0,25}(\d{1,7}(?:\.\d{1,2})?)',
            r'(?:合计|总计|实付|金额|付款|支付)\D{0,6}(\d{1,7}(?:\.\d{1,2})?)',
        ]:
            m = re.search(re_pat, t)
            if m:
                out['amount'] = m.group(1)
                break
    di = re.search(r'开票日期\D{0,4}(20\d{2})[-\/年.]?(\d{1,2})[-\/月.]?(\d{1,2})', t)
    d = di or re.search(r'(20\d{2})[-\/年.](\d{1,2})[-\/月.](\d{1,2})', t)
    if d:
        out['date'] = '%s-%02d-%02d' % (d.group(1), int(d.group(2)), int(d.group(3)))
    # 发票号：原始文本优先（去空白后票号可能与日期粘连）
    inv = (re.search(r'发票号码[：:\s]{0,4}(\d{20}|\d{8})', raw)
           or re.search(r'(?<!\d)(\d{20})(?!\d)', raw)
           or re.search(r'发票号码[^0-9]{0,8}(\d{20}|\d{8})', t)
           or re.search(r'发票号[^0-9]{0,8}(\d{20}|\d{8})', t)
           or re.search(r'票据号码[^0-9]{0,8}(\d{20}|\d{8})', t))
    if inv:
        out['invno'] = inv.group(1)
    return out

CAT_KEYWORDS = [
    {'names': ['差旅费'], 'kws': ['客运', '火车票', '高铁', '机票', '航空', '酒店', '住宿', '打车', '出租', '网约车', '汽油', '加油', '通行费', '过路费', '停车']},
    {'names': ['招待费'], 'kws': ['餐饮', '餐费', '食品', '饮料', '茶叶', '烟酒', '宴请', '饭店']},
    {'names': ['快递运费'], 'kws': ['快递', '物流', '货运', '运费']},
    {'names': ['图书资料', '资料费', '材料费'], 'kws': ['图书', '书籍', '出版', '书店', '当当', '文轩', '读买', '书屋', '尚书', '入门到精通', '教程']},
    {'names': ['元器件'], 'kws': ['电子元件', '元器件', '电阻', '电容', '芯片', '集成电路', '电路板', 'PCB', '模块', '传感器', '电池']},
    {'names': ['结构件'], 'kws': ['五金', '结构件', '外壳', '钣金', '支架', '法兰', '金属制品']},
    {'names': ['工具耗材'], 'kws': ['工具', '耗材', '刀具', '焊', '螺丝', '钻头', '胶枪', '热熔', '电钻', '万用表']},
    {'names': ['办公用品'], 'kws': ['办公', '文具', '打印', '复印', '墨盒', '硒鼓', '纸张', '存储卡', '内存卡', '内存', 'TF卡', 'tf卡', '读卡器', 'U盘', '硬盘', '移动电源', '充电宝', '耳机', '音箱', '麦克风', '电脑', '笔记本', '显示器', 'Apple', 'Mac ', '主机']},
    {'names': ['宣传物料'], 'kws': ['广告', '宣传', '展板', '横幅', '海报']},
    {'names': ['团建活动'], 'kws': ['团建', '拓展']},
    {'names': ['检测费'], 'kws': ['检测', '测试', '校准', '计量', '检验', '实验']},
    {'names': ['认证费'], 'kws': ['认证']},
    {'names': ['服务费'], 'kws': ['技术服务', '咨询', '软件', '信息服务', '云服务', '服务器', '域名', '会员', '租赁']},
    {'names': ['材料费'], 'kws': ['材料', '原料', '型材', '铝材', '钢材', '钢板', '亚克力', '树脂', '板材']},
    {'names': ['打样费'], 'kws': ['打样', '样品', '样件']},
    {'names': ['模具费'], 'kws': ['模具']},
    {'names': ['外协加工费'], 'kws': ['加工']},
]

INVOICE_BOILERPLATE = re.compile(r'电子发票|普通发票|专用发票|增值税|数电|发票号码|开票日期')

DEFAULT_CATALOG = [
    {'group': '研发费用支出', 'items': [{'code': 'F38.01', 'name': '材料费'}, {'code': 'F38.02', 'name': '差旅费'}, {'code': 'F38.03', 'name': '招待费'}, {'code': 'F38.04', 'name': '检测费'}, {'code': 'F38.05', 'name': '认证费'}, {'code': 'F38.06', 'name': '服务费'}]},
    {'group': '生产加工', 'items': [{'code': 'F39.01', 'name': '打样费'}, {'code': 'F39.02', 'name': '外协加工费'}, {'code': 'F39.03', 'name': '模具费'}]},
    {'group': '物料采购', 'items': [{'code': 'F40.01', 'name': '元器件'}, {'code': 'F40.02', 'name': '结构件'}, {'code': 'F40.03', 'name': '工具耗材'}]},
    {'group': '运营办公', 'items': [{'code': 'F41.01', 'name': '办公用品'}, {'code': 'F41.02', 'name': '快递运费'}, {'code': 'F41.03', 'name': '宣传物料'}, {'code': 'F41.04', 'name': '团建活动'}]},
    {'group': '其他', 'items': [{'code': 'F99.01', 'name': '其他费用'}]},
]

def infer_invoice_category(text, catalog):
    t = INVOICE_BOILERPLATE.sub(' ', str(text or ''))
    if not t.strip() or not catalog:
        return None, {}
    scores = {}
    def bump(seg, w):
        if not seg:
            return
        for c in CAT_KEYWORDS:
            for kw in c['kws']:
                if kw in seg:
                    scores[c['names'][0]] = scores.get(c['names'][0], 0) + w
                    break
    for m in re.finditer(r'\*([^*\s]{1,12})\*([^*\s]{1,30})', t):
        bump(m.group(2), 3)
        bump(m.group(1), 2)
    bump(t.replace('*', ' '), 1)
    if not scores:
        return None, {}
    best = sorted(scores.items(), key=lambda kv: -kv[1])[0][0]
    chain = next((c['names'] for c in CAT_KEYWORDS if c['names'][0] == best), [best])
    for name in chain:
        for g in catalog:
            for it in g['items']:
                if it['name'] == name:
                    return g['group'] + '.' + it['name'], scores
    for name in chain:
        for g in catalog:
            for it in g['items']:
                if name in it['name'] or it['name'] in name:
                    return g['group'] + '.' + it['name'], scores
    return None, scores

# ===== 批量提取 =====
def extract_text_layer(path):
    """坐标重组视觉行（与线上 pdf.js transform 聚行同逻辑）：y 容差聚类，行内 x 排序 + 间隙感知拼接"""
    try:
        doc = fitz.open(path)
        txt = ''
        for page in doc[:3]:
            rows = []
            for x0, y0, x1, y1, w, *_ in page.get_text('words'):
                if not w.strip():
                    continue
                for row in rows:
                    if abs(row[0] - y0) < 3:
                        row[1].append((x0, x1, w))
                        break
                else:
                    rows.append([y0, [(x0, x1, w)]])
            rows.sort(key=lambda r: r[0])  # pymupdf y 向下（顶为0）：升序 = 视觉从上到下
            lines = []
            for r in rows:
                line, prev_end = '', -1.0
                for x0, x1, w in sorted(r[1]):
                    if line and prev_end >= 0 and x0 - prev_end > 2:
                        line += ' '
                    line += w
                    prev_end = x1
                lines.append(line)
            txt += '\n' + '\n'.join(lines)
        doc.close()
        return txt
    except Exception:
        return ''

def main():
    base = sys.argv[1] if len(sys.argv) > 1 else r'D:\OneDrive\Desktop\开票记录'
    out_json = sys.argv[2] if len(sys.argv) > 2 else 'detect_result.json'
    files = sorted(glob.glob(os.path.join(base, '*.pdf'))) + sorted(glob.glob(os.path.join(base, '已有', '*.pdf')))
    rows = []
    for f in files:
        rel = os.path.relpath(f, base)
        text = extract_text_layer(f)
        found = parse_finance_text(text)
        cat, scores = infer_invoice_category(text, DEFAULT_CATALOG)
        # 商品明细（*大类*品名）
        items = ['*%s*%s' % (m.group(1), m.group(2)) for m in re.finditer(r'\*([^*\s]{1,12})\*([^*\s]{1,30})', text)]
        rows.append({
            'file': rel,
            'size': os.path.getsize(f),
            'text_len': len(re.sub(r'\s', '', text)),
            'invno': found.get('invno'),
            'date': found.get('date'),
            'amount': found.get('amount'),
            'cat': cat,
            'scores': scores,
            'items': items[:3],
            'text': text,
        })
    with open(out_json, 'w', encoding='utf-8') as fp:
        json.dump(rows, fp, ensure_ascii=False, indent=1)
    # 简报
    ok_inv = sum(1 for r in rows if r['invno'])
    ok_amt = sum(1 for r in rows if r['amount'])
    ok_date = sum(1 for r in rows if r['date'])
    ok_cat = sum(1 for r in rows if r['cat'])
    invnos = {}
    for r in rows:
        if r['invno']:
            invnos.setdefault(r['invno'], []).append(r['file'])
    dups = {k: v for k, v in invnos.items() if len(v) > 1}
    print('PDF 总数: %d | 独立发票号: %d | 重复票组: %d' % (len(rows), len(invnos), len(dups)))
    print('识别率: 发票号 %d/%d | 金额 %d/%d | 日期 %d/%d | 类目 %d/%d' % (
        ok_inv, len(rows), ok_amt, len(rows), ok_date, len(rows), ok_cat, len(rows)))
    for k, v in dups.items():
        print('  重复票 %s: %s' % (k, ' = '.join(v)))

if __name__ == '__main__':
    main()
