/**
 * 通过 wrangler secret put 配置的 secrets 声明（全局 Env 补充，从 index.ts 拆出）。
 *
 * 类型：运行 `npx wrangler types` 生成 worker-configuration.d.ts 后，下面的声明合并会把
 * secrets 补到 Cloudflare.Env 上。wrangler.jsonc 变更后请重新生成类型。
 *
 * 注意：本地 .dev.vars 中存在的 secret 会被 wrangler types 生成为必填 string 并并入 __BaseEnv_Env，
 * 因此与其重叠的字段（MCP_TOKEN / FEISHU_APP_ID / FEISHU_BOT_WEBHOOK / FEISHU_BOT_WEBHOOK_SECRET）
 * 此处声明为必填 string，兼顾"生成文件有无该字段"两种环境。
 */
declare global {
  interface Env {
    /** 设置后，/mcp 写操作需携带 Authorization: Bearer <token>（用 wrangler secret put MCP_TOKEN 配置） */
    MCP_TOKEN: string;
    /** 飞书自建应用凭证（第二阶段接入 query_bitable 时启用） */
    FEISHU_APP_ID: string;
    FEISHU_APP_SECRET?: string;
    /** Vercel 同步（sync_vercel 工具用） */
    VERCEL_TOKEN?: string;
    VERCEL_TEAM?: string;
    /** GitHub API（/api/repos 仓库列表用，可选；配置后限额更高） */
    GITHUB_TOKEN?: string;
    /** Gitee API（/api/repos 仓库列表用，可选；匿名 60 次/小时，配置后限额更高） */
    GITEE_TOKEN?: string;
    /** Gitee 账号（/api/repos 数据源之一，可选；默认 darrenpig，wrangler.jsonc vars 覆盖） */
    GITEE_USER?: string;
    /** GitHub Webhook secret（/api/hooks/github 验签用；未配置时拒绝接收推送） */
    GITHUB_WEBHOOK_SECRET?: string;
    /** 飞书群自定义机器人 webhook（FE-05 每周校验摘要推送 + 图纸评审流程通知/阻塞告警；未配置则跳过推送不报错） */
    FEISHU_WEBHOOK_URL?: string;
    /** FEISHU_WEBHOOK_URL 的加签 secret（机器人开启加签时必填，否则推送被拒） */
    FEISHU_WEBHOOK_SECRET?: string;
    /** 审批通知群机器人 webhook（PRD V1.1 N-01）；可按流程分流 FEISHU_BOT_WEBHOOK_<TYPE>，加签 secret 为同名 _SECRET 变量 */
    FEISHU_BOT_WEBHOOK: string;
    FEISHU_BOT_WEBHOOK_SECRET: string;
    FEISHU_BOT_WEBHOOK_PRD?: string;
    FEISHU_BOT_WEBHOOK_PRD_SECRET?: string;
    FEISHU_BOT_WEBHOOK_REIMBURSE?: string;
    FEISHU_BOT_WEBHOOK_REIMBURSE_SECRET?: string;
    FEISHU_BOT_WEBHOOK_DRAWING?: string;
    FEISHU_BOT_WEBHOOK_DRAWING_SECRET?: string;
    FEISHU_BOT_WEBHOOK_HARDWARE?: string;
    FEISHU_BOT_WEBHOOK_HARDWARE_SECRET?: string;
    FEISHU_BOT_WEBHOOK_COMPLIANCE?: string;
    FEISHU_BOT_WEBHOOK_COMPLIANCE_SECRET?: string;
    /** 域名分发系统申请/释放公示（可选；未配置回退 FEISHU_BOT_WEBHOOK） */
    FEISHU_BOT_WEBHOOK_DOMAINS?: string;
    FEISHU_BOT_WEBHOOK_DOMAINS_SECRET?: string;
    /** 团队周报群机器人 webhook（可选，reports/weekly 用；未配置回退 FEISHU_BOT_WEBHOOK） */
    FEISHU_BOT_WEBHOOK_WEEKLY_REPORT?: string;
    FEISHU_BOT_WEBHOOK_WEEKLY_REPORT_SECRET?: string;
    /** 域名分发系统：Cloudflare API Token（需 Zone.DNS 编辑权限）与 Zone ID（newenergycoder.club），用 wrangler secret put 配置 */
    CF_API_TOKEN?: string;
    CF_ZONE_ID?: string;
    /** 域名分发系统：根域（默认 newenergycoder.club）与每成员域名上限（默认 3），可在 wrangler.jsonc vars 覆盖 */
    DOMAIN_ZONE?: string;
    DOMAIN_MAX_PER_USER?: string;
  }
}

export {};
