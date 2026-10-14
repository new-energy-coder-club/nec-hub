import { vi } from "vitest";

export interface MockEnv {
  REGISTRY: {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  APPS_BUCKET: {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
  MCP_TOKEN?: string;
  VERCEL_TOKEN?: string;
  GITHUB_TOKEN?: string;
  GITEE_TOKEN?: string;
  HUB_NAME?: string;
}

export function createMockEnv(): MockEnv {
  return {
    REGISTRY: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    APPS_BUCKET: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    FEISHU_APP_ID: "test-app-id",
    FEISHU_APP_SECRET: "test-app-secret",
    MCP_TOKEN: "test-mcp-token",
    VERCEL_TOKEN: "test-vercel-token",
    GITHUB_TOKEN: "test-github-token",
    GITEE_TOKEN: "test-gitee-token",
    HUB_NAME: "NEC 团队 AI 中台",
  };
}
