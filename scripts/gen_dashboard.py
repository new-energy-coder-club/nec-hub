# 生成发票识别总体看板 HTML（读 detect_result.json + 可选人工对照基准 JSON）
# 用法: python scripts/gen_dashboard.py <detect_result.json> <输出html> [--manual manual_map.json]
import json, sys
from collections import defaultdict

# 内置示例基准（本次发票三方向分类建议.xlsx 逐票明细）；--manual 传入外部 JSON 时覆盖
MANUAL = {
    '26332000008805244126': {'dir': '方向一·硬件实验台', 'proj': 'TCN-RD2026009', 'patent': 'XMLXSQ202608140172', 'use': '冰蓄冷终端实验台组装粘接工具（热胶枪+胶棒）', 'ledger': '硬件·五金工具'},
    '26952000004400424781': {'dir': '方向一·硬件实验台', 'proj': 'TCN-RD2026009', 'patent': 'XMLXSQ202608140172', 'use': '实验台数据采集存储（存储卡）', 'ledger': '硬件·网络/存储设备'},
    '26322000008431046656': {'dir': '方向一·硬件实验台', 'proj': 'TCN-RD2026009', 'patent': 'XMLXSQ202608140172', 'use': '制冷终端户外测试供电（Anker 220W 移动电源）', 'ledger': '硬件·电源/电池/充电'},
    '26352000002365039366': {'dir': '方向一·硬件实验台', 'proj': 'TCN-RD2026011', 'patent': 'XMLXSQ202609280178', 'use': '相变蓄冷调控实验 TF 卡扩容×2', 'ledger': '硬件·网络/存储设备'},
    '26352000002365829281': {'dir': '方向一·硬件实验台', 'proj': 'TCN-RD2026011', 'patent': 'XMLXSQ202609280178', 'use': '实验 TF 卡数据导出（读卡器）', 'ledger': '硬件·网络/存储设备'},
    '26352000002365372591': {'dir': '方向一·硬件实验台', 'proj': 'TCN-RD2026011', 'patent': 'XMLXSQ202609280178', 'use': '调控终端第二路数据记录卡', 'ledger': '硬件·网络/存储设备'},
    '26322000008545717381': {'dir': '方向一·硬件实验台', 'proj': 'TCN-RD2026010', 'patent': 'XMLXSQ202608140173', 'use': '船舶换电站现场勘察便携供电（Anker 三合一）', 'ledger': '硬件·电源/电池/充电'},
    '26412000003757413361': {'dir': '方向二·AI系统开发', 'proj': 'TCN-RD2026008', 'patent': 'XMLXSQ202607270171', 'use': '光储 AI 平台开发工作站（Mac mini M6）', 'ledger': '硬件·其他设备(原型验证)'},
    '26337000000869611609': {'dir': '方向二·AI系统开发', 'proj': 'TCN-RD2026008', 'patent': 'XMLXSQ202607270171', 'use': '钱学森三书（系统工程方法论）', 'ledger': '软件·开发资料图书'},
    '26112000004419136396': {'dir': '方向二·AI系统开发', 'proj': '专利验证', 'patent': 'XMLXSQ202610080179', 'use': 'SOLIDWORKS Design 2026（彩钢瓦夹具建模）', 'ledger': '软件·开发资料图书'},
    '26112000004419722836': {'dir': '方向二·AI系统开发', 'proj': '专利验证', 'patent': 'XMLXSQ202610080180', 'use': 'SOLIDWORKS Motion（支架连接动力学仿真）', 'ledger': '软件·开发资料图书'},
    '26422000003633106066': {'dir': '方向二·AI系统开发', 'proj': 'TCN-RD2026008', 'patent': 'XMLXSQ202607270171', 'use': '马斯克原理（创新方法论）', 'ledger': '软件·开发资料图书'},
    '26337000000869611610': {'dir': '方向二·AI系统开发', 'proj': 'TCN-RD2026011', 'patent': 'XMLXSQ202609280178', 'use': 'RISC-V CPU 芯片设计（边缘控制器参考）', 'ledger': '软件·开发资料图书'},
    '26442000011948480701': {'dir': '方向二·AI系统开发', 'proj': 'TCN-RD2026008', 'patent': 'XMLXSQ202607270171', 'use': 'AI 语音交互开发测试（蓝牙耳机）', 'ledger': '硬件·智能/语音终端'},
    '26337000000399838955': {'dir': '方向二·AI系统开发', 'proj': 'TCN-RD2026008（暂归）', 'patent': 'XMLXSQ202607270171（暂归）', 'use': '⚠ 图书未列书名，需核对订单', 'ledger': '软件·开发资料图书'},
    '26362000001807115476': {'dir': '方向二·AI系统开发', 'proj': 'TCN-RD2026008（暂归）', 'patent': 'XMLXSQ202607270171（暂归）', 'use': '⚠ 图书未列书名，需核对订单', 'ledger': '软件·开发资料图书'},
    '26112000004339534771': {'dir': '方向三·电站+冰蓄冷报告', 'proj': 'TCN-RD2026008', 'patent': 'XMLXSQ202607270171', 'use': '户用电站逆变器谐振实测参考', 'ledger': '软件·开发资料图书'},
    '26117000001591857350': {'dir': '方向三·电站+冰蓄冷报告', 'proj': 'TCN-RD2026008', 'patent': 'XMLXSQ202607270171', 'use': '电站并网逆变控制实测参考', 'ledger': '软件·开发资料图书'},
    '26327000001761526228': {'dir': '方向三·电站+冰蓄冷报告', 'proj': 'TCN-RD2026011', 'patent': 'XMLXSQ202609280178', 'use': '综合能源系统建模（可行性报告）', 'ledger': '软件·开发资料图书'},
    '26517000000700587277': {'dir': '方向三·电站+冰蓄冷报告', 'proj': 'TCN-RD2026008', 'patent': 'XMLXSQ202607270171', 'use': '储能投资经济性/电价机制（可行性报告）', 'ledger': '软件·开发资料图书'},
    '26112000004340103901': {'dir': '方向三·电站+冰蓄冷报告', 'proj': 'TCN-RD2026008', 'patent': 'XMLXSQ202607270171', 'use': '户用储能 PCS 实测参考', 'ledger': '软件·开发资料图书'},
    '26327000001761526227': {'dir': '方向三·电站+冰蓄冷报告', 'proj': 'TCN-RD2026009', 'patent': 'XMLXSQ202608140172', 'use': '制冷与空气调节技术（冰蓄冷核心参考）', 'ledger': '软件·开发资料图书'},
    '26337000000149291308': {'dir': '方向三·电站+冰蓄冷报告', 'proj': 'TCN-RD2026010', 'patent': 'XMLXSQ202608140173', 'use': '动力电池入门（换电站储能参考）', 'ledger': '软件·开发资料图书'},
}

