import { describe, expect, it } from "vitest";
import { KV_KEYS } from "../shared/kv-keys";

describe("KV key registry", () => {
  it("keeps dynamic key construction stable", () => {
    expect(KV_KEYS.session("sid-1")).toBe("session:sid-1");
    expect(KV_KEYS.oauthState("state-1")).toBe("oauth:state:state-1");
    expect(KV_KEYS.feishuUserToken("ou_1")).toBe("feishu:user_token:ou_1");
    expect(KV_KEYS.dashboardCache("tasks")).toBe("dashboard:cache:tasks");
    expect(KV_KEYS.todoTable("reimburse")).toBe("todo:tbl:reimburse");
    expect(KV_KEYS.approvalInventoryMark("HW-2026-0001", "arrive")).toBe("approval:inv:HW-2026-0001:arrive");
    expect(KV_KEYS.domainRecord("demo")).toBe("domains:rec:demo");
    expect(KV_KEYS.serial("BX", 2026)).toBe("serial:BX:2026");
    expect(KV_KEYS.contractNumber(2026)).toBe("contract-no:2026");
  });

  it("uses module-scoped user preference keys and retains the legacy drawing key", () => {
    expect(KV_KEYS.userPrefs("dr", "ou_1")).toBe("user-prefs:dr:ou_1");
    expect(KV_KEYS.userPrefs("hw", "ou_1")).toBe("user-prefs:hw:ou_1");
    expect(KV_KEYS.legacyUserPrefs("ou_1")).toBe("user-prefs:ou_1");
    expect(KV_KEYS.userPrefs("dr", "ou_1")).not.toBe(KV_KEYS.userPrefs("hw", "ou_1"));
  });
});
