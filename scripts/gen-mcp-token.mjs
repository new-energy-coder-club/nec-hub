#!/usr/bin/env node
/**
 * gen-mcp-token.mjs — 生成本地 MCP token（写入 .mcp-token，不触碰生产）
 *
 *   npm run mcp:token
 *
 * 生产生效需再执行脚本最后打印的 wrangler secret put（需本机 wrangler 已登录）。
 * 注意：轮换生产 MCP_TOKEN 会使所有持有旧 token 的客户端立即失效。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokenFile = path.join(root, ".mcp-token");

if (existsSync(tokenFile) && !process.argv.includes("--force")) {
  console.log("ℹ️  .mcp-token 已存在（未覆盖）。要重新生成请加 --force：npm run mcp:token -- --force");
  process.exit(0);
}

const token = randomBytes(24).toString("hex"); // 48 位十六进制
writeFileSync(tokenFile, token + "\n");
console.log("✅ 新 token 已写入 .mcp-token（已被 .gitignore 忽略，勿外传）");

// 本地 dev 一致性提示：.dev.vars 的 MCP_TOKEN 与 .mcp-token 不同步时，本地 MCP 也会 401
const devVars = path.join(root, ".dev.vars");
if (existsSync(devVars)) {
  const current = readFileSync(devVars, "utf8").match(/^MCP_TOKEN=(.+)$/m)?.[1]?.trim();
  if (current && current !== token) {
    console.log("⚠️  .dev.vars 里的 MCP_TOKEN 与新 token 不一致：本地 dev（npm run dev）会校验失败。");
    console.log("   本地联调请把 .dev.vars 的 MCP_TOKEN 改成同一个值，或 npm run mcp:setup -- --local 前同步。");
  }
}

console.log("\n下一步：");
console.log("  生产生效：  npx wrangler secret put MCP_TOKEN   # 粘贴 .mcp-token 的内容");
console.log("  IDE 接入：  npm run mcp:setup                    # 远程生产（默认）");
console.log("  ⚠️  轮换生产 token 后，所有旧 token 客户端（IDE / openClaw / 其它 Agent）需重新配置。");
