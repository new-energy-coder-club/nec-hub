# 图纸评审系统 - API 参考手册
## 基础联想功能完整 API 文档

**版本**: v1.0  
**更新日期**: 2026-10-14  
**API 版本**: v1.0  

---

## 📋 API 概览

### 基础信息
- **Base URL**: `https://your-domain.com/api/drawing-review`
- **认证方式**: 飞书 OAuth 2.0 / API Key
- **数据格式**: JSON
- **字符编码**: UTF-8
- **请求方式**: GET, POST, PUT, DELETE

### 通用响应格式
```json
{
  "ok": true,
  "data": {},
  "error": null,
  "timestamp": "2026-10-14T10:30:00Z",
  "requestId": "req-123456"
}
```

### 错误响应格式
```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "参数验证失败",
    "details": {}
  },
  "timestamp": "2026-10-14T10:30:00Z",
  "requestId": "req-123456"
}
```

---

## 🔍 联想功能 API

### 1. 获取联想建议

**端点**: `GET /api/drawing-review/suggestions`

**描述**: 获取基于查询关键词的智能联想建议

**请求参数**:

| 参数名 | 类型 | 必填 | 描述 | 示例 |
|--------|------|------|------|------|
| q | string | 是 | 查询关键词 | "PRJ" |
| type | string | 否 | 联想类型 | "project" \| "machine" \| "all" |
| projectId | string | 否 | 项目编号上下文 | "PRJ-001" |
| machineName | string | 否 | 机型名称上下文 | "R1底盘" |
| limit | number | 否 | 返回数量限制 | 10 |
| offset | number | 否 | 偏移量 | 0 |

**请求示例**:
```bash
curl -X GET "https://your-domain.com/api/drawing-review/suggestions?q=PRJ&type=project&limit=5" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

**响应示例**:
```json
{
  "ok": true,
  "data": {
    "suggestions": [
      {
        "type": "project",
        "value": "PRJ-001",
        "label": "项目: PRJ-001",
        "count": 15,
        "recent": true
      },
      {
        "type": "project",
        "value": "PRJ-002", 
        "label": "项目: PRJ-002",
        "count": 8,
        "recent": false
      }
    ],
    "query": "PRJ",
    "type": "project",
    "total": 2,
    "hasMore": false
  },
  "error": null,
  "timestamp": "2026-10-14T10:30:00Z",
  "requestId": "req-123456"
}
```

**错误码**:
- `400`: 参数错误
- `401`: 未授权
- `403`: 权限不足
- `500`: 服务器内部错误

---

### 2. 获取基于任务的联想

**端点**: `GET /api/drawing-review/{reviewId}/task-suggestions`

**描述**: 获取基于特定评审单的智能联想建议

**路径参数**:

| 参数名 | 类型 | 必填 | 描述 | 示例 |
|--------|------|------|------|------|
| reviewId | string | 是 | 评审单 ID | "DR-001" |

**请求示例**:
```bash
curl -X GET "https://your-domain.com/api/drawing-review/DR-001/task-suggestions" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

**响应示例**:
```json
{
  "ok": true,
  "data": {
    "reviewId": "DR-001",
    "suggestions": [
      {
        "type": "machine",
        "value": "R2底盘",
        "label": "相关机型: R2底盘 (V1.1)",
        "recent": true,
        "confidence": 0.95
      },
      {
        "type": "project",
        "value": "PRJ-002",
        "label": "历史项目: PRJ-002 (R4底盘)",
        "recent": true,
        "confidence": 0.87
      }
    ],
    "total": 2,
    "context": {
      "projectId": "PRJ-001",
      "machineName": "R1底盘",
      "designerId": "user-123"
    }
  },
  "error": null,
  "timestamp": "2026-10-14T10:30:00Z",
  "requestId": "req-123456"
}
```

**错误码**:
- `404`: 评审单不存在
- `401`: 未授权
- `403`: 权限不足
- `500`: 服务器内部错误

---

### 3. 获取表单默认值

**端点**: `GET /api/drawing-review/start`

**描述**: 获取表单填写的智能默认值

