# -*- coding: utf-8 -*-
"""生成 NEC 品牌 PPT 标准模板 (16:9)。几何与 /brand/*.svg 同源。"""
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn

NAVY  = RGBColor(0x14, 0x1B, 0x5E)
INK   = RGBColor(0x0B, 0x10, 0x33)
CYAN  = RGBColor(0x1F, 0xA9, 0xE8)
SKY   = RGBColor(0x4F, 0xC3, 0xF7)
RTOP  = RGBColor(0x2B, 0x3F, 0xC2)
RBOT  = RGBColor(0x10, 0x27, 0x7E)
CAPC  = RGBColor(0x34, 0x49, 0xB9)
PAPER = RGBColor(0xFF, 0xFF, 0xFF)
FOG   = RGBColor(0xF4, 0xF6, 0xFB)
GRAY  = RGBColor(0x5A, 0x64, 0x72)
LINE  = RGBColor(0xD9, 0xDF, 0xF0)
GRID  = RGBColor(0x1E, 0x27, 0x78)   # navy 上的暗网格线
GRIDW = RGBColor(0xE3, 0xEC, 0xFA)   # 白底上的淡网格线

CN   = "微软雅黑"
EN   = "Arial Black"
MONO = "Consolas"

FRONT = [(2,46),(2,181),(44,181),(44,133),(99,191),(141,149),(141,4),(99,4),(99,104),(44,46)]
BASE  = [(2,181),(44,181),(99,191),(141,149),(201,177),(159,219),(104,209),(62,209)]
STEMB = [(159,32),(201,32),(201,177),(159,177)]
CAPL  = [(2,46),(44,46),(104,74),(62,74)]
CAPR  = [(99,4),(141,4),(201,32),(159,32)]
W, H = 204, 234

prs = Presentation()
prs.slide_width  = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[0]

# 清空默认模板自带的示例页
for sld in list(prs.slides._sldIdLst):
    rId = sld.get(qn('r:id'))
    prs.part.drop_rel(rId)
    prs.slides._sldIdLst.remove(sld)

def slide():
    return prs.slides.add_slide(BLANK)

def rect(s, x, y, w, h, fill, line=None):
    sp = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    sp.fill.solid(); sp.fill.fore_color.rgb = fill
    if line: sp.line.color.rgb = line; sp.line.width = Pt(1)
    else: sp.line.fill.background()
    sp.shadow.inherit = False
    return sp

def text(s, x, y, w, h, runs, size=18, color=INK, font=CN, bold=False,
         align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spacing=None, line_spacing=None):
    tb = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame; tf.word_wrap = True; tf.vertical_anchor = anchor
    if isinstance(runs, str): runs = [runs]
    for i, t in enumerate(runs):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        if line_spacing: p.line_spacing = line_spacing
        r = p.add_run(); r.text = t
        f = r.font
        f.size = Pt(size); f.bold = bold; f.color.rgb = color; f.name = font
        ea = r._r.rPr.makeelement(qn('a:ea'), {'typeface': font}); r._r.rPr.append(ea)
        if spacing is not None:
            r._r.rPr.set('spc', str(int(spacing * 100)))
    return tb

def freepoly(s, pts, x0, y0, scale, fill, gradient=False):
    fb = s.shapes.build_freeform(pts[0][0], pts[0][1], scale=scale)
    fb.add_line_segments(pts[1:], close=True)
    sp = fb.convert_to_shape(Emu(int(Inches(x0) - 2 * scale)), Emu(int(Inches(y0) - 4 * scale)))
    if gradient:
        sp.fill.gradient()
        st = sp.fill.gradient_stops
        st[0].color.rgb = RTOP; st[0].position = 0.0
        st[1].color.rgb = RBOT; st[1].position = 1.0
        try: sp.fill.gradient_angle = 90.0
        except Exception: pass
    else:
        sp.fill.solid(); sp.fill.fore_color.rgb = fill
    sp.line.fill.background(); sp.shadow.inherit = False
    return sp

