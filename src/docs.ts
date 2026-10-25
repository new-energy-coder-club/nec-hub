/**
 * 资料页（KV 注册表 + 首访种子数据）
 */

import { readIndex } from "./hosting";
import { KV_KEYS } from "./shared/kv-keys";
import { resolveSession } from "./shared/session";

/** 资料页注册表 KV key */
export const DOCS_REGISTRY_KEY = KV_KEYS.docsRegistry;

/** 资料页条目（KV key: docs:registry，由 MCP publish_doc 写入） */
export interface DocEntry {
  id: string;
  title: string;
  description: string;
  /** 分类：brand=品牌规范 template=文档模板 sop=制度SOP training=培训材料 */
  category: "brand" | "template" | "sop" | "training";
  /** 为空字符串表示占位条目，前端展示「即将上线」且不可点击 */
  url: string;
  visibility: string;
  maintainer: string;
  updatedAt: string;
  source: string;
}

/** 资料页初始种子数据（首次访问且 KV 为空时写入） */
const SEED_DOCS: DocEntry[] = [
  {
    id: "nec-brand-center",
    title: "NEC 品牌主视觉中心",
    description: "Logo / PPT 模板 / VI 规范一站式下载与规范说明",
    category: "brand",
    url: "/brand/",
    visibility: "all",
    maintainer: "NEC AI 中台",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "nec-vi-manual",
    title: "NEC VI 规范手册 V1.1",
    description: "标准色值、语义色、字体系统、最小尺寸、禁用示例完整规范",
    category: "brand",
    url: "/brand/NEC-VI-Manual_V1.1.md",
    visibility: "all",
    maintainer: "NEC AI 中台",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "nec-ppt-template",
    title: "NEC PPT 标准模板",
    description: "7 种版式（封面/目录/章节/内容/图文/表格/结尾），思源黑体统一",
    category: "template",
    url: "/brand/NEC-PPT-Template_V1.0.pptx",
    visibility: "all",
    maintainer: "NEC AI 中台",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "tech-report-template",
    title: "技术方案报告模板",
    description: "项目立项/技术评审/成果总结通用报告结构（即将上线）",
    category: "template",
    url: "",
    visibility: "all",
    maintainer: "待认领",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "meeting-minutes-template",
    title: "会议纪要模板",
    description: "例会/评审会标准纪要结构，含行动项追踪（即将上线）",
    category: "template",
    url: "",
    visibility: "all",
    maintainer: "待认领",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "reimburse-sop",
    title: "财务报销流程",
    description: "线上报销助手 + 材料清单 + 审批节点说明",
    category: "sop",
    url: "/#tab-dashboard",
    visibility: "all",
    maintainer: "NEC AI 中台",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "bitable-spec-group-leaders",
    title: "多维表数据规范（组长维护手册）",
    description: "任务表/赛季目标表字段规范：列名识别、字段类型硬要求、状态词口径、接入授权与自检清单",
    category: "sop",
    url: "/docs/多维表数据规范_组长维护手册.md",
    visibility: "all",
    maintainer: "NEC AI 中台",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "dashboard-config-manual",
    title: "数据看板配置手册",
    description: "飞书多维表格接入：权限开通、应用协作者、app_token/table_id 获取、config_dashboard 配置与验证",
    category: "sop",
    url: "/docs/数据看板配置手册.md",
    visibility: "all",
    maintainer: "NEC AI 中台",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "warehouse-sop",
    title: "仓库领用规范",
    description: "物资领用/归还/盘点操作流程，配合 NEC 仓库作业台使用",
    category: "sop",
    url: "https://mes.newenergycoder.club/home.html",
    visibility: "all",
    maintainer: "NEC AI 中台",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "handover-checklist",
    title: "换届交接清单",
    description: "中台资产/账号/文档/权限交接 checklist（即将上线）",
    category: "sop",
    url: "",
    visibility: "all",
    maintainer: "待认领",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "mech-onboarding",
    title: "机械组入门教程",
    description: "机械组常用工具链、设计规范、常用元件手册（即将上线）",
    category: "training",
    url: "",
    visibility: "all",
    maintainer: "待认领",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "elec-onboarding",
    title: "电控组入门教程",
    description: "电路设计、嵌入式开发、调试工具使用指南（即将上线）",
    category: "training",
    url: "",
    visibility: "all",
    maintainer: "待认领",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
  {
    id: "vision-onboarding",
    title: "视觉组入门教程",
    description: "OpenCV/深度学习/相机标定/部署流程（即将上线）",
    category: "training",
    url: "",
    visibility: "all",
    maintainer: "待认领",
    updatedAt: new Date().toISOString(),
    source: "hub",
  },
];

export async function buildDocs(env: Env, request: Request, ctx?: ExecutionContext): Promise<unknown> {
  let docs = await readIndex<DocEntry>(env, DOCS_REGISTRY_KEY);
  if (docs.length === 0) {
    docs = SEED_DOCS;
    await env.REGISTRY.put(DOCS_REGISTRY_KEY, JSON.stringify(docs));
  } else {
    // 历史种子里的 example.feishu.cn 占位链接 → 置空 url，前端展示「即将上线」
    const cleaned = docs.map((d) => (d.url.includes("example.feishu.cn") ? { ...d, url: "" } : d));
    if (cleaned.some((d, i) => d.url !== docs[i].url)) {
      docs = cleaned;
      await env.REGISTRY.put(DOCS_REGISTRY_KEY, JSON.stringify(docs));
    }
  }
  const session = await resolveSession(env, request, ctx);
  if (!session) {
    return docs.filter((d) => d.visibility === "all");
  }
  return docs;
}
