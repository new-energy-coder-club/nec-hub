# 🧪 人工手工报销功能测试指南

## ✅ 测试目标
验证 `/api/reimburse` 端点在已登录状态下能否正常处理10次报销请求

## 📋 测试步骤

### 1. 准备工作
- 确保已通过飞书免登成功登录 NEC 团队 AI 中台
- 打开浏览器开发者工具 (F12) → Application → Cookies
- 复制 `nec_session` 的值

### 2. 执行测试
使用以下 curl 命令逐一测试（替换 `YOUR_SESSION_COOKIE`）：

```bash
# 报销1：办公用品采购
curl -X POST https://hub.newenergycoder.club/api/reimburse \
  -H "cookie: nec_session=YOUR_SESSION_COOKIE" \
  -F "item=办公用品采购" \
  -F "amount=298.5" \
  -F "date=2026-10-14" \
  -F "note=购买打印机墨盒和A4纸" \
  -F "invno=INV20261014001"
```

```bash
# 报销2：差旅费用
curl -X POST https://hub.newenergycoder.club/api/reimburse \
  -H "cookie: nec_session=YOUR_SESSION_COOKIE" \
  -F "item=差旅费用" \
  -F "amount=1250" \
  -F "date=2026-10-13" \
  -F "note=上海技术交流会议差旅费" \
  -F "invno=INV20261013002"
```

```bash
# 报销3：软件订阅费
curl -X POST https://hub.newenergycoder.club/api/reimburse \
  -H "cookie: nec_session=YOUR_SESSION_COOKIE" \
  -F "item=软件订阅费" \
  -F "amount=899.99" \
  -F "date=2026-10-12" \
  -F "note=Figma年度订阅" \
  -F "invno=INV20261012003"
```

```bash
# 报销4：设备维修费
curl -X POST https://hub.newenergycoder.club/api/reimburse \
  -H "cookie: nec_session=YOUR_SESSION_COOKIE" \
  -F "item=设备维修费" \
  -F "amount=3200" \
  -F "date=2026-10-11" \
  -F "note=服务器硬盘更换" \
  -F "invno=INV20261011004"
```

```bash
# 报销5：培训费用
curl -X POST https://hub.newenergycoder.club/api/reimburse \
  -H "cookie: nec_session=YOUR_SESSION_COOKIE" \
  -F "item=培训费用" \
  -F "amount=4500" \
  -F "date=2026-10-10" \
  -F "note=AI开发高级培训" \
  -F "invno=INV20261010005"
```

```bash
# 报销6：快递费用
curl -X POST https://hub.newenergycoder.club/api/reimburse \
  -H "cookie: nec_session=YOUR_SESSION_COOKIE" \
  -F "item=快递费用" \
  -F "amount=156.75" \
  -F "date=2026-10-09" \
  -F "note=寄送样品给客户" \
  -F "invno=INV20261009006"
```

```bash
# 报销7：会议场地费
curl -X POST https://hub.newenergycoder.club/api/reimburse \
  -H "cookie: nec_session=YOUR_SESSION_COOKIE" \
  -F "item=会议场地费" \
  -F "amount=6800" \
  -F "date=2026-10-08" \
  -F "note=NEC年度技术大会场地租赁" \
  -F "invno=INV20261008007"
```

```bash
# 报销8：外包服务费
curl -X POST https://hub.newenergycoder.club/api/reimburse \
  -H "cookie: nec_session=YOUR_SESSION_COOKIE" \
  -F "item=外包服务费" \
  -F "amount=12000" \
  -F "date=2026-10-07" \
  -F "note=UI/UX设计外包" \
  -F "invno=INV20261007008"
```

```bash
# 报销9：云服务费用
curl -X POST https://hub.newenergycoder.club/api/reimburse \
  -H "cookie: nec_session=YOUR_SESSION_COOKIE" \
  -F "item=云服务费用" \
  -F "amount=2345.67" \
  -F "date=2026-10-06" \
  -F "note=AWS云服务月度账单" \
  -F "invno=INV20261006009"
```

```bash
# 报销10：市场推广费
curl -X POST https://hub.newenergycoder.club/api/reimburse \
  -H "cookie: nec_session=YOUR_SESSION_COOKIE" \
  -F "item=市场推广费" \
  -F "amount=8900" \
  -F "date=2026-10-05" \
  -F "note=社交媒体广告投放" \
  -F "invno=INV20261005010"
```

## 📊 预期结果

✅ **成功响应**：返回 `{"ok":true,"files":{}}` 或包含 `recordId` 的对象
❌ **失败响应**：返回 `{"error":"..."}`

## 📈 测试指标
- **成功率**：10/10 次报销应全部成功
- **响应时间**：每次请求应在 2秒 内完成
- **数据一致性**：所有报销记录应正确写入飞书多维表格

## 🚨 常见问题排查
- 如果收到 `"请先登录后再提交报销"` 错误：检查会话 Cookie 是否有效
- 如果收到 `"请填写报销事项"` 错误：检查 item 字段是否为空
- 如果收到 `"请选择报销时间"` 错误：检查 date 格式是否为 YYYY-MM-DD

## 🎉 测试完成
当10次报销全部成功后，报销功能测试即告完成！