def logo(s, x0, y0, h, mode="color"):
    """mode: color | white | mono"""
    scale = Inches(h) / H
    off = lambda pts: [(px - 0, py - 0) for px, py in pts]
    if mode == "color":
        freepoly(s, BASE,  x0, y0, scale, NAVY)
        freepoly(s, STEMB, x0, y0, scale, NAVY)
        freepoly(s, FRONT, x0, y0, scale, None, gradient=True)
        freepoly(s, CAPL,  x0, y0, scale, CAPC)
        freepoly(s, CAPR,  x0, y0, scale, CAPC)
    else:
        c = PAPER if mode == "white" else INK
        depth = RGBColor(0x8F, 0xA8, 0xE4) if mode == "white" else c
        for pts, f in ((BASE, depth), (STEMB, depth), (FRONT, c), (CAPL, c), (CAPR, c)):
            freepoly(s, pts, x0, y0, scale, f)

def grid(s, color, step=0.92, area=(0, 0, 13.333, 7.5)):
    x, y, w, h = area
    i = 0
    xx = x
    while xx <= x + w + 0.01:
        rect(s, xx, y, 0.008, h, color); xx += step; i += 1
    yy = y
    while yy <= y + h + 0.01:
        rect(s, x, yy, w, 0.008, color); yy += step; i += 1

def horizon(s, y, x=0, w=13.333):
    rect(s, x, y, w * 0.55, 0.035, CYAN)
    rect(s, x + w * 0.55, y, w * 0.45, 0.035, RGBColor(0xE8, 0xF6, 0xFE))

def sun(s, cx, cy, r, ring=CYAN):
    o = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - r), Inches(cy - r), Inches(2*r), Inches(2*r))
    o.fill.background(); o.line.color.rgb = ring; o.line.width = Pt(2.5); o.shadow.inherit = False
    o2 = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - r*0.85), Inches(cy - r*0.85), Inches(1.7*r), Inches(1.7*r))
    o2.fill.background(); o2.line.color.rgb = SKY; o2.line.width = Pt(0.75); o2.shadow.inherit = False
    dot = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx-0.03), Inches(cy-0.03), Inches(0.06), Inches(0.06))
    dot.fill.solid(); dot.fill.fore_color.rgb = SKY; dot.line.fill.background(); dot.shadow.inherit = False

def page_header(s, title, tag="NEC · 常州工学院 NEC 战队"):
    rect(s, 0, 0, 13.333, 0.06, CYAN)
    text(s, 0.55, 0.28, 8, 0.35, tag, 10, GRAY, MONO, spacing=2)
    text(s, 0.55, 0.62, 11, 0.75, title, 28, NAVY, CN, bold=True)
    rect(s, 0.57, 1.38, 0.55, 0.045, CYAN)

def footer(s, dark=False):
    c = SKY if dark else GRAY
    text(s, 0.55, 7.08, 9, 0.3, "BUILT TO DAWN · 为黎明而造", 8, c, MONO, spacing=2)
    text(s, 10.5, 7.08, 2.3, 0.3, "NEC", 8, c, MONO, align=PP_ALIGN.RIGHT, spacing=3)

# ============ 1. 封面 ============
s = slide()
rect(s, 0, 0, 13.333, 7.5, NAVY)
grid(s, GRID, 0.92)
horizon(s, 6.55)
sun(s, 11.4, 2.1, 1.05)
logo(s, 0.55, 0.5, 0.95, "white")
text(s, 1.75, 0.62, 6, 0.5, "NEC", 26, PAPER, EN, spacing=2)
text(s, 1.78, 1.18, 8, 0.35, "NEW ENERGY CODER · 常州工学院 NEC 战队", 10.5, SKY, MONO, spacing=2)
text(s, 0.85, 2.9, 11.6, 1.9, "演示文稿标题", 54, PAPER, EN)
text(s, 0.9, 4.35, 11, 0.6, "副标题：一句话说明这份 PPT 的核心内容", 20, SKY, CN)
text(s, 0.9, 5.15, 11, 0.4, "汇报人 · 部门 · 2026-10", 13, RGBColor(0x9F,0xB4,0xE8), MONO, spacing=1)
footer(s, dark=True)

