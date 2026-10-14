/**
 * mcp/module-config-tools 工厂单元测试：三个模块配置工具的文案逐字等价（含硬件评审 get 文案结尾空格）、
 * base/table_id 校验、错误提示、动态 load 懒加载。
 */
import { describe, expect, it } from "vitest";
import {
  createModuleConfigTool,
  toolConfigContractApproval,
  toolConfigDrawingReview,
  toolConfigHardwareReview,
} from "../mcp/module-config-tools";

interface Cfg {
  base: string;
  tables: Record<string, string | undefined>;
  updatedAt: string;
}

function makeEnv(kv = new Map<string, string>()): Env {
  return {
    REGISTRY: {
      get: async (key: string) => kv.get(key) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    },
  } as unknown as Env;
}

/** 用内存 KV 构造一个假模块配置读写对（形状同各模块 config.ts） */
function fakeModule(kv: Map<string, string>, key: string) {
  return async () => ({
    get: async () => {
      const raw = kv.get(key);
      return raw ? (JSON.parse(raw) as Cfg) : null;
    },
    set: async (_env: Env, cfg: { base: string; tables: Record<string, string> }) => {
      const full: Cfg = { ...cfg, updatedAt: "2026-01-01T00:00:00.000Z" };
      kv.set(key, JSON.stringify(full));
      return full;
    },
  });
}

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0].text;
}

describe("module-config-tools 工厂", () => {
  it("get 未配置 → 统一提示文案", async () => {
    const kv = new Map<string, string>();
    const tool = createModuleConfigTool({
      label: "测试流程",
      apiPath: "/api/test/config",
      tableKeys: ["reviews"],
      emptyTablesError: "tables 至少提供一张表：reviews → table_id",
      configuredText: (cfgJson) => `当前测试流程配置：\n${cfgJson}`,
      load: fakeModule(kv, "test:config"),
    });
    const res = await tool({}, makeEnv(kv));
    expect(textOf(res)).toBe("尚未配置。用 action=set 写入：base = 多维表格 app_token（URL 中 /base/ 后的一段），tables = 逻辑表名到 table_id 的映射。");
  });

  it("set 成功 → 文案逐字（base/张数/表名/apiPath），随后 get 回读", async () => {
    const kv = new Map<string, string>();
    const tool = createModuleConfigTool({
      label: "合同审批流程",
      apiPath: "/api/contract-approval/config",
      tableKeys: ["approvals", "comments", "events"],
      emptyTablesError: "tables 至少提供一张表：approvals / comments / events → table_id",
      configuredText: (cfgJson) => `当前合同审批流程配置：\n${cfgJson}`,
      load: fakeModule(kv, "ca:config"),
    });
    const res = await tool({ action: "set", base: "Zmamb3gUsab5pfs9Z6jcJiRDntb", tables: { approvals: "tblX1", unknown: "tblIgnored" } }, makeEnv(kv));
    expect(textOf(res)).toBe(
      "✅ 合同审批流程配置已保存：base=Zmamb3gUsab5pfs9Z6jcJiRDntb，共 1 张表（approvals）。\n可调用 GET /api/contract-approval/config 或继续调用 API 验证。",
    );
    const got = await tool({ action: "get" }, makeEnv(kv));
    expect(textOf(got)).toContain("当前合同审批流程配置：\n{");
    expect(textOf(got)).toContain('"approvals": "tblX1"');
    expect(textOf(got)).not.toContain("tblIgnored"); // 白名单外的键被过滤
  });

  it("校验错误逐字：base 非法 / table_id 非 tbl 开头 / tables 为空 / action 非法", async () => {
    const kv = new Map<string, string>();
    const tool = createModuleConfigTool({
      label: "硬件评审流程",
      apiPath: "/api/hardware-review/config",
      tableKeys: ["reviews", "minutes"],
      emptyTablesError: "tables 至少提供一张表：reviews / minutes / rectifications / reports / events → table_id",
      configuredText: (cfgJson) => `当前硬件评审流程配置：\n${cfgJson} `,
      load: fakeModule(kv, "hw:config"),
    });
    const env = makeEnv(kv);
    await expect(tool({ action: "set", base: "短", tables: { reviews: "tblA" } }, env)).rejects.toThrow(
      "base 不合法：应为飞书多维表格 URL 中 /base/ 后的 app_token（10 位以上字母数字串）",
    );
    await expect(tool({ action: "set", base: "Zmamb3gUsab5pfs9Z6jcJiRDntb", tables: { reviews: "xxA" } }, env)).rejects.toThrow(
      "table_id 不合法（reviews）：应以 tbl 开头，如 tblsH8aOxxx",
    );
    await expect(tool({ action: "set", base: "Zmamb3gUsab5pfs9Z6jcJiRDntb", tables: {} }, env)).rejects.toThrow(
      "tables 至少提供一张表：reviews / minutes / rectifications / reports / events → table_id",
    );
    await expect(tool({ action: "del" }, env)).rejects.toThrow("action 必须是 get | set");
  });
});

