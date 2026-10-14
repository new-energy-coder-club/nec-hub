# 新增机图纸评审流程 — 方案 C 混合架构设计

> 版本：v1.0  
> 日期：2026-10-14  
> 关联 PRD：`docs/新增机图纸评审流程_PRD.md`  
> 关联设计：`docs/新增机图纸评审流程_设计文档.md`

---

## 1. 方案 C 定义

**飞书 Base 作为数据/看板层**：
- 所有业务数据（评审单、会议纪要、BOM、评估报告、发货清单、询价单、排期任务）持久化存储在飞书多维表格；
- 利用 Base 的视图、权限、仪表盘原生能力实现看板；
- 利用 Base 的自动化/Workflow 实现简单通知。

**nec-hub（Cloudflare Workers）作为流程编排与集成层**：
- 接收图纸提交、驱动状态机；
- 调用腾讯会议 API、ERP/MES/日历接口；
- 提供 RESTful API 给前端/飞书应用；
- 通过 MCP 工具暴露给 Agent；
- 复杂计算（BOM 拆分、库存匹配、排期计算）在 Worker 中完成，结果写回 Base。

---

## 2. 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│ 用户入口                                                      │
│ 飞书工作台 / 门户网页 / Agent (MCP)                           │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ nec-hub Worker                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ REST API 层                                             │  │
│  │ /api/drawing-review/submit                             │  │
│  │ /api/drawing-review/:id                                │  │
│  │ /api/drawing-review/:id/minutes                      │  │
│  │ /api/drawing-review/:id/conclusion                   │  │
│  │ /api/drawing-review/:id/bom                          │  │
│  │ /api/drawing-review/:id/assessments                  │  │
│  │ /api/drawing-review/:id/delivery                     │  │
│  │ /api/drawing-review/:id/schedule                     │  │
│  │ /api/drawing-review/:id/inquiries                    │  │
│  │ /api/drawing-review/dashboard                        │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 流程编排层                                              │  │
│  │ ReviewFlowService（状态机）                             │  │
│  │ MeetingService（腾讯会议）                              │  │
│  │ BOMService（BOM 拆分/加工件识别）                       │  │
│  │ AssessmentService（评估报告校验）                       │  │
│  │ InventoryService（库存/MES 拉取）                       │  │
│  │ ScheduleService（成员日历+排期）                        │  │
│  │ ProcurementService（三家询价）                          │  │
│  │ NotificationService（飞书消息/邮件）                    │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 数据适配层（Feishu Base Adapter）                       │  │
│  │ 统一封装 Base 记录 CRUD、字段映射、缓存                 │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 数据层 — 飞书 Base「新增机图纸评审流程」                     │
│  图纸评审单 / 会议纪要 / 整改项 / BOM清单 / 评估报告          │
│  库存结果 / 发货清单 / 排期任务 / 询价单 / 事件日志           │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 外部集成                                                      │
│ 腾讯会议 / ERP / MES / WMS / 日历 / 飞书消息                  │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. 数据分层策略

### 3.1 为什么用 Base 做主数据层

| 考虑点 | 说明 |
|--------|------|
| 团队熟悉度 | 已在使用飞书 Base 做项目管理、库存管理 |
| 快速搭建 | 无需额外数据库，表结构可视化配置 |
| 看板能力 | Base 仪表盘、视图可直接作为流程看板 |
| 权限控制 | 高级权限可按角色控制字段/记录可见性 |
| 协作 | 人工补录、调整方便 |

### 3.2 nec-hub 负责什么

| 职责 | 说明 |
|------|------|
| 流程编排 | 状态机、事件触发、条件分支 |
| 外部集成 | 腾讯会议、ERP、MES、日历等 API 调用 |
| 复杂计算 | BOM 层级拆分、加工件识别、库存匹配、排期算法 |
| 权限网关 | 校验登录态与角色，控制写操作 |
| 缓存 | 减少对 Base 的频繁读取 |
| MCP 暴露 | 让 Agent 能查询/操作流程 |

### 3.3 不推荐把运行时状态放 Worker KV