# ============ 2. 目录 ============
s = slide()
rect(s, 0, 0, 13.333, 7.5, PAPER)
rect(s, 0, 0, 13.333, 0.06, CYAN)
rect(s, 0, 0.06, 13.333, 1.7, FOG)
grid(s, GRIDW, 0.92, area=(0, 0.06, 13.333, 1.7))
logo(s, 11.9, 0.35, 0.9)
text(s, 0.55, 0.42, 6, 0.5, "目录", 30, NAVY, CN, bold=True)
text(s, 2.05, 0.52, 5, 0.4, "CONTENTS", 14, CYAN, EN, spacing=4)
items = [("01", "背景与目标", "为什么是这件事 / 要达成什么"),
         ("02", "方案与执行", "我们怎么做 / 关键动作与分工"),
         ("03", "数据与结果", "指标、对比与结论"),
         ("04", "计划与展望", "下一步 / 需要的支持")]
y = 2.15
for num, t, d in items:
    text(s, 0.9, y, 1.0, 0.6, num, 30, CYAN, MONO, bold=True)
    text(s, 2.0, y + 0.02, 6, 0.5, t, 20, INK, CN, bold=True)
    text(s, 2.0, y + 0.52, 8, 0.4, d, 12, GRAY, CN)
    rect(s, 0.9, y + 1.0, 11.5, 0.012, LINE)
    y += 1.25
footer(s)

# ============ 3. 章节页 ============
s = slide()
rect(s, 0, 0, 13.333, 7.5, NAVY)
grid(s, GRID, 0.92)
horizon(s, 6.9)
logo(s, 11.7, 5.6, 1.15, "white")
text(s, 0.8, 1.7, 4, 2.2, "01", 110, CYAN, EN)
text(s, 0.9, 4.1, 10, 0.9, "章节标题", 40, PAPER, CN, bold=True)
text(s, 0.92, 5.05, 10, 0.45, "SECTION TITLE · 用一句短语概括本章", 13, SKY, MONO, spacing=2)
footer(s, dark=True)

# ============ 4. 内容页·要点 ============
s = slide()
rect(s, 0, 0, 13.333, 7.5, PAPER)
page_header(s, "页面标题：结论先行的一句话")
for i, (lead, body) in enumerate([
    ("要点一", "支持性说明文字。建议每页 3-5 个要点，每个要点不超过两行。"),
    ("要点二", "关键数字用破晓青强调，例如 87% 与 3 倍。"),
    ("要点三", "需要讨论/决策的事项，用深色加粗写在要点里。")]):
    y = 1.85 + i * 1.28
    rect(s, 0.62, y + 0.06, 0.09, 0.85, CYAN if i == 0 else NAVY)
    text(s, 0.95, y, 3.2, 0.5, lead, 17, NAVY, CN, bold=True)
    text(s, 0.95, y + 0.48, 11.3, 0.6, body, 13, GRAY, CN)
rect(s, 0.62, 5.9, 12.1, 0.85, FOG)
text(s, 0.85, 6.08, 11.6, 0.5, "小结 / 过渡句：把这一页收束成一句可以带走的话。", 13, INK, CN, bold=True)
footer(s)

# ============ 5. 内容页·图文 ============
s = slide()
rect(s, 0, 0, 13.333, 7.5, PAPER)
page_header(s, "图文页：图说清楚，字说重点")
text(s, 0.62, 1.8, 5.6, 0.5, "左侧文字标题", 18, NAVY, CN, bold=True)
for i in range(3):
    y = 2.45 + i * 0.95
    text(s, 0.65, y, 0.5, 0.4, f"0{i+1}", 14, CYAN, MONO, bold=True)
    text(s, 1.2, y, 4.9, 0.9, "说明文字：配合右图的讲解，两到三行为宜，字号 13pt。", 13, GRAY, CN)
