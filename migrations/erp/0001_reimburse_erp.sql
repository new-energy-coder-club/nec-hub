-- R-01 报销助手 ERP 化：费用项目目录 / 队员收款账户 / 报销单据快照
-- 附件实体存 R2（receipts/ 前缀），本库只存结构化数据

-- 费用项目目录（picker 数据源；grp=分类，code 形如 F38.01）
CREATE TABLE IF NOT EXISTS expense_items (
  code TEXT PRIMARY KEY,
  grp TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

-- 队员收款账户（每人一条默认，提交单时随单据快照冗余存一份）
CREATE TABLE IF NOT EXISTS payees (
  open_id TEXT PRIMARY KEY,
  method TEXT NOT NULL DEFAULT '',
  account_name TEXT NOT NULL DEFAULT '',
  account_no TEXT NOT NULL DEFAULT '',
  bank TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

-- 报销单据快照（ERP 风格整单：表头 + 明细行 + 收款 + 附件 R2 keys）
-- 状态与审批引擎底表保持一致（审批中/已通过/已驳回/已打款…），由应用页定时或手动对齐
CREATE TABLE IF NOT EXISTS reimburse_docs (
  application_id TEXT PRIMARY KEY,
  open_id TEXT NOT NULL,
  applicant TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '审批中',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reimburse_docs_owner ON reimburse_docs (open_id, created_at DESC);

-- 初始费用项目目录（参照 ERP 费用项目树 + NEC 场景）
INSERT OR IGNORE INTO expense_items (code, grp, name) VALUES
  ('F38.01', '研发费用支出', '材料费'),
  ('F38.02', '研发费用支出', '差旅费'),
  ('F38.03', '研发费用支出', '招待费'),
  ('F38.04', '研发费用支出', '检测费'),
  ('F38.05', '研发费用支出', '认证费'),
  ('F38.06', '研发费用支出', '服务费'),
  ('F39.01', '生产加工', '打样费'),
  ('F39.02', '生产加工', '外协加工费'),
  ('F39.03', '生产加工', '模具费'),
  ('F40.01', '物料采购', '元器件'),
  ('F40.02', '物料采购', '结构件'),
  ('F40.03', '物料采购', '工具耗材'),
  ('F41.01', '运营办公', '办公用品'),
  ('F41.02', '运营办公', '快递运费'),
  ('F41.03', '运营办公', '宣传物料'),
  ('F41.04', '运营办公', '团建活动'),
  ('F99.01', '其他', '其他费用');