DIR_COLORS = {'方向一': '#1FA9E8', '方向二': '#141B5E', '方向三': '#16A34A'}

def main():
    global MANUAL
    src = sys.argv[1] if len(sys.argv) > 1 else 'detect_result.json'
    out = sys.argv[2] if len(sys.argv) > 2 else '发票识别总体看板.html'
    if '--manual' in sys.argv:
        mp = sys.argv[sys.argv.index('--manual') + 1]
        MANUAL = json.load(open(mp, encoding='utf-8'))
    rows = json.load(open(src, encoding='utf-8'))

    # 按发票号分组（去重 + 重复清单）
    groups = defaultdict(list)
    for r in rows:
        groups[r['invno'] or ('NOINV:' + r['file'])].append(r)
    uniq = []
    dups = []
    for invno, rs in groups.items():
        rs.sort(key=lambda r: ('已有' in r['file'], r['file']))  # 主目录优先
        uniq.append(rs[0])
        if len(rs) > 1:
            dups.append((invno, [x['file'] for x in rs]))
    uniq.sort(key=lambda r: (MANUAL.get(r['invno'], {}).get('dir', ''), r['date'] or ''))

    total_amt = sum(float(r['amount'] or 0) for r in uniq)
    n_inv = sum(1 for r in rows if r['invno'])
    n_amt = sum(1 for r in rows if r['amount'])
    n_date = sum(1 for r in rows if r['date'])
    n_cat = sum(1 for r in rows if r['cat'])

    # 方向汇总（有人工对照按人工方向，无对照按自动类目分组）
    dir_sum = defaultdict(lambda: {'n': 0, 'amt': 0.0, 'cats': defaultdict(float)})
    cat_sum = defaultdict(lambda: {'n': 0, 'amt': 0.0})
    has_manual = any(r['invno'] in MANUAL for r in uniq)
    for r in uniq:
        m = MANUAL.get(r['invno'], {})
        amt = float(r['amount'] or 0)
        c = r['cat'] or '未识别'
        d = m.get('dir') or (('未对照' if has_manual else '') + c)
        dir_sum[d]['n'] += 1
        dir_sum[d]['amt'] += amt
        dir_sum[d]['cats'][c] += amt
        cat_sum[c]['n'] += 1
        cat_sum[c]['amt'] += amt

    # 逐票行
    trs = []
    for i, r in enumerate(uniq, 1):
        m = MANUAL.get(r['invno'], {})
        d = m.get('dir', '—')
        dc = DIR_COLORS.get(d[:3], '#666')
        item = (r['items'] or ['—'])[0]
        cat_td = r['cat'] or '<b style="color:#DC2626">未识别</b>'
        trs.append(f'''<tr>
<td class="num">{i}</td><td class="mono">{r['invno']}</td><td>{r['date']}</td>
<td class="num money">¥{float(r['amount'] or 0):,.2f}</td>
<td><span class="chip" style="background:{dc}18;color:{dc};border-color:{dc}40">{d}</span></td>
<td>{cat_td}</td><td class="ledger">{m.get('ledger', '—')}</td>
<td class="item" title="{item}">{item}</td>
<td class="mono small">{r['file']}</td>
<td class="small">{m.get('proj', '—')}</td>
</tr>''')

    dup_lis = ''.join(f'<li><span class="mono">{inv}</span>：{" ⇄ ".join(fs)}</li>' for inv, fs in sorted(dups, key=lambda x: -len(x[1])))

    max_cat = max((v['amt'] for v in cat_sum.values()), default=1)
    cat_bars = ''.join(f'''<div class="bar-row"><span class="bar-label">{k}</span>
<div class="bar-track"><div class="bar-fill" style="width:{v['amt']/max_cat*100:.1f}%"></div></div>
<span class="bar-val">{v['n']}张 · ¥{v['amt']:,.2f}</span></div>'''
        for k, v in sorted(cat_sum.items(), key=lambda kv: -kv[1]['amt']))

    dir_cards = ''.join(f'''<div class="dir-card" style="border-top-color:{DIR_COLORS.get(k[:3], '#666')}">
<div class="dir-name">{k}</div><div class="dir-amt">¥{v['amt']:,.2f}</div>
<div class="dir-n">{v['n']} 张发票</div>
<div class="dir-cats">{''.join(f'<span class="mini-chip">{c} ¥{a:,.0f}</span>' for c, a in sorted(v['cats'].items(), key=lambda x: -x[1]))}</div></div>'''
        for k, v in sorted(dir_sum.items()))

    html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>发票识别总体看板 · 开票记录批检</title>