- 业务主数据在 Base，保证可追溯；
- KV 仅用于：token 缓存、会话、看板缓存、配置；
- 不用于存储评审单/BOM 等结构化业务数据（避免双写不一致）。

---

## 4. 接口契约（REST API）

### 4.1 评审单

```
POST   /api/drawing-review/submit          提交图纸报告书
GET    /api/drawing-review/:id             获取评审单详情
POST   /api/drawing-review/:id/meeting     手动预约/重新预约会议
POST   /api/drawing-review/:id/minutes     保存会议纪要
POST   /api/drawing-review/:id/conclusion  提交评审结论
POST   /api/drawing-review/:id/rectify     整改完成确认
GET    /api/drawing-review                 列表（支持 status/project/machine 筛选）
```

### 4.2 BOM

```
POST   /api/drawing-review/:id/bom/generate    生成 BOM
GET    /api/drawing-review/:id/bom             获取 BOM
POST   /api/drawing-review/:id/bom/confirm     确认 BOM
GET    /api/drawing-review/:id/bom/machining   获取机械加工件 BOM
```

### 4.3 评估

```
POST   /api/drawing-review/:id/assessments/electrical  提交电控评估
POST   /api/drawing-review/:id/assessments/wiring      提交布线评估
GET    /api/drawing-review/:id/assessments             获取评估列表
```

### 4.4 库存与发货

```
POST   /api/drawing-review/:id/inventory/pull      拉取库存/MES
GET    /api/drawing-review/:id/inventory           获取库存结果
POST   /api/drawing-review/:id/delivery/generate   生成发货清单
GET    /api/drawing-review/:id/delivery            获取发货清单
```

### 4.5 排期与采购

```
POST   /api/drawing-review/:id/schedule/generate   生成排期
GET    /api/drawing-review/:id/schedule            获取排期
POST   /api/drawing-review/:id/procurement/start   启动采购/询价
GET    /api/drawing-review/:id/inquiries           获取询价单
```

### 4.6 看板

```
GET    /api/drawing-review/dashboard?groupBy=status   流程看板聚合
GET    /api/drawing-review/my-todo                    我的待办
```

---

## 5. 模块划分与目录结构

```
src/
├── index.ts                              # 路由总入口
├── drawing-review/
│   ├── index.ts                          # 模块路由注册
│   ├── types.ts                          # 类型定义
│   ├── config.ts                         # Base 表名/字段配置
│   ├── adapter.ts                        # Base 读写适配器
│   ├── flow.service.ts                   # 主流程编排服务
│   ├── meeting.service.ts                # 腾讯会议集成
│   ├── bom.service.ts                    # BOM 生成与拆分
│   ├── assessment.service.ts             # 电控/布线评估
│   ├── inventory.service.ts              # 库存/MES 拉取
│   ├── schedule.service.ts               # 排期计算
│   ├── procurement.service.ts            # 采购三家询价
│   ├── notification.service.ts           # 消息通知
│   └── dashboard.service.ts              # 看板聚合
├── feishu/
│   ├── auth.ts                           # 已有：token/会话
│   ├── bitable.ts                        # 已有：listBitableRecords 等
│   └── meeting.ts                        # 新增：腾讯会议 API
└── utils.ts                              # 已有/新增工具函数
```

---

## 6. Base 配置方式

### 6.1 在 KV 中存储 Base 配置

新增 KV key：`drawing-review:config`

```json
{
  "base": "BASE_APP_TOKEN",
  "tables": {
    "reviews": "tblxxx",
    "minutes": "tblxxx",
    "rectifications": "tblxxx",
    "bom": "tblxxx",
    "assessments": "tblxxx",
    "inventory": "tblxxx",
    "delivery": "tblxxx",
    "schedule": "tblxxx",
    "inquiries": "tblxxx",
    "events": "tblxxx"
  },
  "updatedAt": "2026-10-14T..."
}
```

### 6.2 通过 MCP 暴露配置工具

新增 MCP tool：`config_drawing_review`

```json
{
  "name": "config_drawing_review",
  "inputSchema": {
    "properties": {
      "action": { "type": "string", "enum": ["get", "set"] },
      "base": { "type": "string" },
      "tables": { "type": "object" }
    }
  }
}
```

