# lark-cli 能力边界验证报告（FE-13）

> 日期：2026-10-14
> 环境：lark-cli 1.0.96，用户身份（DarrenPig），feishu 品牌
> 目的：验证《飞书定制工作台配置手册》中的手动步骤能否改写为 Agent 可执行的 CLI 流程

## 结论速览

| 验证项 | 结论 | 说明 |
|---|---|---|
| ③ 多维表格读写 | ✅ 完全可自动化 | 本次实测通过：建 Base、建表（含 select/datetime/number 字段）、批量写记录、删表、删 Base |
| ② 网页应用版本发布 | ⚠️ 部分可自动化 | `lark-cli application` 域只覆盖 slash command 管理；版本创建/发布无 typed 命令，可走逃生舱 `lark-cli api POST /open-apis/application/v6/applications/{app_id}/app_versions`（需 app 管理权限，未实测） |
| ① 定制工作台创建/发布/启用 | ❌ 不可自动化 | 定制工作台是管理后台（admin.feishu.cn）能力，无对应 OpenAPI，lark-cli 无此命令域。手册手动步骤必须保留 |

## 实测记录（2026-10-14，FE-02 数据基建）

以下操作均以 `--as user` 实测成功：

- `base +base-create`：创建「NEC 中台数据看板」Base（后确认为冗余，改用 10-12 已接入的正式 Base `PsXnbEG2naCGdCsMuhDcQu3bn7d`）
- `base +table-create --fields`：一次建表带全量字段（select 的 options 需为对象数组 `{"name":"机械"}`，字符串数组会报 800010701 参数校验错）
- `base +record-batch-create --json '{"fields":[...],"rows":[[...]]}'`：批量写记录（`--json` 必须是对象形态，不是数组）
- `base +table-delete --yes`、`drive +delete --file-token <base_token> --type bitable --yes`：删除表/整个 Base（删 Base 走 drive 域，进回收站可恢复）

## 对手册的修订建议

1. 《飞书定制工作台配置手册》的「定制工作台」步骤维持手动，标注「无 OpenAPI，无法 Agent 化」。
2. 多维表格相关步骤（建表、写字段、灌数据）可改写为 lark-cli 流程，本报告的实测命令可作为模板。
3. 应用版本发布如需自动化，另行验证 `lark-cli api` 逃生舱路径后再更新手册。

## 边界备注

- 免费版飞书的多维表格 API 有频次限制，批量灌数需串行 + 批次间延迟 0.5–1s（lark-base skill 规则）。
- `open_id` 按应用隔离：lark-cli 应用看到的 open_id 与中台自建应用不同，跨工具搬运成员 ID 时必须注意。
