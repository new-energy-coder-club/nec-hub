/**
 * 飞书多维表格 CRUD 适配器基类 — drawing-review / hardware-review / contract-approval 共用骨架
 *
 * 子类只保留各自的字段映射与业务方法；「未配置某表」的错误文案按模块名参数化，逐字不变。
 */

import {
  BitableRecord,
  createBitableRecord,
  getBitableRecord,
  getTenantAccessToken,
  listBitableRecords,
  queryBitableRecords,
  updateBitableRecord,
  type BitableCondition,
} from "../feishu/bitable";

/** 通用表适配器接口（原 drawing-review/adapter.ts 定义；此处为唯一定义） */
export interface TableAdapter<T> {
  list(): Promise<T[]>;
  get(recordId: string): Promise<T | null>;
  create(item: Omit<T, "recordId" | "id">): Promise<T>;
  update(recordId: string, item: Partial<T>): Promise<T>;
}

export interface FeishuTableConfig {
  base: string;
  tables: Record<string, string | undefined>;
}

export abstract class FeishuTableAdapter<
  Cfg extends FeishuTableConfig,
  TableName extends string,
> {
  constructor(
    protected env: Env,
    protected cfg: Cfg,
    /** 模块显示名（未配置表的错误文案用），如「新增机图纸评审流程」 */
    private moduleLabel: string,
  ) {}

  protected async token(): Promise<string> {
    return getTenantAccessToken(this.env);
  }

  protected tableId(name: TableName): string {
    const id = this.cfg.tables[name];
    if (!id) throw new Error(`${this.moduleLabel}未配置 ${name} 表`);
    return id;
  }

  async listRecords(table: TableName): Promise<BitableRecord[]> {
    const token = await this.token();
    return listBitableRecords(token, this.cfg.base, this.tableId(table));
  }

  /** 按 record_id 读单条（GET /records/:record_id）；不存在返回 null */
  async getRecord(table: TableName, recordId: string): Promise<BitableRecord | null> {
    const token = await this.token();
    return getBitableRecord(token, this.cfg.base, this.tableId(table), recordId);
  }

  /** filter 下推查询（search 接口）；search 失败/查空可回退全表扫描 + match 内存过滤（见 queryBitableRecords） */
  async queryRecords(
    table: TableName,
    conditions: BitableCondition[],
    match: (record: BitableRecord, records: BitableRecord[]) => boolean,
    opts?: { conjunction?: "and" | "or"; max?: number; scanMax?: number; fallbackOnEmpty?: boolean },
  ): Promise<BitableRecord[]> {
    const token = await this.token();
    return queryBitableRecords(token, this.cfg.base, this.tableId(table), conditions, match, opts);
  }

  async createRecord(table: TableName, fields: Record<string, unknown>): Promise<BitableRecord> {
    const token = await this.token();
    return createBitableRecord(token, this.cfg.base, this.tableId(table), fields);
  }

  async updateRecord(table: TableName, recordId: string, fields: Record<string, unknown>): Promise<BitableRecord> {
    const token = await this.token();
    return updateBitableRecord(token, this.cfg.base, this.tableId(table), recordId, fields);
  }
}
