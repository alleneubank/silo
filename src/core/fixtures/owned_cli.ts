import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ProjectOperation } from "../lease_store";
import { startOwnedCommand } from "../owned_command";
import { prepareFileTarget } from "../file_target";

if (Bun.argv[2] !== "--exercise-owned-command") {
  await import("../../cli");
} else {
  const root = Bun.argv[3];
  assert(root && path.isAbsolute(root), "fixture root must be absolute");
  const timeoutMs = Number(Bun.argv[4] ?? 60_000);
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60_000, "fixture timeout must be between 1 and 60000 ms");
  mkdirSync(root, { recursive: true });
  const configSource = "version = 1\n";
  const configPath = path.join(root, "silo.toml");
  writeFileSync(configPath, configSource);
  const owner = await ProjectOperation.open(root, {
    storePath: path.join(root, "store", "leases.sqlite"),
    executorEntrypoint: import.meta.path,
    legacyInputs: { accountHome: path.join(root, "account"), home: path.join(root, "home"), registryDir: undefined },
    listenerProbe: async () => true,
  });
  try {
    await owner.allocate({
      state: {
        name: "owned", ports: {}, createdAt: "2026-01-01T00:00:00Z", k3dClusterCreated: false,
        identity: { name: "owned", prefix: "localnet", composeName: "localnet-owned", dockerNetwork: "localnet-owned", volumePrefix: "localnet-owned", containerPrefix: "localnet-owned-", hosts: {} },
      },
      configPath, configSource, fingerprint: "fixture", urls: {}, k3dArgs: [],
      hostOrder: [], portOrder: [], urlOrder: [], engine: null,
    }, [{ domain: "instance-name", resource: "owned" }], [
      { role: "config", target: prepareFileTarget(root, "silo.toml", "config") },
    ]);
    const running = await startOwnedCommand(owner, ["/bin/sh", "-c", "printf tool-output; printf granted > launched.txt; exec sleep 60"], {
      kind: "entrypoint-proof", effect: "none", timeoutMs,
    });
    try {
      const deadline = Date.now() + 5000;
      while (!existsSync(path.join(root, "launched.txt"))) {
        assert(Date.now() < deadline, "granted tool did not write its marker");
        await Bun.sleep(20);
      }
    } finally { running.stop(); await running.exited; }
    const result = await running.exited;
    owner.recordCommandResult(result.launch);
    console.log(JSON.stringify({ exitCode: result.exitCode, stdout: result.stdout }));
  } finally {
    writeFileSync(path.join(root, "inspection.json"), JSON.stringify(ProjectOperation.inspect(root, owner.storePath)));
    owner.finish();
  }
}
