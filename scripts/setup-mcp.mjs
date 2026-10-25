#!/usr/bin/env node
/**
 * setup-mcp.mjs — 一键生成桌面 IDE 的 NEC-MCP 接入配置（Kimi Code / Claude Code 等）
 *
 *   npm run mcp:setup              # 远程生产（默认）：https://hub.newenergycoder.club/mcp
 *   npm run mcp:setup -- --local   # 本地开发：http://localhost:8787/mcp（需先 npm run dev）
 *   npm run mcp:setup -- --url https://xxx/mcp --token yyy   # 自定义
 *
 * token 来源：NEC_MCP_TOKEN 环境变量 > --token 参数 > .mcp-token 文件。
 * 写入前先用 initialize 验证 token 有效性，401 直接报错不写坏配置。
 * 产物：.kimi-code/mcp.json + .mcp.json（均含 token，已加入 .gitignore；旧文件备份为 *.bak）。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const opt = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const local = has("--local");
const url = opt("--url") ?? (local ? "http://localhost:8787/mcp" : "https://hub.newenergycoder.club/mcp");
const token = opt("--token") ?? process.env.NEC_MCP_TOKEN
  ?? (existsSync(path.join(root, ".mcp-token")) ? readFileSync(path.join(root, ".mcp-token"), "utf8").trim() : "");

if (!token) {
  console.error("❌ 未找到 token：请设置 NEC_MCP_TOKEN、传 --token，或在项目根目录放 .mcp-token 文件");
  process.exit(1);
}

// 写入前验证：401 = token 与目标环境不符（本地 dev 与生产 token 通常不同）
const resp = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }),
}).catch((err) => {
  console.error(`❌ 无法连接 ${url}：${err.cause?.code ?? err.message}`);
  if (local) console.error("   本地模式请先运行 npm run dev");
  process.exit(1);
});
if (resp.status === 401) {
  console.error(`❌ ${url} 返回 401 unauthorized：token 与目标环境不符。`);
  console.error(local ? "   本地 dev 用 .dev.vars 里的 MCP_TOKEN。" : "   生产 token 与本地不同，请找维护者获取生产 MCP_TOKEN（或用 --local 先走本地）。");
  process.exit(1);
}
if (!resp.ok) {
  console.error(`❌ initialize 失败：HTTP ${resp.status} ${await resp.text()}`);
  process.exit(1);
}
// 流式响应可能不主动关闭连接（streamable HTTP 保活），json() 会挂起：限时取文本后解析首个 JSON
const text = await Promise.race([
  resp.text(),
  new Promise((_, reject) => setTimeout(() => reject(new Error("读取响应超时")), 15_000)),
]);
const body = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
console.log(`✅ 连接验证通过：${body.result?.serverInfo?.name ?? "NEC-MCP"} ${body.result?.serverInfo?.version ?? ""} @ ${url}`);

const config = { mcpServers: { "nec-hub": { url, headers: { Authorization: `Bearer ${token}` } } } };
for (const rel of [".kimi-code/mcp.json", ".mcp.json"]) {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, file + ".bak");
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  console.log(`📝 已写入 ${rel}${existsSync(file + ".bak") ? "（旧文件备份为 .bak）" : ""}`);
}
console.log("\n下一步：在 IDE 中重连/重启 MCP（Kimi Code 重开会话即可）。");
console.log(local
  ? "当前为【本地 dev】模式：数据读写都落在本地 KV，与生产互不相通；先 npm run dev。"
  : "当前为【生产】模式：操作直接作用于线上中台（写操作请谨慎）。");