<style>
* {{ margin:0; padding:0; box-sizing:border-box }}
body {{ font-family:"Segoe UI","Microsoft YaHei",sans-serif; background:#F3F5F9; color:#1F2430; padding:28px }}
.wrap {{ max-width:1280px; margin:0 auto }}
header {{ background:linear-gradient(120deg,#141B5E,#1FA9E8); color:#fff; border-radius:16px; padding:26px 30px; margin-bottom:20px }}
header h1 {{ font-size:22px }} header p {{ opacity:.82; font-size:13px; margin-top:6px }}
.cards {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:20px }}
.card {{ background:#fff; border-radius:14px; padding:16px 18px; box-shadow:0 1px 4px rgba(20,27,94,.06) }}
.card .v {{ font-size:26px; font-weight:800; color:#141B5E }} .card .v.ok {{ color:#16A34A }}
.card .k {{ font-size:12px; color:#5A6472; margin-top:4px }}
.panel {{ background:#fff; border-radius:14px; padding:20px 22px; box-shadow:0 1px 4px rgba(20,27,94,.06); margin-bottom:20px }}
.panel h2 {{ font-size:15px; color:#141B5E; margin-bottom:14px }}
.dirs {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:12px }}
.dir-card {{ border:1px solid #E5E9F2; border-top:4px solid #666; border-radius:12px; padding:14px 16px }}
.dir-name {{ font-size:13px; font-weight:700 }} .dir-amt {{ font-size:24px; font-weight:800; color:#141B5E; margin:6px 0 2px }}
.dir-n {{ font-size:12px; color:#5A6472; margin-bottom:8px }}
.mini-chip {{ display:inline-block; font-size:11px; background:#F0F3FA; border-radius:99px; padding:2px 8px; margin:2px 3px 0 0; color:#39415A }}
.bar-row {{ display:flex; align-items:center; gap:10px; margin:8px 0 }}
.bar-label {{ width:150px; font-size:12px; text-align:right; color:#39415A }}
.bar-track {{ flex:1; height:16px; background:#F0F3FA; border-radius:99px; overflow:hidden }}
.bar-fill {{ height:100%; background:linear-gradient(90deg,#1FA9E8,#141B5E); border-radius:99px }}
.bar-val {{ width:150px; font-size:12px; color:#5A6472 }}
table {{ width:100%; border-collapse:collapse; font-size:12.5px }}
th {{ text-align:left; padding:9px 10px; background:#F0F3FA; color:#39415A; font-weight:600; white-space:nowrap; position:sticky; top:0 }}
td {{ padding:8px 10px; border-bottom:1px solid #EEF1F7; vertical-align:top }}
tr:hover td {{ background:#F8FAFE }}
.num {{ text-align:right }} .money {{ font-weight:700; color:#141B5E; white-space:nowrap }}
.mono {{ font-family:Consolas,monospace; font-size:11.5px }} .small {{ font-size:11px; color:#8A93A6 }}
.chip {{ display:inline-block; font-size:11px; border:1px solid; border-radius:99px; padding:2px 9px; white-space:nowrap }}
.ledger {{ color:#5A6472; white-space:nowrap }}
.item {{ max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }}
ul.dups {{ padding-left:18px; font-size:12.5px; line-height:1.9; color:#39415A }}
.scroll {{ overflow-x:auto }}
footer {{ text-align:center; color:#8A93A6; font-size:12px; padding:14px }}
</style></head><body><div class="wrap">
<header><h1>🧾 发票识别总体看板</h1>
<p>开票记录批检 · 37 个 PDF → 文字层直取 + 坐标重组视觉行 · 自动识别发票号 / 金额 / 日期 / 费用类目，与人工三方向分类基准逐票对照</p></header>

<div class="cards">
<div class="card"><div class="v">37</div><div class="k">PDF 文件总数</div></div>
<div class="card"><div class="v ok">23</div><div class="k">独立发票（按发票号去重）</div></div>
<div class="card"><div class="v" style="color:#D97706">14</div><div class="k">重复下载票（自动剔除）</div></div>
<div class="card"><div class="v ok">{n_inv}/37</div><div class="k">发票号识别</div></div>
<div class="card"><div class="v ok">{n_amt}/37</div><div class="k">金额识别（价税合计）</div></div>
<div class="card"><div class="v ok">{n_date}/37</div><div class="k">开票日期识别</div></div>
<div class="card"><div class="v ok">{n_cat}/37</div><div class="k">费用类目推断</div></div>
<div class="card"><div class="v">¥{total_amt:,.2f}</div><div class="k">独立发票合计金额</div></div>
</div>

<div class="panel"><h2>📊 {'三方向汇总（人工口径 × 自动识别金额）' if has_manual else '自动类目汇总（未提供人工对照基准）'}</h2><div class="dirs">{dir_cards}</div></div>

<div class="panel"><h2>🏷️ 自动类目分布（金额）</h2>{cat_bars}
<p style="font-size:12px;color:#8A93A6;margin-top:10px">说明：目录无「图书资料」项时按候选链落「研发费用支出.材料费」；硬件采购类落「办公用品/工具耗材/元器件」。类目为辅助建议，提交前可在报销单中改选，识别不覆盖手改。</p></div>

<div class="panel"><h2>📋 逐票明细（23 张独立发票 · 按方向排序）</h2><div class="scroll"><table>
<thead><tr><th>#</th><th>发票号</th><th>开票日期</th><th>金额</th><th>报销方向(人工)</th><th>自动类目</th><th>人工台账类目</th><th>商品明细</th><th>文件</th><th>研发项目</th></tr></thead>
<tbody>{''.join(trs)}</tbody></table></div></div>

<div class="panel"><h2>🔁 重复票检测（12 组，报销仅计 1 张）</h2><ul class="dups">{dup_lis}</ul></div>

<footer>由 scripts/detect_invoices.py + gen_dashboard.py 生成 · 识别逻辑与 hub.newenergycoder.club/#/reimburse 线上同源</footer>
</div></body></html>'''
    with open(out, 'w', encoding='utf-8') as fp:
        fp.write(html)
    print('看板已生成:', out, '| 独立票 %d 张 合计 ¥%.2f | 重复组 %d' % (len(uniq), total_amt, len(dups)))

if __name__ == '__main__':
    main()
