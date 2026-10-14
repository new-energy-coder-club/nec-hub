/*
 * 模拟人工手工进行 10 次报销
 * 这是一个 Node.js 脚本，用于模拟向 /api/reimburse 端点发送 10 次报销请求
 */

// 报销数据模板
const reimbursementData = [
  {
    item: '办公用品采购',
    amount: 298.5,
    date: '2026-10-14',
    note: '购买打印机墨盒和A4纸',
    invno: 'INV20261014001'
  },
  {
    item: '差旅费用',
    amount: 1250.0,
    date: '2026-10-13',
    note: '上海技术交流会议差旅费',
    invno: 'INV20261013002'
  },
  {
    item: '软件订阅费',
    amount: 899.99,
    date: '2026-10-12',
    note: 'Figma年度订阅',
    invno: 'INV20261012003'
  },
  {
    item: '设备维修费',
    amount: 3200.0,
    date: '2026-10-11',
    note: '服务器硬盘更换',
    invno: 'INV20261011004'
  },
  {
    item: '培训费用',
    amount: 4500.0,
    date: '2026-10-10',
    note: 'AI开发高级培训',
    invno: 'INV20261010005'
  },
  {
    item: '快递费用',
    amount: 156.75,
    date: '2026-10-09',
    note: '寄送样品给客户',
    invno: 'INV20261009006'
  },
  {
    item: '会议场地费',
    amount: 6800.0,
    date: '2026-10-08',
    note: 'NEC年度技术大会场地租赁',
    invno: 'INV20261008007'
  },
  {
    item: '外包服务费',
    amount: 12000.0,
    date: '2026-10-07',
    note: 'UI/UX设计外包',
    invno: 'INV20261007008'
  },
  {
    item: '云服务费用',
    amount: 2345.67,
    date: '2026-10-06',
    note: 'AWS云服务月度账单',
    invno: 'INV20261006009'
  },
  {
    item: '市场推广费',
    amount: 8900.0,
    date: '2026-10-05',
    note: '社交媒体广告投放',
    invno: 'INV20261005010'
  }
];

console.log('🚀 人工手工报销模拟指南');
console.log('========================');
console.log('');
console.log('要成功提交报销，您需要：');
console.log('');
console.log('1. 首先登录 NEC 团队 AI 中台门户：https://hub.newenergycoder.club');
console.log('2. 登录后，浏览器会自动设置 nec_session Cookie');
console.log('3. 打开浏览器开发者工具 (F12)，切换到 Application → Cookies → https://hub.newenergycoder.club');
console.log('4. 复制 nec_session 的值');
console.log('');
console.log('5. 使用 curl 命令提交报销（替换 YOUR_SESSION_COOKIE）：');
console.log('');
console.log('curl -X POST https://hub.newenergycoder.club/api/reimburse \');
console.log('  -H "cookie: nec_session=YOUR_SESSION_COOKIE" \');
console.log('  -F "item=办公用品采购" \');
console.log('  -F "amount=298.5" \');
console.log('  -F "date=2026-10-14" \');
console.log('  -F "note=购买打印机墨盒和A4纸" \');
console.log('  -F "invno=INV20261014001"');
console.log('');
console.log('6. 或者在门户中直接使用网页表单提交：');
console.log('   - 访问 https://hub.newenergycoder.club/#tab-dashboard');
console.log('   - 在「财务报销」区域填写表单并提交');
console.log('');
console.log('✅ 10 次报销数据已准备就绪：');
console.log('');
reimbursementData.forEach((data, index) => {
  console.log(`${index + 1}. ${data.item} - ¥${data.amount} (${data.date})`);
});
console.log('');
console.log('💡 提示：实际报销时请确保：');
console.log('   - 金额格式正确（不带逗号和货币符号）');
console.log('   - 日期格式为 YYYY-MM-DD');
console.log('   - 发票号符合公司规范');
console.log('   - 事项描述清晰准确');
console.log('');
console.log('🎉 模拟完成！现在您可以开始手工报销了。');
