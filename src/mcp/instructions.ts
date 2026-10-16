/**
 * MCP initialize 的 instructions 文案：按域拆常量拼接（与原硬编码长文案逐字一致）。
 */

const INTRO = "NEC-MCP — NEC 团队 AI 中台智能协作中枢。";

const APPS =
  "应用广场发布：deploy_app 上传静态文件部署（name 用小写字母/数字/连字符且以字母或数字开头，files 须含 index.html，文本用 text、二进制用 base64，同名重复部署即覆盖更新），register_app 登记外部链接应用，sync_vercel 从 Vercel 批量发现登记；";

const SKILLS = "Skill 中心：publish_skill 上架、import_skills 批量导入、remove_skills 下架；";

const DASHBOARD =
  "数据看板：config_dashboard 配置飞书多维表格（含 goals 赛季目标表），query_bitable 查询（finance 表需 user_token 且角色为队长/财务，或管理端 MCP_TOKEN），update_progress 回写赛季目标完成度/状态，validate_bitable 校验 4 张底表脏数据（scope=mine 校验自己 / scope=all 全量仅队长/组长），config_validate_rules 管理校验规则，update_inventory 物资台账手工调账（inbound/outbound/adjust，仅管理端，硬件审批 arrive/issue 已自动联动台账）；";

const BITABLE_SETUP = "数据基建：setup_bitable 一键建标准四表，add_records 批量追加记录（均仅管理端）；";

const HOME_LAYOUT =
  "首页布局：set_home_layout 配置「我的首页」（白名单组件 my-apps/my-tasks/my-reimburse/docs/goals/inventory，scope=user 绑本人、scope=group 组默认需组长/队长，action=get 查看 / set 写入 / reset 恢复默认）；";

const MEETING =
  "一键拉会：schedule_meeting 创建飞书日历日程+视频会议（attendees 传姓名或 ou_ open_id，本人拉会传 user_token，管理端可 organizer 代拉会）；";

const APPROVALS =
  "审批与通知（Plan B）：submit_approval 代发起审批、list_todos 按 open_id 查待办、send_notice 发群通知（channel=bot 群机器人 / mail 邮件 / both 双通道，webhook 未配置会返回降级说明）、config_flows 配置审批流程（状态机落多维表格 + 群机器人 webhook 通知）；";

const MAIL =
  "发邮件：send_mail 用飞书邮箱发信（本人传 user_token；管理端传 from 用队员授权代发，收件人 to 必填、text/html 至少一个）；";

const PRD = "PRD 看板：update_prd 更新需求状态（状态变化推飞书群）；";

const DOCS = "资料页：publish_doc 上架、remove_docs 下架；";

const DOMAINS =
  "域名分发：apply_domain 代申请三级域名、release_domain 释放（均仅管理端，申请/释放推飞书群公示；R2 托管应用自带 <name>.newenergycoder.club 直达域名无需申请）。";

const OUTRO = "支持自然语言指令，如「把我的应用发布到应用广场」「明晚 7 点拉个评审会叫上张三」。";

export const SERVER_INSTRUCTIONS = [
  INTRO,
  APPS,
  SKILLS,
  DASHBOARD,
  BITABLE_SETUP,
  HOME_LAYOUT,
  MEETING,
  APPROVALS,
  MAIL,
  PRD,
  DOCS,
  DOMAINS,
  OUTRO,
].join("");
