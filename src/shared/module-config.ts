/**
 * 模块配置（KV 存储）通用读写
 *
 * 三个业务模块（drawing-review / hardware-review / contract-approval）的配置同构：
 * { base, tables, updatedAt, ... }，各存于固定 KV key。这里抽出统一的 get/set/require，
 * 各模块通过 options 保留自己的校验与缓存清理策略；KV key 不可变更（前端/MCP 工具依赖）。
 */

/** 模块配置的公共形状：多维表格 app_token + 逻辑表名 → table_id 映射 */
export interface ModuleConfigShape {
  base: string;
  tables: Record<string, string | undefined>;
  updatedAt: string;
}

export interface ModuleConfigOptions<T extends ModuleConfigShape> {
  /** KV 存储 key */
  kvKey: string;
  /** require 时未配置的错误提示 */
  requireMessage: string;
  /** set 前的 schema 校验（可选；抛错则不写入） */
  validate?: (cfg: T) => void;
  /** set 成功后需要清除的派生缓存 key（可选） */
  invalidateKeys?: string[];
}

export function createModuleConfig<T extends ModuleConfigShape>(opts: ModuleConfigOptions<T>) {
  async function get(env: Env): Promise<T | null> {
    const raw = await env.REGISTRY.get(opts.kvKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async function set(env: Env, cfg: Omit<T, "updatedAt">): Promise<T> {
    const full = { ...cfg, updatedAt: new Date().toISOString() } as T;
    opts.validate?.(full);
    await env.REGISTRY.put(opts.kvKey, JSON.stringify(full));
    for (const key of opts.invalidateKeys ?? []) {
      await env.REGISTRY.delete(key);
    }
    return full;
  }

  function require(env: Env): Promise<T> {
    return get(env).then((cfg) => {
      if (!cfg) throw new Error(opts.requireMessage);
      return cfg;
    });
  }

  return { get, set, require };
}

/** 校验 base_token / table_id 基本格式（三模块共用规则） */
export function validateModuleConfig(cfg: ModuleConfigShape): void {
  if (!/^[A-Za-z0-9]{10,}$/.test(cfg.base)) {
    throw new Error("base 不合法：应为飞书多维表格 URL 中 /base/ 后的 app_token");
  }
  for (const [name, id] of Object.entries(cfg.tables)) {
    if (id && !/^tbl[A-Za-z0-9]+$/.test(id)) {
      throw new Error(`table_id 不合法（${name}）：应以 tbl 开头`);
    }
  }
}