img = rect(s, 6.7, 1.8, 5.95, 4.6, FOG, line=SKY)
text(s, 6.7, 3.85, 5.95, 0.5, "图片 / 截图占位（约 16:9）", 14, GRAY, CN, align=PP_ALIGN.CENTER)
text(s, 6.7, 6.5, 5.95, 0.35, "图注：来源与日期", 10, GRAY, MONO, align=PP_ALIGN.RIGHT)
footer(s)

# ============ 6. 数据表格页 ============
s = slide()
rect(s, 0, 0, 13.333, 7.5, PAPER)
page_header(s, "数据页：一张表一个结论")
rows, cols = 5, 4
tbl = s.shapes.add_table(rows, cols, Inches(0.62), Inches(1.8), Inches(12.1), Inches(3.6)).table
tbl.columns[0].width = Inches(3.4)
for c in range(1, cols): tbl.columns[c].width = Inches(2.9)
head = ["指标", "目标", "实际", "达成"]
data = [["示例指标 A", "100", "108", "108%"],
        ["示例指标 B", "3.0", "2.6", "87%"],
        ["示例指标 C", "12 周", "10 周", "提前"],
        ["结论", "—", "—", "整体达标"]]
for c, htxt in enumerate(head):
    cell = tbl.cell(0, c)
    cell.fill.solid(); cell.fill.fore_color.rgb = NAVY
    p = cell.text_frame.paragraphs[0]; r = p.add_run(); r.text = htxt
    r.font.bold = True; r.font.size = Pt(14); r.font.color.rgb = PAPER; r.font.name = CN
for ri, row in enumerate(data, start=1):
    for ci, val in enumerate(row):
        cell = tbl.cell(ri, ci)
        cell.fill.solid()
        cell.fill.fore_color.rgb = FOG if ri % 2 == 0 else PAPER
        if ri == rows - 1: cell.fill.fore_color.rgb = RGBColor(0xE8, 0xEC, 0xFB)
        p = cell.text_frame.paragraphs[0]
        r = p.add_run(); r.text = val
        r.font.size = Pt(13); r.font.name = CN
        r.font.color.rgb = INK if ri < rows - 1 else NAVY
        r.font.bold = (ci == 0 or ri == rows - 1)
        if val.endswith("%") and ri < rows - 1:
            r.font.color.rgb = CYAN; r.font.bold = True
text(s, 0.62, 5.7, 12.1, 0.9, "读表结论：用一句话告诉观众该看哪里、说明了什么。未达标的项用藏青加粗说明原因与对策。", 13, GRAY, CN)
footer(s)

# ============ 7. 结尾页 ============
s = slide()
rect(s, 0, 0, 13.333, 7.5, NAVY)
grid(s, GRID, 0.92)
horizon(s, 5.6)
sun(s, 6.67, 5.6, 0.9)
logo(s, 6.02, 1.5, 1.3, "white")
text(s, 1.7, 3.3, 10, 1.0, "KEEP BUILDING", 44, PAPER, EN, align=PP_ALIGN.CENTER, spacing=6)
text(s, 1.7, 4.4, 10, 0.5, "BUILT TO DAWN · 为黎明而造", 15, SKY, CN, align=PP_ALIGN.CENTER, spacing=3)
text(s, 1.7, 6.15, 10, 0.4, "感谢聆听 · 请联系 NEC AI 中台更新模板", 11, RGBColor(0x9F,0xB4,0xE8), MONO, align=PP_ALIGN.CENTER)

prs.core_properties.title = "NEC 品牌 PPT 标准模板 V1.0"
prs.core_properties.author = "NEC AI 中台"
prs.core_properties.subject = "BUILT TO DAWN"

out = r"D:/OneDrive/Desktop/竞赛_ROBOCON_NEC/00_团队AI中台/nec-hub/public/brand/NEC_PPT模板_V1.0.pptx"
prs.save(out)
print("saved:", out, "| slides:", len(prs.slides._sldIdLst))
