// 各面板「复制给 Agent」的 Prompt 文案（逐字保留自原单文件版）
import { ORIGIN } from './api'

export const JOIN_PROMPT = `🚀 接入 NEC-MCP 智能协作中枢（v0.4.0）：

1. 安装 MCP 客户端（Claude Code / Kimi CLI / Codex）
2. 添加 NEC-MCP 服务器：
   • 地址：${ORIGIN}/mcp （streamable HTTP 协议）
   • 名称：NEC-MCP
   - Claude Code: claude mcp add --transport http NEC-MCP ${ORIGIN}/mcp
   - Kimi CLI / Codex: 在 MCP 配置中加入同一地址
3. 完成后调用 NEC-MCP 的 ping 工具验证连接，并告诉我结果

💡 提示：NEC-MCP 支持自然语言指令，可直接说"帮我部署一个应用"或"查询我的任务进度"`

export const PUBLISH_PROMPT = `请把当前项目发布到 NEC 团队应用广场：
1. 收集本项目的静态文件（入口必须是 index.html，含引用的 CSS/JS/图片）
2. 调用 NEC-MCP 的 deploy_app 工具：
   - name 用小写连字符命名（如 inventory-check）
   - title 用中文展示名，author 填我的名字
3. 成功后把访问链接发给我`

export const DOC_PUBLISH_PROMPT = `请把这条资料发布/更新到 NEC 团队资料页：
1. 调用 NEC-MCP 的 publish_doc 工具
2. 参数：
   - id：小写连字符唯一标识，如 nec-vi、reimburse-sop
   - title：展示标题
   - description：一句话说明
   - category：brand（品牌规范）/ template（文档模板）/ sop（制度 SOP）/ training（培训材料）
   - url：链接（飞书文档、站内页面或本地下载）
   - visibility：all 或组名，默认 all
   - maintainer：维护人
3. 成功后告诉我已发布到资料页`

export const HOME_PROMPT = `请按我的要求调整 NEC 中台「我的首页」布局：
1. 用 lark-cli 拿我的飞书 user_access_token（user 身份）
2. 调用 NEC-MCP 的 set_home_layout 工具：
   - action=set，scope=user（绑定我本人；user_token 必填）
   - widgets 为白名单组件 id 数组，顺序即首页渲染顺序
   - 白名单组件：my-apps 我的应用快捷区 / my-tasks 我的任务 / my-reimburse 我的报销状态 / docs 常用资料 / goals 赛季目标 / inventory 物资查询
   - 例如我说「把物资查询放到最上面，加我的未完成任务」→ widgets: ["inventory", "my-tasks", ...其余保留项]
3. 可先 action=get 查看我当前布局再增量调整；我说「恢复默认」时用 action=reset
4. 完成后告诉我刷新门户「我的首页」Tab 查看效果`

/** 赛季目标未配置时的空态引导 Prompt（与数据看板未配置引导同一模式） */
export const GOALS_CONFIG_PROMPT = `请帮我配置 NEC 中台的赛季目标表（飞书多维表格）：
1. 打开飞书多维表格，从浏览器地址栏复制 app_token 与赛季目标表的 table_id：
   URL 形如 https://xxx.feishu.cn/base/<app_token>?table=<table_id>&view=...
2. 调用 NEC-MCP 的 config_dashboard（action=set），传入 base 与 tables.goals = 赛季目标表的 table_id
3. 配置完成后刷新门户「我的首页」确认赛季目标渲染`

export const DASH_CONFIG_PROMPT = `请帮我配置 NEC 中台的数据看板（飞书多维表格）：
1. 打开飞书多维表格，从浏览器地址栏复制 app_token 与各表的 table_id：
   URL 形如 https://xxx.feishu.cn/base/<app_token>?table=<table_id>&view=...
2. 调用 NEC-MCP 的 config_dashboard（action=set），传入 base 与 tables（tasks / inventory / members / finance / goals → table_id；goals 为赛季目标表，可选）
3. 配置完成后打开门户「数据看板」Tab 确认数据渲染`
