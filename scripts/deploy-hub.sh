#!/usr/bin/env bash
# deploy-hub.sh — nec-hub 一键部署 + 绑定 hub.newenergycoder.club
# 前置：wrangler 已登录（wrangler login）或设置了 CLOUDFLARE_API_TOKEN
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 0. 检查登录态 =="
wrangler whoami | grep -E "Account|associated" || { echo "未登录，请先运行 wrangler login"; exit 1; }

echo "== 1. 创建生产 KV 命名空间 =="
KV_JSON=$(wrangler kv namespace create nec-hub-registry --json 2>/dev/null || true)
KV_ID=$(echo "$KV_JSON" | python -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
if [ -z "$KV_ID" ]; then
  echo "命名空间可能已存在，列出已有："
  wrangler kv namespace list 2>/dev/null | head -20
  echo "如已存在 nec-hub-registry，请把其 id 手动填入 wrangler.jsonc 后重跑本脚本（会跳过创建）"
  read -r -p "直接粘贴已有 KV id 继续（或回车退出）：" KV_ID
  [ -z "$KV_ID" ] && exit 1
fi
echo "KV id = $KV_ID"

echo "== 2. 创建生产 R2 桶 =="
wrangler r2 bucket create nec-hub-apps 2>&1 || echo "（桶已存在则忽略）"

echo "== 3. 回填 wrangler.jsonc =="
python - "$KV_ID" <<'EOF'
import sys
kv_id = sys.argv[1]
p = "wrangler.jsonc"
s = open(p, encoding="utf-8")
s = s.replace('"id": "nec-hub-registry"', f'"id": "{kv_id}"')
open(p, "w", encoding="utf-8").write(s)
print("wrangler.jsonc 已回填 KV id")
EOF

echo "== 4. 构建门户前端（产物直出 public/，构建前自动清空 portal-assets）=="
(cd web && npm run build)

echo "== 5. 部署 Worker（自动绑定自定义域名 hub.newenergycoder.club）=="
wrangler deploy

echo "== 6. 等待 DNS/证书生效并验证 =="
for i in 1 2 3 4 5 6; do
  sleep 10
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 https://hub.newenergycoder.club/api/health || true)
  echo "第 ${i} 次探测：HTTP $CODE"
  [ "$CODE" = "200" ] && break
done

curl -s https://hub.newenergycoder.club/api/health || true
echo
echo "== 完成 =="
echo "门户：https://hub.newenergycoder.club"
echo "后续如需飞书免登：wrangler secret put FEISHU_APP_ID && wrangler secret put FEISHU_APP_SECRET"
echo "后续如需 MCP 写保护：wrangler secret put MCP_TOKEN"
