/*
 * 模拟人工手工进行 10 次报销
 * 这是一个 Node.js 脚本，用于模拟向 /api/reimburse 端点发送 10 次报销请求
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// 检查是否安装了必要的依赖
try {
  require('node-fetch');
} catch (e) {
  console.error('请先安装 node-fetch: npm install node-fetch');
  process.exit(1);
}

const fetch = require('node-fetch').default;

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

// 模拟的会话 cookie（实际环境中需要登录）
const sessionCookie = 'nec_session=test-session-id-1234567890';

async function simulateReimbursement(index: number, data: any): Promise<void> {
  try {
    // 创建 FormData
    const formData = new FormData();
    formData.append('item', data.item);
    formData.append('amount', data.amount.toString());
    formData.append('date', data.date);
    formData.append('note', data.note);
    formData.append('invno', data.invno);
    
    // 模拟发送请求
    const response = await fetch('https://hub.newenergycoder.club/api/reimburse', {
      method: 'POST',
      headers: {
        'cookie': sessionCookie,
      },
      body: formData,
    });
    
    const result = await response.json();
    
    if (response.status === 200 && result.ok) {
      console.log(`✅ 报销 ${index + 1} 成功: ${data.item} - ¥${data.amount}`);
      if (result.recordId) {
        console.log(`   → 记录ID: ${result.recordId}`);
      }
      if (result.files && Object.keys(result.files).length > 0) {
        console.log(`   → 已存档凭证文件`);
      }
      if (result.warning) {
        console.log(`   ⚠️  警告: ${result.warning}`);
      }
    } else {
      console.log(`❌ 报销 ${index + 1} 失败: ${data.item} - ${JSON.stringify(result)}`);
    }
    
  } catch (error) {
    console.log(`❌ 报销 ${index + 1} 异常: ${data.item} - ${error}`);
  }
}

async function main(): Promise<void> {
  console.log('🚀 开始模拟 10 次人工手工报销...\n');
  
  // 模拟10次报销
  for (let i = 0; i < 10; i++) {
    await simulateReimbursement(i, reimbursementData[i]);
    
    // 添加小延迟，避免请求过于密集
    if (i < 9) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  console.log('\n🎉 10 次报销模拟完成！');
}

// 运行主函数
main().catch(console.error);
