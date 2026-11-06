import { describe, expect, test } from "bun:test";
import { BackendReceiptSchema } from "./lease_types";

const identity = {
  source: "compose", name: "localnet-a-service", createdAt: "2026-11-06T00:00:00Z", labels: {},
};
const id = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("Docker receipt IDs", () => {
  test.each(["container", "network"])("accepts an exact immutable %s ID", kind => {
    const receipt = BackendReceiptSchema.parse({ ...identity, kind, id, anonymousVolumes: [] });
    expect(receipt.id).toBe(id);
  });

  test.each(["container", "network"])("refuses a name, truncated or missing %s ID", kind => {
    for (const value of [identity.name, "0123456789ab", undefined]) {
      expect(BackendReceiptSchema.safeParse({ ...identity, kind, id: value, anonymousVolumes: [] }).success).toBe(false);
    }
  });

  test("retains named-volume identity for audit without granting a Docker object ID", () => {
    expect(BackendReceiptSchema.parse({ ...identity, kind: "volume", id: "localnet-a-cache" }).id).toBe("localnet-a-cache");
  });
});