describe("三个真实模块配置工具（动态 import 各模块 config）", () => {
  it("未配置时 get 文案与各模块原实现一致", async () => {
    // 测试环境 REGISTRY 为空 → 三个模块均未配置
    const kv = new Map<string, string>();
    const env = makeEnv(kv);
    const dr = await toolConfigDrawingReview({}, env);
    expect(textOf(dr)).toContain("尚未配置。用 action=set 写入");
    const hw = await toolConfigHardwareReview({}, env);
    expect(textOf(hw)).toContain("尚未配置。用 action=set 写入");
    const ca = await toolConfigContractApproval({}, env);
    expect(textOf(ca)).toContain("尚未配置。用 action=set 写入");
  });

  it("set 后 get：各模块 configuredText 前缀与硬件评审结尾空格逐字保留", async () => {
    const kv = new Map<string, string>();
    const env = makeEnv(kv);
    await toolConfigDrawingReview({ action: "set", base: "OFZqbJHteaYRpssam7Nc4fTYnLc", tables: { reviews: "tblDR1" } }, env);
    const dr = textOf(await toolConfigDrawingReview({}, env));
    expect(dr.startsWith("当前新增机图纸评审流程配置：\n{")).toBe(true);
    expect(dr.endsWith("}")).toBe(true);

    await toolConfigHardwareReview({ action: "set", base: "OFZqbJHteaYRpssam7Nc4fTYnLc", tables: { reviews: "tblHW1" } }, env);
    const hw = textOf(await toolConfigHardwareReview({}, env));
    expect(hw.startsWith("当前硬件评审流程配置：\n{")).toBe(true);
    expect(hw.endsWith("} ")).toBe(true); // 原实现 JSON 后有一个空格，逐字保留

    await toolConfigContractApproval({ action: "set", base: "Zmamb3gUsab5pfs9Z6jcJiRDntb", tables: { approvals: "tblCA1" } }, env);
    const ca = textOf(await toolConfigContractApproval({}, env));
    expect(ca.startsWith("当前合同审批流程配置：\n{")).toBe(true);
  });

  it("各模块空 tables 错误文案逐字不同", async () => {
    const env = makeEnv();
    await expect(toolConfigDrawingReview({ action: "set", base: "OFZqbJHteaYRpssam7Nc4fTYnLc", tables: {} }, env)).rejects.toThrow(
      "tables 至少提供一张表：reviews / minutes / rectifications / bom / ... → table_id",
    );
    await expect(toolConfigHardwareReview({ action: "set", base: "OFZqbJHteaYRpssam7Nc4fTYnLc", tables: {} }, env)).rejects.toThrow(
      "tables 至少提供一张表：reviews / minutes / rectifications / reports / events → table_id",
    );
    await expect(toolConfigContractApproval({ action: "set", base: "Zmamb3gUsab5pfs9Z6jcJiRDntb", tables: {} }, env)).rejects.toThrow(
      "tables 至少提供一张表：approvals / comments / events → table_id",
    );
  });
});
