import { expect, test } from "bun:test";
import { prepareCacheRemoval } from "./cache_executor";
import { LaunchSchema, OwnedImageCacheSchema, resourceReceiptKey } from "./lease_types";

test("parent-journal execution has no cache authority even with a fully described target", async () => {
  const receipt = OwnedImageCacheSchema.parse({ kind: "volume", source: "k3d", authority: "owned-image-cache", purpose: "k3d-image-cache",
    name: "k3d-fixture-images", id: "k3d-fixture-images", createdAt: "2026-11-09T00:00:00Z", creationToken: "00000000-0000-4000-8000-000000000001",
    projectId: "fixture", generation: 1, cluster: "fixture", engine: { endpoint: "unix:///var/run/docker.sock", id: "fixture-engine" },
    labels: { "io.silo.project": "fixture", "io.silo.generation": "1", "k3d.cluster": "fixture", "io.silo.creation": "00000000-0000-4000-8000-000000000001" } });
  const grant = LaunchSchema.parse({ id: "fixture", kind: "owned-image-cache-delete", effect: "delete", command: ["docker", "volume", "rm", receipt.name],
    deletionTarget: { kind: "image-cache", receiptKey: resourceReceiptKey(receipt), receipt },
    phase: "granted", supervisorPid: 2, leaderPid: 3, groupId: 3, supervisorIdentity: "fixture-supervisor", exitCode: null, reconciled: false, terminal: false });
  if (grant.phase !== "granted") throw new Error("Invalid fixture phase");
  await expect(prepareCacheRemoval({ root: "/nonexistent-cache-fixture", projectId: "fixture", generation: 1, launchId: grant.id, leaderPid: 3, groupId: 3 }, grant, "parent"))
    .rejects.toThrow("CLEANUP_REQUIRED: cache deletion requires the canonical account journal");
});