**请求示例**:
```bash
curl -X GET "https://your-domain.com/api/drawing-review/start" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

**响应示例**:
```json
{
  "ok": true,
  "data": {
    "defaults": {
      "projectId": "PRJ-001",
      "machineName": "R1底盘",
      "drawingVersion": "V1.1",
      "designerId": "user-123",
      "designNotes": "【设计说明模板】\n\n1. 设计背景与目标：\n2. 关键技术参数：\n3. 主要变更点：\n4. 特殊要求与注意事项：\n5. 相关参考文件：\n"
    },
    "userPreferences": {
      "defaultProjectId": "PRJ-001",
      "defaultMachineName": "R1底盘",
      "lastUsedVersion": "V1.0",
      "preferredTemplate": "v1"
    },
    "timestamp": "2026-10-14T10:30:00Z"
  },
  "error": null,
  "timestamp": "2026-10-14T10:30:00Z",
  "requestId": "req-123456"
}
```

**错误码**:
- `401`: 未授权
- `403`: 权限不足
- `500`: 服务器内部错误

---

## 📝 评审单管理 API

### 1. 提交评审单

**端点**: `POST /api/drawing-review/submit`

**描述**: 提交新的图纸评审单

**请求体**:
```json
{
  "projectId": "PRJ-001",
  "machineName": "R1底盘",
  "drawingVersion": "V1.0",
  "designerId": "user-123",
  "drawingFiles": [
    {
      "name": "底盘图纸.pdf",
      "token": "file-token-123",
      "size": 1024000
    }
  ],
  "designNotes": "关键设计参数、变更点"
}
```

**请求示例**:
```bash
curl -X POST "https://your-domain.com/api/drawing-review/submit" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "PRJ-001",
    "machineName": "R1底盘",
    "drawingVersion": "V1.0",
    "designerId": "user-123",
    "drawingFiles": [{"name": "底盘图纸.pdf", "token": "file-token-123"}],
    "designNotes": "关键设计参数、变更点"
  }'
```

**响应示例**:
```json
{
  "ok": true,
  "data": {
    "reviewId": "DR-20261014-001",
    "projectId": "PRJ-001",
    "machineName": "R1底盘",
    "drawingVersion": "V1.0",
    "designerId": "user-123",
    "status": "pending_review",
    "createdAt": "2026-10-14T10:30:00Z",
    "updatedAt": "2026-10-14T10:30:00Z"
  },
  "error": null,
  "timestamp": "2026-10-14T10:30:00Z",
  "requestId": "req-123456"
}
```

**错误码**:
- `400`: 参数验证失败
- `401`: 未授权
- `403`: 权限不足
- `409`: 评审单已存在
- `500`: 服务器内部错误

---

### 2. 获取评审单列表

**端点**: `GET /api/drawing-review`

**描述**: 获取评审单列表

**请求参数**:

| 参数名 | 类型 | 必填 | 描述 | 示例 |
|--------|------|------|------|------|
| status | string | 否 | 状态筛选 | "pending_review" |
| projectId | string | 否 | 项目编号筛选 | "PRJ-001" |
| designerId | string | 否 | 设计师筛选 | "user-123" |
| limit | number | 否 | 返回数量限制 | 20 |
| offset | number | 否 | 偏移量 | 0 |

**请求示例**:
```bash
curl -X GET "https://your-domain.com/api/drawing-review?status=pending_review&limit=10" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

**响应示例**:
```json
{
  "ok": true,
  "data": {
    "reviews": [
      {
        "reviewId": "DR-20261014-001",
        "projectId": "PRJ-001",
        "machineName": "R1底盘",
        "drawingVersion": "V1.0",
        "designerId": "user-123",
        "status": "pending_review",
        "createdAt": "2026-10-14T10:30:00Z",
        "updatedAt": "2026-10-14T10:30:00Z"
      }
    ],
    "total": 1,
    "hasMore": false,
    "filters": {
      "status": "pending_review",
      "limit": 10,
      "offset": 0
    }
  },
  "error": null,
  "timestamp": "2026-10-14T10:30:00Z",
  "requestId": "req-123456"
}
```

---

### 3. 获取评审单详情

**端点**: `GET /api/drawing-review/{reviewId}`

**描述**: 获取特定评审单的详细信息

**路径参数**:

| 参数名 | 类型 | 必填 | 描述 | 示例 |
|--------|------|------|------|------|
| reviewId | string | 是 | 评审单 ID | "DR-20261014-001" |