---

## 7. 状态机在 Worker 中的实现

### 7.1 状态定义

```typescript
export type ReviewStatus =
  | 'draft'           // 待提交
  | 'pending_review'  // 待评审
  | 'in_review'       // 评审中
  | 'rectifying'      // 待整改
  | 'bom_generating'  // BOM生成中
  | 'assessing'       // 评估中
  | 'scheduling'      // 排期中
  | 'procuring'       // 采购中
  | 'archived';       // 已归档
```

### 7.2 状态转换函数

```typescript
const TRANSITIONS: Record<ReviewStatus, Partial<Record<string, ReviewStatus>>> = {
  draft: { submit: 'pending_review' },
  pending_review: { start_meeting: 'in_review' },
  in_review: {
    conclude_passed: 'bom_generating',
    conclude_conditional: 'rectifying',
    conclude_rejected: 'draft',
  },
  rectifying: {
    complete: 'bom_generating',
    re_review: 'pending_review',
  },
  bom_generating: { generated: 'assessing' },
  assessing: {
    pass: 'scheduling',
    fail: 'draft',
  },
  scheduling: { confirm: 'procuring' },
  procuring: { complete: 'archived' },
  archived: {},
};
```

### 7.3 幂等性保证

- 每次状态变更先读当前状态；
- 仅当当前状态在允许转换表中时才执行；
- 写入 Base 前校验乐观锁（基于 `updatedAt` 或 Base 的 `revision`）。

---

## 8. 首期 MVP 范围（建议 2 周内完成）

### 8.1 目标
让团队能在飞书中完成「图纸提交 → 自动预约会议 → 保存纪要 → 评审结论 → BOM 生成」的闭环。

### 8.2 必须完成的表

1. 图纸评审单
2. 会议纪要
3. 整改项
4. BOM 清单

### 8.3 必须完成的接口

1. `POST /api/drawing-review/submit`
2. `POST /api/drawing-review/:id/meeting`（自动预约腾讯会议）
3. `POST /api/drawing-review/:id/minutes`
4. `POST /api/drawing-review/:id/conclusion`
5. `POST /api/drawing-review/:id/bom/generate`

### 8.4 必须完成的页面

1. 图纸提交页（H5/飞书应用）
2. 评审单详情页（含纪要、BOM、状态流转按钮）
3. 流程看板页（按状态分组）

### 8.5 不纳入首期

- 电控/布线评估（二期）
- 库存/MES 拉取（二期）
- 发货清单（三期）
- 成员排期（三期）
- 三家询价单（三期）

---

## 9. 实施步骤

### Step 1：创建飞书 Base（需人工/CLI）

1. 在飞书创建 Base「新增机图纸评审流程」；
2. 按设计文档创建 4 张首期表（评审单、纪要、整改项、BOM）；
3. 获取 base_token 和各 table_id；
4. 通过 MCP `config_drawing_review` 写入 nec-hub。

### Step 2：后端代码开发

1. 创建 `src/drawing-review/` 目录结构；
2. 实现 Base 配置读取与适配器；
3. 实现状态机与流程服务；
4. 实现腾讯会议预约服务；
5. 实现 BOM 生成服务（首期支持手动录入/模板导入，自动解析为二期）；
6. 在 `src/index.ts` 注册路由。

### Step 3：前端/飞书应用开发

1. 使用 `deploy_app` 部署静态 H5 页面；
2. 页面调用 nec-hub API；
3. 集成飞书 JSAPI 获取用户信息。

### Step 4：测试与上线

1. 用一张真实图纸走通 MVP 流程；
2. 邀请机械组试用；
3. 收集反馈，进入二期。

---

## 10. 需要用户确认的事项

1. **是否现在创建飞书 Base？** 这是实施的第一步，需要管理员权限或我来通过 lark-cli 创建。
2. **腾讯会议 API 权限是否已开通？** 否则自动预约会降级为手动。
3. **首期 BOM 生成方式**：先支持手动录入/Excel 导入，还是等 CAD 解析？
4. **是否需要我马上开始写后端代码骨架？**
