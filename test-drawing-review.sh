#!/bin/bash
# NEC 图纸评审配置验证脚本

echo "=== NEC 图纸评审配置验证 ==="
echo ""

# 检查服务状态
echo "1. 检查本地开发服务..."
if curl -s -o /dev/null -w "%{http_code}" http://localhost:8799/api/drawing-review/config | grep -q "200"; then
    echo "✅ 本地服务运行正常"
else
    echo "❌ 本地服务未运行，请先启动：npm exec wrangler dev --port 8799"
    exit 1
fi

# 检查配置状态
echo ""
echo "2. 检查图纸评审配置..."
CONFIG=$(curl -s http://localhost:8799/api/drawing-review/config)
echo "$CONFIG" | jq '.'

CONFIGURED=$(echo "$CONFIG" | jq -r '.configured')
if [ "$CONFIGURED" = "true" ]; then
    echo "✅ 配置已启用"
    BASE=$(echo "$CONFIG" | jq -r '.base')
    echo "   Base: $BASE"
    TABLES=$(echo "$CONFIG" | jq -r '.tables | keys | join(", ")')
    echo "   Tables: $TABLES"
else
    echo "❌ 配置未启用"
    exit 1
fi

# 测试配置验证
echo ""
echo "3. 验证配置有效性..."
VALIDATION_RESPONSE=$(curl -s -X POST http://localhost:8799/api/drawing-review/config \
  -H "content-type: application/json" \
  -d '{"action": "get"}')

if echo "$VALIDATION_RESPONSE" | jq -e '.configured' > /dev/null; then
    echo "✅ 配置验证通过"
else
    echo "❌ 配置验证失败"
    echo "$VALIDATION_RESPONSE" | jq '.'
    exit 1
fi

# 检查必需表格
echo ""
echo "4. 检查必需表格配置..."
REQUIRED_TABLES=("reviews" "minutes" "bom" "rectifications" "events")
MISSING_TABLES=()

for table in "${REQUIRED_TABLES[@]}"; do
    if echo "$CONFIG" | jq -e ".tables.$table" > /dev/null; then
        echo "✅ $table 已配置"
    else
        echo "❌ $table 未配置"
        MISSING_TABLES+=("$table")
    fi
done

if [ ${#MISSING_TABLES[@]} -gt 0 ]; then
    echo ""
    echo "⚠️  缺少以下表格配置：${MISSING_TABLES[*]}"
    echo "   请在飞书多维表格中创建这些表，然后更新配置"
fi

# 测试图纸评审创建（模拟）
echo ""
echo "5. 测试图纸评审创建（模拟）..."
echo "   注意：由于需要飞书登录，此步骤仅验证API端点可达性"
echo "   实际测试需要有效的飞书会话"

SUBMIT_RESPONSE=$(curl -s -X POST http://localhost:8799/api/drawing-review/submit \
  -H "content-type: application/json" \
  -d '{
    "projectId": "TEST-001",
    "machineName": "测试机型A",
    "drawingVersion": "V1.0",
    "designerId": "test-user-001",
    "drawingFiles": [{"name": "test-drawing.pdf", "size": 1024}],
    "designNotes": "测试图纸评审"
  }')

if echo "$SUBMIT_RESPONSE" | jq -e '.error' > /dev/null; then
    ERROR_MSG=$(echo "$SUBMIT_RESPONSE" | jq -r '.error')
    if [ "$ERROR_MSG" = "请先登录" ]; then
        echo "✅ API端点正常（需要飞书登录）"
    else
        echo "❌ API错误: $ERROR_MSG"
    fi
else
    echo "✅ 图纸评审创建成功"
fi

echo ""
echo "=== 配置验证完成 ==="
echo ""
echo "📋 下一步操作建议："
echo "1. 确保飞书多维表格中存在配置的表格"
echo "2. 使用飞书工作台登录获取有效会话"
echo "3. 测试完整的图纸评审创建流程"