**请求示例**:
```bash
curl -X GET "https://your-domain.com/api/drawing-review/DR-20261014-001" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

**响应示例**:
```json
{
  "ok": true,
  "data": {
    "reviewId": "DR-20261014-001",
    "projectId": "PRJ-001",
    "machineName": "R1底盘",
    "drawingVersion": "V1.0",
    "designerId": "user-123",
    "drawingFiles": [
      {
        "name": "底盘图纸.pdf",
        "token": "file-token-123",
        "size": 1024000
      }
    ],
    "designNotes": "关键设计参数、变更点",
    "status": "pending_review",
    "meetingId": null,
    "meetingLink": null,
    "meetingStartTime": null,
    "conclusion": null,
    "conclusionNotes": null,
    "createdAt": "2026-10-14T10:30:00Z",
    "updatedAt": "2026-10-14T10:30:00Z"
  },
  "error": null,
  "timestamp": "2026-10-14T10:30:00Z",
  "requestId": "req-123456"
}
```

---

## 🔧 系统管理 API

### 1. 健康检查

**端点**: `GET /api/health`

**描述**: 检查系统健康状态

**请求示例**:
```bash
curl -X GET "https://your-domain.com/api/health"
```

**响应示例**:
```json
{
  "ok": true,
  "data": {
    "status": "healthy",
    "timestamp": "2026-10-14T10:30:00Z",
    "version": "1.0.0",
    "uptime": 86400,
    "checks": {
      "database": "healthy",
      "cache": "healthy",
      "external_api": "healthy",
      "suggestion_service": "healthy"
    }
  },
  "error": null,
  "timestamp": "2026-10-14T10:30:00Z",
  "requestId": "req-123456"
}
```

---

### 2. 配置管理

**端点**: `POST /api/drawing-review/config`

**描述**: 配置图纸评审系统参数

**请求体**:
```json
{
  "action": "set",
  "base": "your-base-token",
  "tables": {
    "reviews": "tbl-reviews",
    "minutes": "tbl-minutes",
    "rectifications": "tbl-rectifications",
    "bom": "tbl-bom",
    "assessments": "tbl-assessments",
    "inventory": "tbl-inventory",
    "delivery": "tbl-delivery",
    "schedule": "tbl-schedule",
    "inquiries": "tbl-inquiries",
    "events": "tbl-events"
  }
}
```

**请求示例**:
```bash
curl -X POST "https://your-domain.com/api/drawing-review/config" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "set",
    "base": "your-base-token",
    "tables": {
      "reviews": "tbl-reviews",
      "minutes": "tbl-minutes"
    }
  }'
```

**响应示例**:
```json
{
  "ok": true,
  "data": {
    "configured": true,
    "base": "your-base-token",
    "tables": {
      "reviews": "tbl-reviews",
      "minutes": "tbl-minutes"
    },
    "updatedAt": "2026-10-14T10:30:00Z"
  },
  "error": null,
  "timestamp": "2026-10-14T10:30:00Z",
  "requestId": "req-123456"
}
```

---

## 📊 错误码参考

### HTTP 状态码

| 状态码 | 描述 | 说明 |
|--------|------|------|
| 200 | OK | 请求成功 |
| 400 | Bad Request | 请求参数错误 |
| 401 | Unauthorized | 未授权访问 |
| 403 | Forbidden | 权限不足 |
| 404 | Not Found | 资源不存在 |
| 409 | Conflict | 资源冲突 |
| 429 | Too Many Requests | 请求过于频繁 |
| 500 | Internal Server Error | 服务器内部错误 |
| 503 | Service Unavailable | 服务不可用 |

### 业务错误码

| 错误码 | 描述 | 说明 |
|--------|------|------|
| VALIDATION_ERROR | 参数验证失败 | 请求参数不符合要求 |
| SUGGESTION_ERROR | 联想服务错误 | 联想功能执行失败 |
| REVIEW_NOT_FOUND | 评审单不存在 | 指定的评审单 ID 不存在 |
| PERMISSION_DENIED | 权限不足 | 用户没有执行该操作的权限 |
| DATABASE_ERROR | 数据库错误 | 数据库操作失败 |
| CACHE_ERROR | 缓存错误 | 缓存操作失败 |
| EXTERNAL_API_ERROR | 外部 API 错误 | 外部服务调用失败 |

---

## 🔐 认证和授权

### 认证方式

**1. 飞书 OAuth 2.0**
```bash
# 获取访问令牌
curl -X POST "https://open.feishu.cn/open-apis/authen/v1/access_token" \
  -H "Content-Type: application/json" \
  -d '{
    "app_id": "your-app-id",
    "app_secret": "your-app-secret",
    "code": "authorization-code"
  }'
```

**2. API Key**
```bash
# 使用 API Key
curl -X GET "https://your-domain.com/api/drawing-review/suggestions?q=test" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### 权限控制

**角色权限**:
- **普通用户**: 查看和提交评审单
- **设计师**: 查看和编辑自己的评审单
- **项目经理**: 查看和管理所有评审单
- **系统管理员**: 完整系统管理权限

---

## 📈 性能指标

### 响应时间
- **联想 API**: < 100ms
- **评审单 API**: < 200ms
- **系统 API**: < 50ms

### 并发处理
- **最大并发**: 1000 请求/秒
- **队列长度**: 10000 请求
- **超时时间**: 30 秒

### 可用性
- **系统可用性**: > 99.9%
- **数据一致性**: > 99.99%
- **错误率**: < 0.1%

---

## 📞 技术支持

### API 支持
- **技术支持**: api-support@newenergycoder.club
- **文档问题**: docs@newenergycoder.club
- **Bug 报告**: 通过 GitHub Issues 提交

### 社区支持
- **开发者社区**: https://community.newenergycoder.club
- **技术讨论**: 团队内部技术分享会
- **在线帮助**: 系统内「帮助与反馈」

---

**这份 API 参考手册提供了图纸评审系统基础联想功能的完整 API 文档。我们将持续更新和完善 API 文档，确保开发者能够快速集成和使用系统功能。** 🚀
