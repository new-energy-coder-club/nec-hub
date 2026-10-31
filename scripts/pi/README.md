# 树莓派常驻端点（团队共享 staging / MCP）

把 nec-hub 跑在局域网树莓派上，作为团队共享的开发与调试端点：试工具、跑脚本、前端联调都走 Pi，**不消耗 Cloudflare 免费档配额**（cron 触发 / KV 写），也不影响生产。

## 拓扑

```
队员 Kimi Code ──► http://<pi-ip>:8787/mcp ──► Pi 上的 wrangler dev（Miniflare 本地模拟 KV/R2/D1）
                                                 数据存 Pi 本地 .wrangler/state，与生产隔离
生产（不受影响）：https://hub.newenergycoder.club ──► Cloudflare Worker + 真实 KV/R2/D1
```

## 首次安装（在 Pi 上执行一次）

前置：Raspberry Pi OS / Ubuntu 64 位，能联网。仓库公开可匿名克隆，直连失败自动走 gh-proxy 镜像。

```bash
git clone https://github.com/necc-hub/nec-hub.git ~/nec-hub
cd ~/nec-hub && bash scripts/pi/install.sh
```

脚本完成：Node 20 安装 → 依赖安装 → 生成团队 `MCP_TOKEN`（仅显示一次，分发给队员）→ 注册 systemd 服务 `nec-hub`（开机自启、崩溃自拉起、监听 `0.0.0.0:8787`）→ 健康自检。

## 队员接入（Kimi Code）

在 `~/.kimi-code/mcp.json`（全项目通用）或某项目 `.kimi-code/mcp.json` 的 `mcpServers` 里加：

```json
"nec-hub-dev": {
  "url": "http://<pi-ip>:8787/mcp",
  "headers": { "Authorization": "Bearer <团队 token>" }
}
```

- 命名 `nec-hub-dev` 与生产 `nec-hub` 并存，互不影响；新会话生效，`/mcp` 查状态。
- macOS/iOS 可直接用 mDNS 主机名（如 `http://printserver.local:8787/mcp`）；Windows 用 IP。
- 路由器里给 Pi 做 DHCP 静态绑定，保证 IP 不变。

## 日常运维

| 操作 | 命令（Pi 上） |
|---|---|
| 升级代码 | `cd ~/nec-hub && bash scripts/pi/install.sh`（幂等：git pull + 依赖增量 + 重启） |
| 看日志 | `journalctl -u nec-hub -f` |
| 启停 | `sudo systemctl restart nec-hub` |
| 轮换 token | 改 `~/nec-hub/.dev.vars` 的 `MCP_TOKEN` → `sudo systemctl restart nec-hub` → 重新分发队员 |
| 清空模拟数据 | 停服后删 `~/nec-hub/.wrangler/state`，再启动 |

## 可选：公网访问（Cloudflare Tunnel）

队员不在同一局域网时，给 Pi 的隧道加一个 hostname（如 `nec-dev.newenergycoder.club` → `http://localhost:8787`），队员 URL 换成隧道域名即可。注意 Pi 服务本身无 TLS，务必确认队员都带 token 访问，且不要在公网隧道上关闭 `MCP_TOKEN` 保护。
