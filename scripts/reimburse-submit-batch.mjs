#!/usr/bin/env node
/**
 * 一键提交发票报销批次（R-01 ERP 报销助手）
 *
 * 流程：读取 docs/报销整理_发票汇总_2026-10.json 的 batches，
 *   对每批：逐个 PDF 上传到 /api/approvals/upload（R2 receipts/）→
 *   携带返回的 key 调 /api/erp/reimburse/submit 发起整单审批。
 *
 * 用法：
 *   BASE=https://hub.newenergycoder.club \
 *   COOKIE="nec_session=xxx（门户飞书登录后的 Cookie）" \
 *   node scripts/reimburse-submit-batch.mjs [--dry-run] [JSON 文件路径]
 *
 * 约束（与后端 SOP 同源）：每批 ≤10 附件、≤50 行明细；发票号 8/20 位。
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const dryRun = process.argv.includes("--dry-run");
const base = (process.env.BASE || "https://hub.newenergycoder.club").replace(/\/+$/, "");
const cookie = process.env.COOKIE || "";
const jsonArg =
  process.argv.find((a) => a.endsWith(".json") && !a.startsWith("-")) ||
  process.env.INVOICE_JSON ||
  "docs/报销整理_发票汇总_2026-10.json";

const payload = JSON.parse(await readFile(jsonArg, "utf-8"));
const batches = payload.batches || [];
if (!batches.length) {
  console.error("JSON 中没有 batches（%s）", jsonArg);
  process.exit(1);
}

const missing = [];
for (const b of batches) {
  for (const f of b.sourceFiles || []) {
    if (!existsSync(f)) missing.push(f);
  }
}
if (missing.length) {
  console.error("以下 %d 个源文件不存在，请核对 INVOICE_JSON 中 localPath：", missing.length);
  for (const f of missing) console.error("  -", f);
  if (!dryRun) process.exit(1);
}

if (!cookie) {
  console.error("缺少 COOKIE（nec_session=...）。先在门户完成飞书登录，从浏览器复制 Cookie，或用 --dry-run 预览。");
  process.exit(dryRun ? 0 : 1);
}

console.log("BASE=%s batches=%d 总发票=%d dryRun=%s", base, batches.length, payload.meta?.invoiceCount, dryRun);
for (const b of batches) {
  const lines = b.lines || [];
  const sum = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  console.log(
    "[批次 %d] %d 行明细 / %d 个附件，合计 ¥%s，%s",
    b.batchNo,
    lines.length,
    (b.sourceFiles || []).length,
    sum.toFixed(2),
    dryRun ? "（dry-run 跳过）" : "上传并提交中…",
  );
  if (dryRun) continue;

  const keys = [];
  for (const f of b.sourceFiles || []) {
    const form = new FormData();
    const buf = await readFile(f);
    form.append("file", new Blob([buf], { type: "application/pdf" }), path.basename(f));
    const r = await fetch(base + "/api/approvals/upload", { method: "POST", headers: { cookie }, body: form });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) {
      console.error("[批次 %d] 上传失败 %s：%s", b.batchNo, path.basename(f), d.error || ("HTTP " + r.status));
      process.exit(1);
    }
    for (const it of d.files || []) keys.push(it.key);
    console.log("  上传", path.basename(f), "→", (d.files || []).map((x) => x.key).join(","));
  }

  const body = {
    lines,
    note: b.note || "",
    noinv: "",
    payee: { method: "", account_name: "", account_no: "", bank: "" },
    attachments: keys,
  };
  const r = await fetch(base + "/api/erp/reimburse/submit", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) {
    const detail = Array.isArray(d.detail) && d.detail.length ? "：" + d.detail.join("；") : "";
    console.error("[批次 %d] 提交失败：%s%s", b.batchNo, d.error || ("HTTP " + r.status), detail);
    process.exit(1);
  }
  console.log("[批次 %d] 提交成功 status=%s application_id=%s", b.batchNo, d.status, d.application_id);
}
console.log("全部批次处理完成。");