/**
 * MCP 工具清单（JSON-Schema）
 */

export const TOOLS = [
  {
    name: "deploy_app",
    description:
      "把一个 Vibe Coding 的静态应用（单页 HTML 或多文件静态站）发布到 NEC 团队中台应用广场。文件上传到团队 R2，访问路径为 /apps/<name>/。提交前必须满足：① name 匹配 ^[a-z0-9][a-z0-9-]{1,40}$（小写字母/数字/连字符，须以小写字母或数字开头，2-41 字符）；② files 必须包含入口文件 index.html，单次最多 100 个文件；③ 文本文件（HTML/CSS/JS/JSON 等）用 text 字段传 UTF-8 内容，图片/字体等二进制用 base64 字段，两者二选一；④ 文件 path 为相对路径，禁止包含 .. 或以 / 开头；⑤ 同名应用重复部署即覆盖更新，建议递增 version；⑥ 建议显式填写 title/author，便于应用广场展示。",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "应用名，即访问路径 /apps/<name>/。小写字母/数字/连字符，须以小写字母或数字开头，2-41 字符，如 inventory-check",
        },
        title: { type: "string", description: "展示名称，如 物资盘点助手；缺省用 name" },
        author: { type: "string", description: "作者（队员姓名）；缺省显示「未知」" },
        visibility: { type: "string", description: "可见范围：all 或组别名，默认 all" },
        version: { type: "string", description: "版本号，默认 0.1.0；覆盖更新时建议递增" },
        files: {
          type: "array",
          description: "静态文件列表（1-100 个），必须包含入口 index.html",
          items: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "相对路径（禁止 .. 和开头 /），如 index.html、assets/style.css",
              },
              text: { type: "string", description: "UTF-8 文本内容（与 base64 二选一）" },
              base64: { type: "string", description: "base64 内容（图片等二进制文件用）" },
            },
            required: ["path"],
          },
        },
      },
      required: ["name", "files"],
    },
  },
  {
    name: "register_app",
    description:
      "把一个已经部署在其他地方的 Web 应用（外部链接）登记到 NEC 团队应用广场。适用于已有独立域名的应用，无需上传文件。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "应用名，小写字母/数字/连字符，如 mes-warehouse" },
        title: { type: "string", description: "展示名称，如 NEC 仓库作业台" },
        author: { type: "string", description: "作者（队员姓名）" },
        url: { type: "string", description: "应用的完整外部链接，https://..." },
        visibility: { type: "string", description: "可见范围：all 或组别名，默认 all" },
        version: { type: "string", description: "版本号，默认 1.0.0" },
      },
      required: ["name", "url"],
    },
  },
  {
    name: "sync_vercel",
    description:
      "从 Vercel 团队空间自动发现项目并登记到应用广场（外链）。默认只预览差异，confirm=true 才实际写入。需在 Worker 配置 VERCEL_TOKEN。",
    inputSchema: {
      type: "object",
      properties: {
        confirm: { type: "boolean", description: "true 时实际写入注册表；缺省只预览" },
        exclude: { type: "array", items: { type: "string" }, description: "额外排除的项目名" },
        team: { type: "string", description: "Vercel 团队 slug，默认 necc" },
      },
    },
  },
  {
    name: "import_skills",
    description:
      "批量导入外部 Skill 到 Skill 中心（只登记名称/描述/链接，不托管文件）。典型用法：从团队 Gitee/GitHub 仓库批量同步。",
    inputSchema: {
      type: "object",
      properties: {
        skills: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Skill 名（会自动转为小写连字符）" },
              description: { type: "string" },
              url: { type: "string", description: "SKILL.md 的外部链接" },
              category: { type: "string", description: "分类：dev/docs/design/media/data/lark/agent/life/other；缺省自动推断" },
              tags: { type: "array", items: { type: "string" }, description: "标签，最多 8 个" },
            },
            required: ["name"],
          },
        },
        source: { type: "string", description: "来源标识，如 gitee，默认 external" },
      },
      required: ["skills"],
    },
  },
  {
    name: "remove_skills",
    description:
      "按名称批量下架 Skill。安全约束：只能删除外部登记来源（如 gitee 同步）的 Skill，中台自托管（source=hub）的不受影响。",
    inputSchema: {
      type: "object",
      properties: {
        names: { type: "array", items: { type: "string" }, description: "要下架的 Skill 名列表" },
      },
      required: ["names"],
    },
  },
  {
    name: "publish_skill",
    description: "把一个 SKILL.md 上架到 NEC 团队 Skill 中心，供其他队员一键安装到自己的 Agent。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill 名，小写连字符，如 nec-tech-report" },
        description: { type: "string", description: "一句话描述" },
        content: { type: "string", description: "SKILL.md 完整 Markdown 内容" },
        category: { type: "string", description: "分类：dev/docs/design/media/data/lark/agent/life/other；缺省自动推断" },
        tags: { type: "array", items: { type: "string" }, description: "标签，最多 8 个" },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "query_bitable",
    description:
      "只读查询飞书多维表格（队员名单/任务进度/物资台账/财务报销/赛季目标）。需先用 config_dashboard 配置 base 与 table_id，也可在调用时显式传 app_token/table_id 查询任意表格。finance 表受限：需管理端（MCP_TOKEN）或有效 user_token（角色为队长/财务）。",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "表名：members | tasks | inventory | finance" },
        filter: { type: "string", description: "可选：对整条记录做不区分大小写的包含匹配" },
        limit: { type: "number", description: "返回条数上限，默认 20，最大 100" },
        app_token: { type: "string", description: "可选：覆盖配置，直接指定多维表格 app_token" },
        table_id: { type: "string", description: "可选：覆盖配置，直接指定 table_id（tbl 开头）" },
        user_token: { type: "string", description: "可选：飞书 user_access_token；查询 finance 表时必填（角色需为队长/财务）" },
      },
      required: ["table"],
    },
  },
  {
    name: "config_dashboard",
    description:
      "配置/查看数据看板对接的飞书多维表格。action=set 写入 base（app_token）与 tables（逻辑表名→table_id），action=get 查看当前配置。写入后自动清空看板缓存。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "get（默认）| set" },
        base: { type: "string", description: "set 时必填：多维表格 app_token（URL 中 /base/ 后的一段）" },
        tables: {
          type: "object",
          description: "set 时必填：如 {\"tasks\":\"tblxxxx\",\"inventory\":\"tblxxxx\"}",
          properties: {
            members: { type: "string", description: "队员名单表 table_id" },
            tasks: { type: "string", description: "任务进度表 table_id" },
            inventory: { type: "string", description: "物资台账表 table_id" },
            finance: { type: "string", description: "财务报销表 table_id" },
            goals: { type: "string", description: "赛季目标表 table_id（FE-04 目标面板；字段：目标/关键结果/负责组/截止日期/完成度%/状态）" },
          },
        },
      },
    },
  },
  {
    name: "config_drawing_review",
    description:
      "配置/查看新增机图纸评审流程对接的飞书多维表格。action=set 写入 base（app_token）与 tables（逻辑表名→table_id），action=get 查看当前配置。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "get（默认）| set" },
        base: { type: "string", description: "set 时必填：多维表格 app_token（URL 中 /base/ 后的一段）" },
        tables: {
          type: "object",
          description: "set 时必填：如 {\"reviews\":\"tblxxxx\",\"minutes\":\"tblxxxx\"}",
          properties: {
            reviews: { type: "string", description: "图纸评审单表 table_id" },
            minutes: { type: "string", description: "会议纪要表 table_id" },
            rectifications: { type: "string", description: "整改项表 table_id" },
            bom: { type: "string", description: "BOM 清单表 table_id" },
            assessments: { type: "string", description: "评估报告表 table_id" },
            inventory: { type: "string", description: "库存查询结果表 table_id" },
            delivery: { type: "string", description: "发货清单表 table_id" },
            schedule: { type: "string", description: "排期任务表 table_id" },
            inquiries: { type: "string", description: "询价单表 table_id" },
            events: { type: "string", description: "流程事件日志表 table_id" },
          },
        },
      },
    },
  },
  {
    name: "config_hardware_review",
    description:
      "配置/查看硬件评审流程对接的飞书多维表格。action=set 写入 base（app_token）与 tables（逻辑表名→table_id），action=get 查看当前配置。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "get（默认）| set" },
        base: { type: "string", description: "set 时必填：多维表格 app_token（URL 中 /base/ 后的一段）" },
        tables: {
          type: "object",
          description: "set 时必填：如 {\"reviews\":\"tblxxxx\",\"minutes\":\"tblxxxx\"}",
          properties: {
            reviews: { type: "string", description: "硬件评审单表 table_id" },
            minutes: { type: "string", description: "会议纪要表 table_id" },
            rectifications: { type: "string", description: "整改项表 table_id" },
            reports: { type: "string", description: "评审报告表 table_id" },
            events: { type: "string", description: "流程事件日志表 table_id" },
          },
        },
      },
    },
  },
  {
    name: "config_contract_approval",
    description:
      "配置/查看合同审批流程对接的飞书多维表格。action=set 写入 base（app_token）与 tables（逻辑表名→table_id），action=get 查看当前配置。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "get（默认）| set" },
        base: { type: "string", description: "set 时必填：多维表格 app_token（URL 中 /base/ 后的一段）" },
        tables: {
          type: "object",
          description: "set 时必填：如 {\"approvals\":\"tblxxxx\",\"comments\":\"tblxxxx\"}",
          properties: {
            approvals: { type: "string", description: "合同审批单表 table_id" },
            comments: { type: "string", description: "审批评论表 table_id" },
            events: { type: "string", description: "流程事件日志表 table_id" },
          },
        },
      },
      required: ["action"],
    },
  },
  {
    name: "publish_doc",
    description:
      "发布/更新一条资料页条目（品牌规范、文档模板、制度 SOP、培训材料）。用于 Agent 提交资料更新。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "资料唯一标识，小写连字符，如 nec-vi、reimburse-sop" },
        title: { type: "string", description: "展示标题" },
        description: { type: "string", description: "一句话说明" },
        category: {
          type: "string",
          enum: ["brand", "template", "sop", "training"],
          description: "brand=品牌规范 template=文档模板 sop=制度SOP training=培训材料",
        },
        url: { type: "string", description: "链接（飞书文档、站内页面或本地下载）" },
        visibility: { type: "string", description: "可见范围：all 或组别名，默认 all" },
        maintainer: { type: "string", description: "维护人" },
      },
      required: ["id", "title", "category", "url"],
    },
  },
  {
    name: "update_progress",
    description:
      "回写赛季目标表某条记录的完成度%/状态（FE-04）。需先用 config_dashboard 配置 tables.goals。定位方式二选一：record_id 精确指定，或 goal 传目标名称/关键词模糊匹配（唯一匹配才写入，多匹配返回候选列表）。鉴权：管理端 MCP_TOKEN，或提供有效 user_token 的登录用户。回写后自动清看板缓存，门户面板 ≤1 分钟刷新。",
    inputSchema: {
      type: "object",
      properties: {
        record_id: { type: "string", description: "赛季目标表的 record_id（与 goal 二选一；可用 query_bitable table=goals 查到）" },
        goal: { type: "string", description: "目标名称或记录关键词（模糊匹配；唯一匹配才写入，多匹配返回候选 record_id 列表）" },
        progress: { type: "number", description: "完成度 0-100（与 status / note 至少填一个）" },
        status: { type: "string", description: "状态文本，如 进行中 / 已完成 / 已逾期" },
        note: { type: "string", description: "可选：进展备注，写入表内 备注/进展/说明 类文本字段（无该字段则跳过并在结果中说明）" },
        user_token: { type: "string", description: "可选：飞书 user_access_token；无 MCP_TOKEN 时必填" },
      },
    },
  },
  {
    name: "validate_bitable",
    description:
      "校验数据看板 4 张底表（队员名单/任务进度/物资台账/财务报销）的脏数据，输出按类型分组的异常清单（含多维表格记录直链与建议修复动作）。scope=mine 校验与本人相关的记录（需 user_token）；scope=all 全量校验仅队长/组长（需 user_token）或管理端 MCP_TOKEN，全量结果会覆盖门户「数据健康」展示的最新报告。规则为声明式 JSON（KV validate:rules），用 config_validate_rules 查看/更新。",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["mine", "all"], description: "mine=与本人相关（默认）｜all=全量（仅队长/组长或管理端）" },
        tables: {
          type: "array",
          items: { type: "string", enum: ["members", "tasks", "inventory", "finance"] },
          description: "可选：只校验指定表，默认 4 张全校",
        },
        user_token: { type: "string", description: "可选：飞书 user_access_token；无 MCP_TOKEN 时必填" },
      },
    },
  },
  {
    name: "config_validate_rules",
    description:
      "配置/查看数据校验规则集（FE-05，声明式 JSON 存 KV，新增规则无需改代码）。action=get 查看当前生效规则；action=set 整体替换（rules 为规则数组，字段：id/table/type/description/fieldPatterns/check/pattern/values/field2Patterns/pattern2/threshold/suggestion/enabled）；action=reset 恢复内置默认规则。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "get（默认）| set | reset" },
        rules: { type: "array", description: "set 时必填：规则数组（整体替换）", items: { type: "object" } },
      },
    },
  },
  {
    name: "schedule_meeting",
    description:
      "一键拉会：创建飞书日历日程并自动生成视频会议（vc），返回会议链接；参会人支持队员姓名（按队员名单多维表解析 open_id）或直接传 ou_ 开头的 open_id，邀请后飞书自动发日程通知。鉴权：本人拉会传 user_token；管理端（MCP_TOKEN）可传 organizer（姓名/open_id）代拉会（需该成员登录过中台）。provider 目前仅支持 feishu（默认）；腾讯会议需企业 API 凭证，暂未接入。时间无时区按 Asia/Shanghai；典型用法：「明晚 7 点拉个图纸评审会，叫上张三、李四」→ title+start+attendees。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "会议主题，如 R1 底盘图纸评审会" },
        start: {
          type: "string",
          description: "开始时间：\"2026-10-15 19:00\"（默认 +08:00）或 ISO 8601；也接受 epoch 秒/毫秒数字",
        },
        end: { type: "string", description: "结束时间（可选；缺省按 duration_minutes 推算）" },
        duration_minutes: { type: "number", description: "时长分钟数，默认 60，最小 5" },
        description: { type: "string", description: "会议描述/议程，写入日程正文" },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "参会人：队员姓名或 ou_ 开头的 open_id；姓名须在队员名单表中有 open_id",
        },
        provider: { type: "string", enum: ["feishu"], description: "会议提供方，默认 feishu" },
        user_token: { type: "string", description: "飞书 user_access_token；本人拉会必填（与 organizer 二选一）" },
        organizer: { type: "string", description: "管理端（MCP_TOKEN）专用：组织者姓名或 open_id，用其已绑定的授权代拉会" },
      },
      required: ["title", "start"],
    },
  },
  {
    name: "whoami",
    description:
      "验证当前调用者身份（接入 Prompt 自检用）。管理端（Bearer MCP_TOKEN）直接返回 admin；或传 user_token（飞书 user_access_token）返回 open_id/姓名/角色（角色按队员名单多维表实时判定并带 60s 缓存）。",
    inputSchema: {
      type: "object",
      properties: {
        user_token: { type: "string", description: "可选：飞书 user_access_token；不传且无 MCP_TOKEN 时报错" },
      },
    },
  },
  {
    name: "set_home_layout",
    description:
      "配置门户「我的首页」布局（FE-06 千人千面 / FE-07 组别默认首页）。白名单制：只允许组合预置组件（my-apps 我的应用快捷区 / my-tasks 我的任务 / my-reimburse 我的报销状态 / docs 常用资料 / goals 赛季目标 / inventory 物资查询），按 widgets 数组顺序渲染，禁止自由 HTML。action=set（默认）写入布局；action=get 查看当前生效布局（个人 > 组 > 全员默认三层回退）；action=reset 恢复默认（删个人配置）。scope=user（默认，绑定调用者本人，存 KV home:<open_id>）；scope=group 配置组别默认首页（存 home:group:<组名>，需组长/队长角色，组长只能配置本组）。鉴权：提供 user_token（飞书 user_access_token）绑定本人；管理端 MCP_TOKEN 可用 open_id 直接指定用户。典型用法：用户说「把物资查询放到最上面，加我的未完成任务」→ 解析为 widgets 数组后调用本工具。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["set", "get", "reset"], description: "set（默认）| get | reset" },
        scope: { type: "string", enum: ["user", "group"], description: "user=本人（默认）| group=组别默认首页（需组长/队长）" },
        group: { type: "string", description: "scope=group 时的组名；缺省取调用者在队员名单中的组别" },
        widgets: {
          type: "array",
          description: "set 时必填：组件数组，元素为组件 id 字符串或 {id, title?}；白名单：my-apps / my-tasks / my-reimburse / docs / goals / inventory",
          items: {
            anyOf: [
              { type: "string", enum: ["my-apps", "my-tasks", "my-reimburse", "docs", "goals", "inventory"] },
              {
                type: "object",
                properties: {
                  id: { type: "string", enum: ["my-apps", "my-tasks", "my-reimburse", "docs", "goals", "inventory"] },
                  title: { type: "string", description: "可选：覆盖组件默认标题" },
                },
                required: ["id"],
              },
            ],
          },
        },
        user_token: { type: "string", description: "飞书 user_access_token；无 MCP_TOKEN 时必填" },
        open_id: { type: "string", description: "管理端（MCP_TOKEN）专用：直接指定目标用户 open_id" },
      },
    },
  },
  {
    name: "send_notice",
    description:
      "向指定流程的飞书群发送机器人通知（需管理端 MCP_TOKEN）。webhook 未配置时返回降级说明；发送失败自动重试 2 次并记录到 notify:failed。",
    inputSchema: {
      type: "object",
      properties: {
        flow: { type: "string", description: "reimburse | drawing | hardware | compliance（决定用哪个群 webhook，未配置 fallback 主群）" },
        title: { type: "string", description: "标题" },
        content: { type: "string", description: "正文" },
        link: { type: "string", description: "可选：去处理链接" },
      },
      required: ["flow", "title", "content"],
    },
  },
  {
    name: "send_mail",
    description:
      "用飞书邮箱发信（PRD 审批与通知中心 N-02 邮件通道）。本人发信传 user_token；管理端（MCP_TOKEN）传 from（队员姓名或 ou_ 开头的 open_id，用其已绑定的授权代发，发件账号需在中台登录授权过）。text 与 html 至少一个，二者都有时用 html。发送失败时草稿保留在发件人邮箱可手动补发。",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "管理端（MCP_TOKEN）专用：发件人，队员姓名或 ou_ 开头的 open_id（姓名须在队员名单表）" },
        from_address: { type: "string", description: "可选（管理端）：显式指定发件邮箱地址（如 send_as 别名）；缺省自动取发件人主邮箱（需要邮箱读取权限）" },
        to: { type: "array", items: { type: "string" }, description: "收件人邮箱列表，至少一个" },
        cc: { type: "array", items: { type: "string" }, description: "可选：抄送邮箱列表" },
        bcc: { type: "array", items: { type: "string" }, description: "可选：密送邮箱列表" },
        subject: { type: "string", description: "邮件主题" },
        text: { type: "string", description: "纯文本正文（与 html 至少一个）" },
        html: { type: "string", description: "HTML 正文（与 text 二选一，都有时用 html）" },
        user_token: { type: "string", description: "飞书 user_access_token；本人发信必填（管理端指定 from 时忽略）" },
      },
      required: ["to", "subject"],
    },
  },
];
