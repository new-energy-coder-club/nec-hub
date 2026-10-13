# 🚀 人工手工报销模拟指南

## 要成功提交报销，您需要：

1. **首先登录 NEC 团队 AI 中台门户**：https://hub.newenergycoder.club
2. **登录后**，浏览器会自动设置 `nec_session` Cookie
3. **打开浏览器开发者工具 (F12)**，切换到 Application → Cookies → https://hub.newenergycoder.club
4. **复制 `nec_session` 的值**

## 使用 curl 命令提交报销（替换 YOUR_SESSION_COOKIE）：

```bash
curl -X POST https://hub.newenergycoder.club/api/reimburse \
  -H "cookie: nec_session=YOUR_SESSION_COOKIE" \
  -F "item=办公用品采购" \
  -F "amount=298.5" \
  -F "date=2026-10-14" \
  -F "note=购买打印机墨盒和A4纸" \
  -F "invno=INV20261014001"
```

## 或者在门户中直接使用网页表单提交：

- 访问 https://hub.newenergycoder.club/#tab-dashboard
- 在「财务报销」区域填写表单并提交

## ✅ 10 次报销数据已准备就绪：

1. 办公用品采购 - ¥298.5 (2026-10-14)
2. 差旅费用 - ¥1250 (2026-10-13)
3. 软件订阅费 - ¥899.99 (2026-10-12)
4. 设备维修费 - ¥3200 (2026-10-11)
5. 培训费用 - ¥4500 (2026-10-10)
6. 快递费用 - ¥156.75 (2026-10-09)
7. 会议场地费 - ¥6800 (2026-10-08)
8. 外包服务费 - ¥12000 (2026-10-07)
9. 云服务费用 - ¥2345.67 (2026-10-06)
10. 市场推广费 - ¥8900 (2026-10-05)

## 💡 提示：实际报销时请确保：

- 金额格式正确（不带逗号和货币符号）
- 日期格式为 YYYY-MM-DD
- 发票号符合公司规范
- 事项描述清晰准确

🎉 模拟完成！现在您可以开始手工报销了。