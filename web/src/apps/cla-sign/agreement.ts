// CLA 协议正文与存证编号计算（自 public/apps/cla-sign/index.html 内联脚本迁入，文案逐字保留）

export const AGREEMENT = `
  常州工学院 NEC 开源社区
  贡献者许可协议（Contributor License Agreement, CLA）
  版本 1.0 · 2026-10-14 生效

  感谢你为 NEC（New Energy Coder）开源社区做出贡献。
  为明确贡献的知识产权归属与许可方式，请在提交代码、
  文档、设计或其他贡献前阅读并签署本协议。

  第一条  定义
  1.1 "贡献"指你以任何形式有意提交给本社区任一项目
      的作品，包括源代码、文档、设计稿、数据等。
  1.2 "项目"指本社区在 GitHub / Gitee 等平台维护的
      任一开源仓库。

  第二条  版权许可
  你就你的贡献，授予本社区及项目的所有接收者一项
  永久的、全球范围的、非独占的、免费的、不可撤销
  的版权许可，允许以项目所采用的开源许可证（如
  MIT / Apache-2.0）使用、复制、修改、再分发你的
  贡献。你保留对贡献的著作权。

  第三条  专利许可
  你就贡献中由你持有的专利权利要求，授予本社区及
  接收者一项永久的、全球范围的、非独占的、免费的、
  不可撤销的专利许可。

  第四条  原创性声明
  4.1 你声明贡献为你的原创作品，或你已获得充分授
      权按本协议提交。
  4.2 你声明贡献不侵犯任何第三方的知识产权；如贡
      献包含第三方内容，你已在提交时明确标识其来
      源与许可证。
  4.3 如你的贡献属于职务作品，你声明已获得所在单
      位的许可。

  第五条  免责
  贡献按"现状"提供，你不对贡献提供任何明示或默示
  担保。本协议不影响项目开源许可证中的免责条款。

  第六条  生效与版本
  6.1 本协议自你完成签署之时起生效，适用于你在生
      效前后向本社区提交的全部贡献。
  6.2 社区可发布协议新版本；你已完成的签署仍对应
      你签署时的版本。

  ────────────────────────────────────────────
  阅读完毕后，在右侧终端执行签署命令。
`.trim()

export const AGREEMENT_UPDATED_AT = '2026-10-14'

/** 证书中的协议全文去掉页面内的操作提示行 */
export function certAgreementText(): string {
  return AGREEMENT.replace(/─+\n\s*阅读完毕后，在右侧终端执行签署命令。\s*$/, '').trimEnd()
}

export interface ClaSignature {
  name: string
  github: string
  email?: string
  org?: string
  version: string
  signedAt: string
}

/** 存证编号：协议版本 + GitHub + 签署时间的 SHA-256 前 16 位（可离线复算校验） */
export async function certId(sig: ClaSignature): Promise<string> {
  const raw = `nec-cla|v${sig.version}|${sig.github.toLowerCase()}|${sig.signedAt}`
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16).toUpperCase()
}

export function fmtDate(iso: string): string {
  return (iso || '').slice(0, 10)
}

export function fmtCN(iso: string): string {
  try { return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + ' (UTC+8)' }
  catch { return iso }
}
