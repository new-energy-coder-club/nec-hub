/**
 * 域名分发系统 — 类型定义
 */

/** 三级域名记录（KV key: domains:index 列表元素） */
export interface DomainEntry {
  /** 子域名前缀，如 "demo" */
  subdomain: string;
  /** 完整域名，如 "demo.newenergycoder.club" */
  fqdn: string;
  /** DNS 记录类型 */
  type: "CNAME" | "A" | "AAAA";
  /** 解析目标：CNAME 为目标主机名，A/AAAA 为 IP */
  target: string;
  /** 是否走 Cloudflare 代理（橙云）；默认 false（仅 DNS） */
  proxied: boolean;
  /** 用途说明 */
  description: string;
  owner: { name: string; open_id: string };
  /** active=已同步 Cloudflare；pending=未配置 CF 凭证等待同步；failed=同步失败 */
  status: "active" | "pending" | "failed";
  /** Cloudflare DNS record id（删除时用） */
  cfRecordId?: string;
  /** status=failed 时的错误信息 */
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDomainBody {
  subdomain?: string;
  type?: string;
  target?: string;
  description?: string;
  proxied?: boolean;
}
