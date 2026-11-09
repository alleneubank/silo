import { describe, expect, test } from "bun:test";
import { BackendReceiptSchema, LaunchSchema } from "./lease_types";

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
    expect(BackendReceiptSchema.parse({ ...identity, kind: "volume", authority: "observed", id: "localnet-a-cache" }).id).toBe("localnet-a-cache");
  });

  test("target-absent resolution is a terminal exact-ID delete with an unknown exit", () => {
    const resolved = { id: "request-a", kind: "owned-network-delete", command: ["docker", "network", "rm", id], effect: "delete",
      supervisorPid: 20, leaderPid: 21, groupId: 21, supervisorIdentity: "fixture supervisor",
      phase: "resolved", resolution: "target-absent", deletionTarget: { kind: "network", id }, exitCode: null, terminal: true, reconciled: true };
    expect(LaunchSchema.parse(resolved)).toMatchObject({ phase: "resolved", exitCode: null });
    for (const invalid of [{ effect: "create" }, { exitCode: 0 }, { terminal: false }, { reconciled: false },
      { deletionTarget: { kind: "volume", id } }, { deletionTarget: { kind: "network", id: "network-name" } }]) {
      expect(LaunchSchema.safeParse({ ...resolved, ...invalid }).success).toBe(false);
    }
  });
});
