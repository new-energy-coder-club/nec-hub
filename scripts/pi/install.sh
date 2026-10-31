#!/usr/bin/env bash
# NEC Hub 树莓派常驻端点：一键安装/升级（在 Pi 上执行，幂等可重跑）
# 用法：bash scripts/pi/install.sh
# 可选环境变量：REPO_URL（覆盖仓库地址）· INSTALL_DIR（默认 ~/nec-hub）· PORT（默认 8787）
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/necc-hub/nec-hub.git}"
MIRROR_URL="https://gh-proxy.com/https://github.com/necc-hub/nec-hub.git"
INSTALL_DIR="${INSTALL_DIR:-$HOME/nec-hub}"
PORT="${PORT:-8787}"

echo "==> [1/5] Node.js 20+"
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then
  echo "    node $(node -v) 已就绪"
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> [2/5] 拉取代码 → $INSTALL_DIR"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  if ! git clone "$REPO_URL" "$INSTALL_DIR"; then
    echo "    GitHub 直连失败，改用 gh-proxy 镜像"
    git clone "$MIRROR_URL" "$INSTALL_DIR"
  fi
fi
cd "$INSTALL_DIR"

echo "==> [3/5] 安装依赖（首次约 3-8 分钟）"
npm install --no-fund --no-audit

echo "==> [4/5] 配置团队 MCP_TOKEN"
if [ ! -s .dev.vars ]; then
  TOKEN="$(openssl rand -hex 24)"
  printf 'MCP_TOKEN=%s\n' "$TOKEN" > .dev.vars
  chmod 600 .dev.vars
  echo "    已生成团队 token（仅此一次显示，请记录并分发队员）：$TOKEN"
else
  echo "    .dev.vars 已存在，token 保持不变"
fi

echo "==> [5/5] systemd 常驻（开机自启 + 崩溃自拉起）"
sudo cp scripts/pi/nec-hub.service /etc/systemd/system/nec-hub.service
sudo sed -i "s|__USER__|$USER|g; s|__INSTALL_DIR__|$INSTALL_DIR|g; s|__PORT__|$PORT|g" /etc/systemd/system/nec-hub.service
sudo systemctl daemon-reload
sudo systemctl enable --now nec-hub
sudo systemctl restart nec-hub

echo "==> 自检"
PI_IP="$(hostname -I | awk '{print $1}')"
for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "    OK：http://$PI_IP:$PORT/api/health"
    echo ""
    echo "队员 Kimi Code 配置（写入 ~/.kimi-code/mcp.json 的 mcpServers 内）："
    printf '"nec-hub-dev": { "url": "http://%s:%s/mcp", "headers": { "Authorization": "Bearer <团队 token>" } }\n' "$PI_IP" "$PORT"
    exit 0
  fi
  sleep 2
done
echo "!! 健康检查未通过，查看日志：journalctl -u nec-hub -f" >&2
exit 1
