import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { ProjectOperation, digest, processAbsent } from "./lease_store";
import { fileIdentity, prepareFileTarget } from "./file_target";
import { appendGithubEnv, writeEnvAndLockfile } from "./env";
import { runOwnedCommand, startOwnedCommand, stopOwnedCommand } from "./owned_command";
import type { Allocation, Claim, FileReceipt } from "./lease_types";
import { BackendReceiptSchema } from "./lease_types";
import { createListenerProbe } from "./socket_listeners";
import { connectedUdp } from "./fixtures/connected_udp";

let base: string;
let storePath: string;
let legacyInputs: { accountHome: string; home: string; registryDir: undefined };

beforeAll(() => {
  const root = mkdtempSync(path.join(os.tmpdir(), "silo-supervisor-preflight-"));
  try {
    const result = Bun.spawnSync(["janitor", "version"], { cwd: root, stdout: "pipe", stderr: "pipe", timeout: 2000 });
    if (result.exitCode !== 0) {
      throw new Error(`Native launch tests require runnable Janitor on PATH from fixture directories (see README prerequisites). ${result.stderr.toString().slice(-4096)}`.trimEnd());
    }
  } finally { rmSync(root, { recursive: true }); }
});

beforeEach(() => {
  base = mkdtempSync(path.join(os.tmpdir(), "silo-leases-"));
  storePath = path.join(base, "store", "leases.sqlite");
  legacyInputs = { accountHome: path.join(base, "account"), home: path.join(base, "home"), registryDir: undefined };
});
afterEach(() => rmSync(base, { recursive: true }));

const project = (name: string): string => {
  const root = path.join(base, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "silo.toml"), 'version = 1\n[ports]\nAPP_PORT = 3000\n');
  return root;
};

const allocation = (root: string, name: string, port = 3000): Allocation => ({
  state: {
    name, ports: { APP_PORT: port }, createdAt: "2026-01-01T00:00:00Z", k3dClusterCreated: false,
    identity: { name, prefix: "localnet", composeName: `localnet-${name}`, dockerNetwork: `localnet-${name}`, volumePrefix: `localnet-${name}`, containerPrefix: `localnet-${name}-`, hosts: { APP_HOST: `${name}.localhost` } },
  },
  configPath: path.join(root, "silo.toml"), configSource: 'version = 1\n[ports]\nAPP_PORT = 3000\n', fingerprint: "fixture",
  urls: {}, k3dArgs: [], hostOrder: ["APP_HOST"], portOrder: ["APP_PORT"], urlOrder: [], engine: null,
});
const targets = (root: string) => [
  { role: "env" as const, target: prepareFileTarget(root, ".localnet.env", "env") },
  { role: "lock" as const, target: prepareFileTarget(root, ".silo.lock", "lock") },
  { role: "config" as const, target: prepareFileTarget(root, "silo.toml", "config") },
];
const open = (root: string, recover = false) => ProjectOperation.open(root, { storePath, legacyInputs, recover, listenerProbe: async () => true });
const retire = async (owner: ProjectOperation) => owner.retire(await owner.prepareRetirement());
const injectReceipt = (owner: ProjectOperation, receipt: FileReceipt) => {
  const db = new Database(storePath);
  try { db.query("UPDATE files SET receipt = ? WHERE project_id = ? AND generation = ? AND role = ?").run(JSON.stringify(receipt), owner.projectId, owner.generation, receipt.role); }
  finally { db.close(); }
};
const claims = (name: string, port: number): Claim[] => [
  { domain: "instance-name", resource: name }, { domain: "host-port", resource: String(port) },
];

const withCompletionWriter = async (root: string, observe: () => void): Promise<void> => {
  const script = 'import {Database} from "bun:sqlite"; const db=new Database(process.argv[1]); db.exec("PRAGMA busy_timeout=5000; BEGIN EXCLUSIVE"); console.log("locked"); await Bun.stdin.stream().getReader().read(); db.exec("COMMIT"); db.close();';
  const writer = Bun.spawn([process.execPath, "-e", script, storePath], { stdin: "pipe", stdout: "pipe", stderr: "pipe", detached: true, timeout: 15_000 });
  writeFileSync(path.join(root, "writer.pid"), String(writer.pid));
  const errors = new Response(writer.stderr).text();
  try {
    const ready = await writer.stdout.getReader().read();
    expect(new TextDecoder().decode(ready.value)).toBe("locked\n");
    expect(writer.exitCode).toBe(null);
    const started = performance.now();
    observe();
    const elapsedMs = performance.now() - started;
    expect(elapsedMs, "completion observation must return while the writer holds its lock, well before the 5 s store timeout").toBeLessThan(1000);
    expect(writer.exitCode).toBe(null);
    expect(writer.signalCode).toBe(null);
  } finally {
    writer.stdin.end();
    expect({ exitCode: await writer.exited, stderr: await errors }).toEqual({ exitCode: 0, stderr: "" });
  }
};

describe("atomic account leases", () => {
  test("a locked completion observation leaves the active operation usable after the writer releases", async () => {
    const root = project("completion-contention");
    const owner = await open(root);
    const key = { storePath, projectId: owner.projectId, generation: owner.generation, launchId: "00000000-0000-4000-8000-000000000001" };
    try {
      await withCompletionWriter(root, () => {
        expect(() => ProjectOperation.readExecutorCompletion(key)).toThrow();
      });
      expect(owner.current()).toBe(null);
      expect(ProjectOperation.readExecutorCompletion(key)).toBe(null);
      owner.finish();
      expect(ProjectOperation.readExecutorCompletion(key)).toBe(null);
      const next = await open(root);
      try {
        expect(ProjectOperation.readExecutorCompletion(key)).toBe(null);
        expect(next.current()).toBe(null);
      } finally { next.finish(); }
      expect(ProjectOperation.inspect(root, storePath)?.operation).toBe(null);
    } finally { owner.finish(); }
  }, 30_000);

  test("a completion observation yields no fact with two active operations and leaves both usable", async () => {
    const firstRoot = project("completion-first");
    const secondRoot = project("completion-second");
    const first = await open(firstRoot);
    const second = await open(secondRoot);
    const key = { storePath, projectId: first.projectId, generation: first.generation, launchId: "00000000-0000-4000-8000-000000000001" };
    try {
      await withCompletionWriter(firstRoot, () => {
        expect(ProjectOperation.readExecutorCompletion(key)).toBe(null);
      });
      expect(first.current()).toBe(null);
      expect(second.current()).toBe(null);
    } finally {
      try { first.finish(); }
      finally { second.finish(); }
    }
    expect(ProjectOperation.inspect(firstRoot, storePath)?.operation).toBe(null);
    expect(ProjectOperation.inspect(secondRoot, storePath)?.operation).toBe(null);
  }, 30_000);

  test("resolved launch history yields capacity without discarding uncertainty or resource history", async () => {
    const root = project("history-capacity"); const op = await open(root);
    try {
      await op.allocate(allocation(root, "history-capacity"), [...claims("history-capacity", 3000), { domain: "container", resource: "old-parent" }], targets(root));
      const receipt = BackendReceiptSchema.parse({ kind: "container", source: "compose", name: "old-parent", id: "c".repeat(64), createdAt: "2026-11-06T00:00:00Z", labels: {}, anonymousVolumes: [{ name: "retained-audit", createdAt: "2026-11-06T00:00:00Z", destination: "/data" }] });
      op.recordResources([receipt]); op.recordResourceAbsence(receipt);
      const running = await startOwnedCommand(op, ["/bin/sh", "-c", "exit 17"], { kind: "pending-creation", effect: "create", timeoutMs: 5000 });
      const result = await running.exited;
      op.recordCommandResult(result.launch);
      await stopOwnedCommand(result.launch);
      op.markLaunchTerminal(result.launch.id);
      const unresolved = op.launches().find(l => l.id === result.launch.id)!;
      for (let index = 0; index < 1023; index++) {
        const old = op.planLaunch({ kind: "finished-intent", command: ["true"], effect: "none" });
        op.markLaunchTerminal(old.id);
      }
      const cleanup = op.planLaunch({ kind: "cleanup", command: ["true"], effect: "delete" });
      expect(op.launches()).toEqual(expect.arrayContaining([unresolved, cleanup]));
      expect(op.resources(true)).toEqual([receipt]);
      expect(op.resources()).toEqual([]);
      await expect(retire(op)).rejects.toThrow("CLEANUP_REQUIRED");
    } finally { op.finish(); }
  }, 15_000);

  test("existing-only acquisition never creates a missing store or project", async () => {
    const known = project("known"); const unknown = project("unknown");
    expect(await ProjectOperation.openExisting(known, { storePath, legacyInputs })).toBe(null);
    expect(existsSync(storePath)).toBe(false);
    const owner = await open(known); const projectId = owner.projectId; owner.finish();
    expect(await ProjectOperation.openExisting(unknown, { storePath, legacyInputs })).toBe(null);
    expect(ProjectOperation.inspect(unknown, storePath)).toBe(null);
    const recovered = await ProjectOperation.openExisting(known, { storePath, legacyInputs, recover: true });
    expect(recovered?.projectId).toBe(projectId); recovered?.finish();
  });

  test("an unsupported proposal store is refused without changing its bytes", async () => {
    const root = project("old-format");
    const op = await open(root); op.finish();
    const db = new Database(storePath);
    db.exec("PRAGMA user_version = 1"); db.close();
    const before = readFileSync(storePath);
    await expect(open(root)).rejects.toThrow("LEASE_STORE_UNAVAILABLE");
    expect(() => ProjectOperation.inspect(root, storePath)).toThrow("LEASE_STORE_UNAVAILABLE");
    expect(readFileSync(storePath)).toEqual(before);
  });

  test.each(["container", "network"])("a fresh %s ID can reuse a proven-absent name while history remains", async kind => {
    const root = project("receipt-cycle"); const op = await open(root);
    const name = "localnet-reusable";
    const first = BackendReceiptSchema.parse({ kind, source: "compose", name, id: "a".repeat(64), createdAt: "2026-11-06T00:00:00Z", labels: {}, anonymousVolumes: [{ name: "audit-only-mount", createdAt: "2026-11-06T00:00:00Z", destination: "/data" }] });
    const second = BackendReceiptSchema.parse({ ...first, id: "b".repeat(64), createdAt: "2026-11-06T00:01:00Z" });
    try {
      await op.allocate(allocation(root, "receipt-cycle"), [...claims("receipt-cycle", 3000), { domain: kind, resource: name }], targets(root));
      op.recordResources([first]);
      expect(() => op.recordResources([second])).toThrow("NAME_CONFLICT");
      expect(op.resources()).toEqual([first]);
      op.recordResourceAbsence(first);
      op.recordResources([second]);
      expect(op.resources()).toEqual([second]);
      expect(op.resources(true)).toHaveLength(2);
      expect(op.resources(true)).toEqual(expect.arrayContaining([first, second]));
      expect(ProjectOperation.inspect(root, storePath)?.resources).toEqual(expect.arrayContaining([{ ...first, deleted: true }, { ...second, deleted: false }]));
      expect(() => op.recordResources([first])).toThrow("NAME_CONFLICT");
    } finally { op.finish(); }
  });

  test("terminal exact-target absence reconciles only that ID's completed deletion", async () => {
    const root = project("absent-delete"); const op = await open(root);
    const first = BackendReceiptSchema.parse({ kind: "network", source: "compose", name: "network-a", id: "a".repeat(64), createdAt: "2026-11-06T00:00:00Z", labels: {} });
    const other = BackendReceiptSchema.parse({ ...first, name: "network-b", id: "b".repeat(64) });
    assert(first.kind === "network"); assert(other.kind === "network");
    try {
      await op.allocate(allocation(root, "absent-delete"), [...claims("absent-delete", 3000), { domain: "network", resource: "network-", prefix: true }], targets(root));
      op.recordResources([first, other]);
      await expect(runOwnedCommand(op, ["/bin/sh", "-c", "exit 17"], { kind: "exact-delete", effect: "delete", deletionTarget: { kind: first.kind, id: first.id }, timeoutMs: 5000 })).rejects.toThrow("COMMAND_FAILED");
      const failed = op.launches()[0]!;
      op.recordResourceAbsence(first);
      expect(op.launches()[0]?.reconciled).toBe(false);
      op.markLaunchTerminal(failed.id);
      op.recordResourceAbsence(other);
      expect(op.launches()[0]?.reconciled).toBe(false);
      op.recordResourceAbsence(first);
      expect(op.launches()[0]?.reconciled).toBe(true);
      expect(op.resources()).toEqual([]);
    } finally { op.finish(); }
  });

  test("exact-target absence closes a terminal delete with a lost completion without inventing an exit", async () => {
    const root = project("lost-delete-fact"); const op = await open(root);
    const receipt = BackendReceiptSchema.parse({ kind: "network", source: "compose", name: "network-a", id: "a".repeat(64), createdAt: "2026-11-06T00:00:00Z", labels: {} });
    assert(receipt.kind === "network");
    try {
      await op.allocate(allocation(root, "lost-delete-fact"), [...claims("lost-delete-fact", 3000), { domain: "network", resource: receipt.name }], targets(root));
      op.recordResources([receipt]);
      const deletion = await startOwnedCommand(op, ["/bin/sh", "-c", "exit 17"], { kind: "exact-delete", effect: "delete", deletionTarget: { kind: receipt.kind, id: receipt.id }, timeoutMs: 5000 });
      await deletion.exited;
      const creation = await startOwnedCommand(op, ["/bin/sh", "-c", "exit 0"], { kind: "unknown-create", effect: "create", timeoutMs: 5000 });
      await creation.exited;
      for (const launch of op.launches()) op.markLaunchTerminal(launch.id);
      op.recordResourceAbsence(receipt);
      expect(op.launches().find(l => l.id === deletion.launch.id)).toMatchObject({ phase: "resolved", resolution: "target-absent", reconciled: true, terminal: true, exitCode: null });
      expect(op.launches().find(l => l.id === creation.launch.id)).toMatchObject({ phase: "granted", reconciled: false, terminal: true, exitCode: null });
      await expect(retire(op)).rejects.toThrow("CLEANUP_REQUIRED");
    } finally { op.finish(); }
  });
  test("export parent preparation never creates or enters a legacy registry tree", async () => {
    const root = project("a"); const registryDir = path.join(root, "registry");
    const op = await ProjectOperation.open(root, { storePath, legacyInputs: { ...legacyInputs, registryDir } });
    try {
      expect(() => op.prepareTarget(root, "registry/subdir/output.env", "env")).toThrow("PATH_CONFLICT");
      expect(() => op.prepareTarget(root, "REGISTRY/output.env", "env")).toThrow("PATH_CONFLICT");
      expect(existsSync(registryDir)).toBe(false);
      expect(existsSync(path.join(root, "REGISTRY"))).toBe(false);
    } finally { op.finish(); }
  });
  test("two allocators probing the same port cannot commit duplicate claims or a partial name", async () => {
    const a = project("a"); const b = project("b");
    const first = await open(a); const second = await open(b);
    try {
      // Both have observed the same unclaimed default, before either insert.
      expect(first.excludedPorts().has(3000)).toBe(false);
      expect(second.excludedPorts().has(3000)).toBe(false);
      await first.allocate(allocation(a, "a"), claims("a", 3000), targets(a));
      await expect(second.allocate(allocation(b, "b"), claims("b", 3000), targets(b))).rejects.toThrow("PORT_CLAIM_CONFLICT");
      expect(ProjectOperation.inspect(b, storePath)?.claims).toEqual([]);
      await second.allocate(allocation(b, "b", 49152), claims("b", 49152), targets(b));
      expect(ProjectOperation.inspect(a, storePath)?.allocation?.state.ports).toEqual({ APP_PORT: 3000 });
      expect(ProjectOperation.inspect(b, storePath)?.allocation?.state.ports).toEqual({ APP_PORT: 49152 });
    } finally { first.finish(); second.finish(); }
  });

  test("a peer's inspection and clean cannot release or rewrite another root", async () => {
    const a = project("a"); const b = project("b");
    const first = await open(a);
    await first.allocate(allocation(a, "a"), claims("a", 3000), targets(a));
    first.file("env").publish("a sentinel\n"); first.finish();
    const before = ProjectOperation.inspect(a, storePath);
    const bytes = readFileSync(storePath);
    expect(ProjectOperation.inspect(b, storePath)).toBe(null);
    expect(readFileSync(storePath)).toEqual(bytes);
    const peer = await open(b);
    await peer.allocate(allocation(b, "b", 3001), claims("b", 3001), targets(b));
    await retire(peer); peer.finish();
    expect(ProjectOperation.inspect(a, storePath)).toEqual(before);
    expect(readFileSync(path.join(a, ".localnet.env"), "utf8")).toBe("a sentinel\n");
  });

  test("root symlinks share one operation, and a finished capability is fenced", async () => {
    const root = project("a"); const alias = path.join(base, "alias"); symlinkSync(root, alias);
    const op = await open(root);
    await expect(open(alias)).rejects.toThrow("BUSY");
    await op.allocate(allocation(root, "a"), claims("a", 3000), targets(root)); op.finish();
    expect(() => op.update(allocation(root, "a"), "running")).toThrow("Operation has closed");
    expect(ProjectOperation.inspect(alias, storePath)?.projectId).toBe(ProjectOperation.inspect(root, storePath)?.projectId);
  });

  test("prefix overlap refuses even when the exact namespace keys differ", async () => {
    const a = project("a"); const b = project("b");
    const first = await open(a); const second = await open(b);
    try {
      await first.allocate(allocation(a, "a"), [{ domain: "container", resource: "localnet-a-", prefix: true }], targets(a));
      await expect(second.allocate(allocation(b, "b"), [{ domain: "container", resource: "localnet-a-child-", prefix: true }], targets(b))).rejects.toThrow("NAME_CONFLICT");
    } finally { first.finish(); second.finish(); }
  });

  test("same-name and cross-role file aliases refuse, leaving the peer bytes intact", async () => {
    const a = project("a"); const b = project("a/nested");
    const first = await open(a); const second = await open(b);
    try {
      await first.allocate(allocation(a, "a"), claims("a", 3000), [
        ...targets(a), { role: "kubeconfig", target: prepareFileTarget(a, "nested/Kubeconfig", "kubeconfig") },
      ]);
      first.file("kubeconfig").publish("a kubeconfig\n");
      await expect(second.allocate(allocation(b, "b"), claims("a", 3001), targets(b))).rejects.toThrow("NAME_CONFLICT");
      await expect(second.allocate(allocation(b, "b"), claims("b", 3001), [
        ...targets(b).filter(t => t.role !== "env"), { role: "env", target: prepareFileTarget(b, "kubeconfig", "env") },
      ])).rejects.toThrow("PATH_CONFLICT");
      expect(readFileSync(path.join(b, "Kubeconfig"), "utf8")).toBe("a kubeconfig\n");
      expect(ProjectOperation.inspect(b, storePath)?.claims).toEqual([]);
    } finally { first.finish(); second.finish(); }
  });

  test("unreceipted generated files are refused without alteration", async () => {
    const root = project("a"); writeFileSync(path.join(root, ".localnet.env"), "foreign\n");
    const op = await open(root);
    try {
      await expect(op.allocate(allocation(root, "a"), claims("a", 3000), targets(root))).rejects.toThrow("PATH_CONFLICT");
      expect(readFileSync(path.join(root, ".localnet.env"), "utf8")).toBe("foreign\n");
      expect(ProjectOperation.inspect(root, storePath)?.claims).toEqual([]);
    } finally { op.finish(); }
  });

  test("an uncaptured creating tool keeps its port, even after its executor is absent", async () => {
    const root = project("a"); const op = await open(root);
    try {
      await op.allocate(allocation(root, "a"), claims("a", 3000), targets(root));
      const running = await startOwnedCommand(op, ["/bin/sh", "-c", "exit 17"], { kind: "uncertain-create", effect: "create", timeoutMs: 5000 });
      const result = await running.exited;
      op.recordCommandResult(result.launch);
      expect(result.exitCode).toBe(17);
      await expect(retire(op)).rejects.toThrow("CLEANUP_REQUIRED");
      expect(ProjectOperation.inspect(root, storePath)?.claims).toContainEqual({ domain: "host-port", resource: "3000" });
    } finally { op.finish(); }
  });

  test("a supervisor that refuses startup reports its diagnostic without executing the tool", async () => {
    const root = project("a"); const op = await open(root);
    const bin = path.join(base, "bin"); mkdirSync(bin);
    const supervisor = path.join(bin, "janitor");
    writeFileSync(supervisor, '#!/bin/sh\necho "supervisor fixture: no runtime configured" >&2\nexit 78\n');
    chmodSync(supervisor, 0o755);
    const canary = path.join(root, "must-not-exist");
    try {
      await op.allocate(allocation(root, "a"), claims("a", 3000), targets(root));
      await expect(startOwnedCommand(op, ["/bin/sh", "-c", "printf executed > must-not-exist"], {
        kind: "refused-supervisor", effect: "create", timeoutMs: 5000, env: { PATH: bin },
      })).rejects.toMatchObject({
        code: "LAUNCH_FAILED",
        message: expect.stringContaining("supervisor fixture: no runtime configured"),
        details: expect.objectContaining({ supervisorExitCode: 78 }),
      });
      expect(existsSync(canary)).toBe(false);
      expect(op.launches()).toMatchObject([{ phase: "planned", reconciled: false }]);
      expect(ProjectOperation.inspect(root, storePath)?.claims).toContainEqual({ domain: "host-port", resource: "3000" });
    } finally { op.finish(); }
  });

  test("a journaled completion ends the command, with its exit code and output, when its supervisor outlives the executor", async () => {
    const root = project("a"); const op = await open(root);
    const bin = path.join(base, "bin"); mkdirSync(bin);
    // Reproduces Janitor 0.3.1 on macOS: it can consume its one-shot child-exit
    // event before the exit is observable, then wait until its owner dies.
    writeFileSync(path.join(bin, "janitor"), [
      "#!/usr/bin/perl",
      'shift @ARGV while @ARGV && $ARGV[0] ne "--"; shift @ARGV;',
      "my $child = fork(); if ($child == 0) { setpgrp(0, 0); exec @ARGV; exit 127; }",
      "waitpid($child, 0); my $status = $? >> 8;",
      "$SIG{TERM} = sub { exit $status };",
      "sleep 120; exit 70;",
    ].join("\n"));
    chmodSync(path.join(bin, "janitor"), 0o755);
    const ran = path.join(root, "ran");
    let running: Awaited<ReturnType<typeof startOwnedCommand>> | undefined;
    try {
      await op.allocate(allocation(root, "a"), claims("a", 3000), targets(root));
      running = await startOwnedCommand(op, ["/bin/sh", "-c", `printf tool-done; touch '${ran}'`], { kind: "parked-supervisor", effect: "none", timeoutMs: 120_000, env: { PATH: `${bin}:${process.env.PATH}` } });
      const deadline = Date.now() + 10_000;
      while (!existsSync(ran)) { assert(Date.now() < deadline, "tool did not run"); await Bun.sleep(20); }
      // This store uses the parent journal, so the test writes the executor's
      // fact. It records a failure the parked supervisor's own exit cannot show.
      const db = new Database(storePath);
      try {
        db.query("INSERT INTO completions (project_id, generation, launch_id, receipt) VALUES (?, ?, ?, ?)").run(op.projectId, op.generation, running.launch.id,
          JSON.stringify({ projectId: op.projectId, generation: op.generation, launchId: running.launch.id, leaderPid: running.launch.leaderPid, groupId: running.launch.groupId, started: true, exitCode: 3, completedAt: new Date().toISOString() }));
      } finally { db.close(); }
      const result = await running.exited;
      expect(result.exitCode).toBe(3);
      expect(result.stdout).toBe("tool-done");
      expect(processAbsent(running.launch.supervisorPid)).toBe(true);
    } finally { running?.stop(); op.finish(); }
  }, 30_000);

  test("an until-stop command outlives the operation that started it, then stops and reconciles", async () => {
    const root = project("a"); let op = await open(root);
    const started = path.join(root, "started");
    let running: Awaited<ReturnType<typeof startOwnedCommand>> | undefined;
    try {
      await op.allocate(allocation(root, "a"), claims("a", 3000), targets(root));
      running = await startOwnedCommand(op, ["/bin/sh", "-c", `touch '${started}'; exec sleep 60`], { kind: "tilt-up", effect: "workload", timeoutMs: null, capture: false });
      const deadline = Date.now() + 10_000;
      while (!existsSync(started)) { assert(Date.now() < deadline, "tool did not run"); await Bun.sleep(20); }
      op.finish();
      let settled = false;
      running.exited.then(() => { settled = true; }, () => { settled = true; });
      // Spans the completion poll's backoff from 50 ms up to its 1 s ceiling.
      await Bun.sleep(3000);
      expect(settled).toBe(false);
      expect(processAbsent(running.launch.supervisorPid)).toBe(false);
      running.stop();
      const result = await running.exited;
      expect(result.exitCode).not.toBe(0);
      expect(processAbsent(running.launch.supervisorPid)).toBe(true);
      op = await open(root);
      expect(op.recordCommandResult(result.launch)).toMatchObject({ id: running.launch.id, phase: "exited", exitCode: result.exitCode });
      expect(op.launches().find(l => l.id === running?.launch.id)).toMatchObject({ phase: "exited", exitCode: result.exitCode });
    } finally { running?.stop(); op.finish(); }
  }, 30_000);

  test("a successful exact deletion retry reconciles terminal completed deletions", async () => {
    const root = project("a"); const op = await open(root);
    const command = ["/bin/sh", "-c", "if test -f attempted; then exit 0; else touch attempted; exit 17; fi"];
    try {
      await op.allocate(allocation(root, "a"), claims("a", 3000), targets(root));
      await expect(runOwnedCommand(op, command, { kind: "owned-delete", effect: "delete", timeoutMs: 5000 })).rejects.toThrow("COMMAND_FAILED");
      const failed = op.launches()[0]!; op.markLaunchTerminal(failed.id);
      await expect(retire(op)).rejects.toThrow("CLEANUP_REQUIRED");
      await runOwnedCommand(op, command, { kind: "owned-delete", effect: "delete", timeoutMs: 5000 });
      expect(op.launches().every(launch => launch.phase === "exited" && launch.reconciled)).toBe(true);
      await retire(op);
      expect(ProjectOperation.inspect(root, storePath)?.claims).toEqual([]);
    } finally { op.finish(); }
  });

  test("recovery folds a durable successful deletion retry before releasing claims", async () => {
    const root = project("retry-crash");
    let op = await open(root);
    const command = ["/bin/sh", "-c", "if test -f attempted; then exit 0; else touch attempted; exit 17; fi"];
    try {
      await op.allocate(allocation(root, "retry-crash"), claims("retry-crash", 3000), targets(root));
      await expect(runOwnedCommand(op, command, { kind: "owned-delete", effect: "delete", timeoutMs: 5000 })).rejects.toThrow("COMMAND_FAILED");
      op.markLaunchTerminal(op.launches()[0]!.id);
      const retry = await startOwnedCommand(op, command, { kind: "owned-delete", effect: "delete", timeoutMs: 5000 });
      const result = await retry.exited;
      expect(result.exitCode).toBe(0);
      // Persist the executor fact at the interruption boundary: the parent has
      // not imported it or reconciled the earlier failed request.
      const db = new Database(storePath);
      try {
        db.query("INSERT INTO completions (project_id, generation, launch_id, receipt) VALUES (?, ?, ?, ?)").run(op.projectId, op.generation, retry.launch.id,
          JSON.stringify({ projectId: op.projectId, generation: op.generation, launchId: retry.launch.id, leaderPid: retry.launch.leaderPid, groupId: retry.launch.groupId, started: true, exitCode: 0, completedAt: "2026-11-05T02:21:00Z" }));
      } finally { db.close(); }
      op.finish();
      op = await open(root, true);
      for (const launch of op.launches()) op.markLaunchTerminal(launch.id);
      op.applyCompletions();
      expect(op.launches().every(launch => launch.phase === "exited" && launch.reconciled)).toBe(true);
      await retire(op);
      expect(ProjectOperation.inspect(root, storePath)?.claims).toEqual([]);
    } finally { op.finish(); }
  });

  test("an earlier successful deletion cannot reconcile a later failed request", async () => {
    const root = project("delete-order"); const op = await open(root);
    const command = ["/bin/sh", "-c", "if test -f successful; then exit 17; else touch successful; exit 0; fi"];
    try {
      await op.allocate(allocation(root, "delete-order"), claims("delete-order", 3000), targets(root));
      await runOwnedCommand(op, command, { kind: "owned-delete", effect: "delete", timeoutMs: 5000 });
      for (const launch of op.launches()) op.markLaunchTerminal(launch.id);
      await expect(runOwnedCommand(op, command, { kind: "owned-delete", effect: "delete", timeoutMs: 5000 })).rejects.toThrow("COMMAND_FAILED");
      for (const launch of op.launches()) op.markLaunchTerminal(launch.id);
      op.applyCompletions();
      expect(op.launches().find(l => l.phase === "exited" && l.exitCode === 17)?.reconciled).toBe(false);
      await expect(retire(op)).rejects.toThrow("CLEANUP_REQUIRED");
      expect(ProjectOperation.inspect(root, storePath)?.claims).toContainEqual({ domain: "host-port", resource: "3000" });
    } finally { op.finish(); }
  });

  test("corrupt stores refuse instead of opening an empty allocation domain", async () => {
    const root = project("a"); mkdirSync(path.dirname(storePath), { recursive: true }); writeFileSync(storePath, "not sqlite");
    await expect(open(root)).rejects.toThrow("LEASE_STORE_UNAVAILABLE");
    expect(readFileSync(storePath, "utf8")).toBe("not sqlite");
  });

  test("a retired root obtains a fresh generation and an old writer cannot overwrite it", async () => {
    const root = project("a"); const first = await open(root);
    await first.allocate(allocation(root, "a"), claims("a", 3000), targets(root)); await retire(first); first.finish();
    const second = await open(root);
    try {
      await second.allocate(allocation(root, "a", 3001), claims("a", 3001), targets(root));
      expect(second.generation).toBe(2);
      expect(() => first.file("env").publish("late callback")).toThrow("Operation has closed");
    } finally { second.finish(); }
  });

  test("database busy refuses without resetting another project's reservations", async () => {
    const a = project("a"); const b = project("b"); const first = await open(a);
    await first.allocate(allocation(a, "a"), claims("a", 3000), targets(a)); first.finish();
    const before = ProjectOperation.inspect(a, storePath);
    const connection = new Database(storePath);
    try {
      connection.exec("BEGIN IMMEDIATE");
      await expect(open(b)).rejects.toThrow("LEASE_STORE_UNAVAILABLE");
      connection.exec("ROLLBACK");
      expect(ProjectOperation.inspect(a, storePath)).toEqual(before);
    } finally { connection.close(); }
  }, 10_000);

  test("snapshot replacement, hardlinks and parent swaps refuse without deleting foreign bytes", async () => {
    const root = project("a"); const op = await open(root);
    try {
      await op.allocate(allocation(root, "a"), claims("a", 3000), targets(root));
      const env = op.file("env"); env.publish("owned\n");
      const replacement = path.join(root, "replacement"); writeFileSync(replacement, "foreign\n");
      renameSync(replacement, env.path);
      expect(() => env.remove()).toThrow("PATH_CHANGED");
      expect(readFileSync(env.path, "utf8")).toBe("foreign\n");
      expect(ProjectOperation.inspect(root, storePath)?.claims).toContainEqual({ domain: "host-port", resource: "3000" });
    } finally { op.finish(); }
    const linked = project("linked"); const linkedOp = await open(linked);
    try {
      await linkedOp.allocate(allocation(linked, "linked"), claims("linked", 3001), targets(linked));
      linkedOp.file("env").publish("linked owner\n");
      linkSync(linkedOp.file("env").path, path.join(linked, "hardlink"));
      expect(() => linkedOp.file("env").remove()).toThrow("PATH_CONFLICT");
      expect(readFileSync(path.join(linked, "hardlink"), "utf8")).toBe("linked owner\n");
    } finally { linkedOp.finish(); }
  });

  test("parent/final symlinks and absolute or escaping output paths are refused", async () => {
    const root = project("a"); const peer = project("peer"); symlinkSync(peer, path.join(root, "alias"));
    expect(() => prepareFileTarget(root, "alias/out.env", "env")).toThrow("PATH_CONFLICT");
    for (const output of ["../peer/out.env", "/tmp/out.env", "a/../out.env", "${HOME}/out.env", ".git/out", ".silo.lock", ".SILO.STARTUP"]) {
      expect(() => prepareFileTarget(root, output, "env")).toThrow();
    }
    const op = await open(root);
    try {
      await op.allocate(allocation(root, "a"), claims("a", 3000), targets(root));
      op.file("env").publish("owned\n");
      rmSync(op.file("env").path); writeFileSync(path.join(peer, "canary"), "peer\n"); symlinkSync(path.join(peer, "canary"), path.join(root, ".localnet.env"));
      expect(() => op.file("env").publish("overwrite")).toThrow("PATH_CONFLICT");
      expect(readFileSync(path.join(peer, "canary"), "utf8")).toBe("peer\n");
    } finally { op.finish(); }
  });

  test("a config edit cannot redirect snapshot cleanup to its selected replacement path", async () => {
    const root = project("a"); const op = await open(root);
    try {
      await op.allocate(allocation(root, "a"), claims("a", 3000), targets(root)); op.file("env").publish("owned\n");
      writeFileSync(path.join(root, "peer.env"), "peer\n");
      writeFileSync(path.join(root, "silo.toml"), 'version=1\noutput="peer.env"\n[ports]\nAPP_PORT=3000\n');
      op.file("env").remove();
      expect(existsSync(path.join(root, ".localnet.env"))).toBe(false);
      expect(readFileSync(path.join(root, "peer.env"), "utf8")).toBe("peer\n");
      await retire(op);
    } finally { op.finish(); }
  });

  test("interrupted rename resumes its recorded inode, and refuses an unrelated replacement", async () => {
    const root = project("a"); const op = await open(root);
    try {
      await op.allocate(allocation(root, "a"), claims("a", 3000), targets(root)); op.file("env").publish("old\n");
      const receipt = op.fileReceipt("env")!; const temporary = path.join(root, ".interrupted.tmp");
      writeFileSync(temporary, "new generation\n"); const identity = fileIdentity(temporary)!;
      injectReceipt(op, { ...receipt, pending: { action: "publish", temporary, identity, hash: digest("new generation\n") } });
      renameSync(temporary, receipt.target.path);
      op.file("env").recover();
      expect(op.fileReceipt("env")?.published?.identity).toBe(identity);
      expect(readFileSync(receipt.target.path, "utf8")).toBe("new generation\n");
      const next = op.fileReceipt("env")!; writeFileSync(temporary, "pending\n");
      injectReceipt(op, { ...next, pending: { action: "publish", temporary, identity: fileIdentity(temporary)!, hash: digest("pending\n") } });
      const foreign = path.join(root, "foreign"); writeFileSync(foreign, "foreign\n"); renameSync(foreign, receipt.target.path);
      expect(() => op.file("env").recover()).toThrow("PATH_CHANGED");
      expect(readFileSync(receipt.target.path, "utf8")).toBe("foreign\n");
    } finally { op.finish(); }
  });

  test("mixed-role output aliases and an active config target cannot receive two file capabilities", async () => {
    const root = project("a"); const op = await open(root);
    try {
      const duplicate = prepareFileTarget(root, "one.env", "env");
      await expect(op.allocate(allocation(root, "a"), claims("a", 3000), [
        ...targets(root).filter(t => t.role !== "env"), { role: "env", target: duplicate }, { role: "kubeconfig", target: duplicate },
      ])).rejects.toThrow("PATH_CONFLICT");
      await expect(op.allocate(allocation(root, "a"), claims("a", 3000), [
        ...targets(root).filter(t => t.role !== "env"), { role: "env", target: prepareFileTarget(root, "silo.toml", "env") },
      ])).rejects.toThrow("PATH_CONFLICT");
      expect(ProjectOperation.inspect(root, storePath)?.claims).toEqual([]);
    } finally { op.finish(); }
  });

  test("a generation cannot drop a published file role before owner cleanup", async () => {
    const root = project("a"); const op = await open(root);
    try {
      await op.allocate(allocation(root, "a"), claims("a", 3000), [
        ...targets(root), { role: "kubeconfig", target: prepareFileTarget(root, "kubeconfig", "kubeconfig") },
      ]);
      op.file("kubeconfig").publish("owned cluster snapshot\n");
      const before = ProjectOperation.inspect(root, storePath);
      await expect(op.allocate(allocation(root, "a", 3001), claims("a", 3001), targets(root))).rejects.toThrow("CLEANUP_REQUIRED");
      expect(ProjectOperation.inspect(root, storePath)).toEqual(before);
      expect(readFileSync(path.join(root, "kubeconfig"), "utf8")).toBe("owned cluster snapshot\n");
      op.file("kubeconfig").remove();
      await op.allocate(allocation(root, "a", 3001), claims("a", 3001), targets(root));
      expect(op.fileReceipt("kubeconfig")).toBe(null);
      await retire(op);
      expect(ProjectOperation.inspect(root, storePath)?.claims).toEqual([]);
    } finally { op.finish(); }
  });

  test("a folded file claim cannot transfer a receipt to a different path spelling", async () => {
    const root = project("a"); const op = await open(root);
    try {
      await op.allocate(allocation(root, "a"), claims("a", 3000), targets(root));
      op.file("env").publish("owned snapshot\n");
      const before = ProjectOperation.inspect(root, storePath);
      await expect(op.allocate(allocation(root, "a", 3001), claims("a", 3001), [
        ...targets(root).filter(t => t.role !== "env"), { role: "env", target: prepareFileTarget(root, ".LOCALNET.ENV", "env") },
      ])).rejects.toThrow("PATH_CONFLICT");
      expect(ProjectOperation.inspect(root, storePath)).toEqual(before);
      expect(readFileSync(path.join(root, ".localnet.env"), "utf8")).toBe("owned snapshot\n");
    } finally { op.finish(); }
  });

  for (const action of ["publish", "delete"] as const) test(`pending ${action} retains ownership until parent synchronization succeeds on retry`, async () => {
    const root = project("a"); const op = await open(root);
    const synchronize = fs.fsyncSync;
    let failed = false;
    let synchronizedParents = 0;
    try {
      await op.allocate(allocation(root, "a"), claims("a", 3000), targets(root));
      if (action === "delete") op.file("env").publish("owned snapshot\n");
      const fault = spyOn(fs, "fsyncSync").mockImplementation(fd => {
        const parent = fs.fstatSync(fd).isDirectory();
        if (parent && !failed) { failed = true; throw new Error("injected parent fsync failure"); }
        synchronize(fd);
        if (parent) synchronizedParents++;
      });
      try {
        expect(() => action === "publish" ? op.file("env").publish("owned snapshot\n") : op.file("env").remove()).toThrow("injected parent fsync failure");
        expect(existsSync(path.join(root, ".localnet.env"))).toBe(action === "publish");
        expect(ProjectOperation.inspect(root, storePath)?.files.find(f => f.role === "env")?.pending?.action).toBe(action);
        await expect(op.allocate(allocation(root, "a", 3001), claims("a", 3001), targets(root))).rejects.toThrow("INCOMPLETE_EXPORT");
        expect(ProjectOperation.inspect(root, storePath)?.claims).toContainEqual({ domain: "host-port", resource: "3000" });
        op.file("env").recover();
        expect(synchronizedParents).toBe(1);
        expect(ProjectOperation.inspect(root, storePath)?.files.find(f => f.role === "env")?.pending).toBe(null);
        expect(op.fileReceipt("env")?.published === null).toBe(action === "delete");
      } finally { fault.mockRestore(); }
    } finally { op.finish(); }
  });

  for (const failure of ["short write", "interrupted write"] as const) test(`a CI ${failure} remains uncertain and blocks both claim transfer and retirement`, async () => {
    const root = project("a"); const peerRoot = project("b");
    const op = await open(root); const peer = await open(peerRoot);
    const sink = path.join(base, "github.env");
    const write = fs.writeSync;
    try {
      await op.allocate(allocation(root, "a"), claims("a", 3000), targets(root));
      await peer.allocate(allocation(peerRoot, "b", 3001), claims("b", 3001), targets(peerRoot));
      const fault = spyOn(fs, "writeSync").mockImplementation((fd, content) => {
        const bytes = Buffer.from(String(content));
        if (failure === "short write") return write(fd, bytes, 0, 4);
        write(fd, bytes);
        throw new Error("interrupted append");
      });
      try { expect(() => op.appendGithubEnv(sink, "NAME=é\n")).toThrow(failure === "short write" ? "INCOMPLETE_EXPORT" : "interrupted append"); }
      finally { fault.mockRestore(); }
      const expected = failure === "short write" ? "NAME" : "NAME=é\n";
      expect(readFileSync(sink, "utf8")).toBe(expected);
      const before = ProjectOperation.inspect(root, storePath);
      expect(before?.sinks).toHaveLength(1);
      expect(() => peer.appendGithubEnv(sink, "PEER=1\n")).toThrow("PATH_CONFLICT");
      await expect(op.allocate(allocation(root, "a", 3002), claims("a", 3002), targets(root))).rejects.toThrow("CLEANUP_REQUIRED");
      await expect(retire(op)).rejects.toThrow("CLEANUP_REQUIRED");
      expect(ProjectOperation.inspect(root, storePath)).toEqual(before);
      expect(readFileSync(sink, "utf8")).toBe(expected);
    } finally { op.finish(); peer.finish(); }
  });

  test("CI sinks reject snapshot aliases and concurrent writers while sequential appends remain append-only", async () => {
    const a = project("a"); const b = project("b"); const first = await open(a); const second = await open(b);
    const sink = path.join(base, "github.env");
    try {
      await first.allocate(allocation(a, "a"), claims("a", 3000), targets(a)); await second.allocate(allocation(b, "b", 3001), claims("b", 3001), targets(b));
      writeEnvAndLockfile(first);
      const sentinel = readFileSync(first.file("env").path, "utf8");
      expect(() => first.appendGithubEnv(first.file("env").path, "bad\n")).toThrow("PATH_CONFLICT");
      expect(readFileSync(first.file("env").path, "utf8")).toBe(sentinel);
      const target = prepareFileTarget(base, "github.env", "sink"); first.claimSink(target);
      expect(() => second.appendGithubEnv(sink, "peer\n")).toThrow("PATH_CONFLICT");
      first.completeSink(target);
      first.appendGithubEnv(sink, "first\n"); second.appendGithubEnv(sink, "second\n");
      expect(readFileSync(sink, "utf8")).toBe("first\nsecond\n");
      appendGithubEnv(first, path.join(base, "github-export.env"));
      const exported = readFileSync(path.join(base, "github-export.env"), "utf8");
      expect(exported).toContain("APP_PORT=3000\n"); expect(exported).toContain("COMPOSE_PROJECT_NAME=localnet-a\n");
      expect(exported).toContain(`SILO_PROJECT_ID=${first.projectId}\n`); expect(exported).toContain("SILO_GENERATION=1\n");
    } finally { first.finish(); second.finish(); }
  });

  test("real gated commands see the durable grant, and a failed checkpoint never executes a tool", async () => {
    const root = project("a"); const op = await open(root);
    try {
      await op.allocate(allocation(root, "a"), claims("a", 3000), targets(root));
      const code = 'import {Database} from "bun:sqlite"; const db=new Database(process.argv[1],{readonly:true}); const row=db.query("SELECT receipt FROM launches WHERE id=(SELECT id FROM launches ORDER BY rowid DESC LIMIT 1)").get(); console.log(JSON.parse(row.receipt).phase); db.close();';
      const result = await runOwnedCommand(op, [process.execPath, "-e", code, storePath], { kind: "grant-observer", effect: "none", timeoutMs: 5000 });
      expect(result.stdout.trim()).toBe("granted");
      expect(result.launch.groupId).toBe(result.launch.leaderPid);
      expect(result.launch.groupId).not.toBe(result.launch.supervisorPid);
      const db = new Database(storePath);
      db.exec("CREATE TRIGGER fail_grant BEFORE UPDATE ON launches BEGIN SELECT RAISE(FAIL, 'fixture checkpoint failure'); END");
      const canary = path.join(root, "must-not-exist");
      try {
        await expect(startOwnedCommand(op, [process.execPath, "-e", 'await Bun.write(process.argv[1], "executed")', canary], { kind: "refused-grant", effect: "hook", timeoutMs: 5000 })).rejects.toThrow("fixture checkpoint failure");
        expect(existsSync(canary)).toBe(false);
      } finally { db.exec("DROP TRIGGER fail_grant"); db.close(); }
    } finally { op.finish(); }
  }, 15_000);

  const externalAddress = Object.values(os.networkInterfaces()).flat().find(address => address?.family === "IPv4" && !address.internal)?.address;
  for (const hostname of ["127.0.0.1", ...(externalAddress ? [externalAddress] : [])]) test(`a declared listener on ${hostname} blocks retirement and reallocation before snapshots are removed`, async () => {
    const root = project("a");
    const listener = Bun.listen({ hostname, port: 0, socket: { data() {} } });
    const port = listener.port; listener.stop();
    const op = await ProjectOperation.open(root, { storePath, legacyInputs });
    try {
      await op.allocate(allocation(root, "a", port), claims("a", port), targets(root));
      op.file("env").publish("owned sentinel\n");
      const squatter = Bun.serve({ hostname, port, fetch: () => new Response("squatter") });
      try {
        await expect(op.prepareRetirement()).rejects.toThrow("CLEANUP_REQUIRED");
        await expect(op.allocate(allocation(root, "a", port + 1), claims("a", port + 1), targets(root))).rejects.toThrow("CLEANUP_REQUIRED");
        expect(readFileSync(path.join(root, ".localnet.env"), "utf8")).toBe("owned sentinel\n");
        expect(ProjectOperation.inspect(root, storePath)?.claims).toContainEqual({ domain: "host-port", resource: String(port) });
        expect(await (await fetch(`http://${hostname}:${port}`)).text()).toBe("squatter");
      } finally { await squatter.stop(true); }
      const proof = await op.prepareRetirement();
      expect(() => op.planLaunch({ kind: "late-create", command: ["true"], effect: "create" })).toThrow("OPERATION_SEALED");
      expect(() => op.file("env").publish("late write")).toThrow("OPERATION_SEALED");
      op.file("env").remove(); op.retire(proof);
      expect(ProjectOperation.inspect(root, storePath)?.claims).toEqual([]);
    } finally { op.finish(); }
  }, 180_000);

  test("an outgoing connection's local port does not block retirement", async () => {
    const root = project("a");
    const server = net.createServer(() => {});
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const client = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
    try {
      await once(client, "connect");
      const port = client.localPort!;
      const op = await ProjectOperation.open(root, { storePath, legacyInputs });
      try {
        await op.allocate(allocation(root, "a", port), claims("a", port), targets(root));
        op.file("env").publish("owned sentinel\n");
        const proof = await op.prepareRetirement();
        op.file("env").remove(); op.retire(proof);
        expect(ProjectOperation.inspect(root, storePath)?.claims).toEqual([]);
      } finally { op.finish(); }
    } finally { client.destroy(); server.close(); }
  }, 180_000);

  for (const hostname of ["127.0.0.1", "::1"] as const) test(`connected UDP on ${hostname} permits retirement while its peerless peer refuses`, async () => {
    const root = project("udp");
    const sockets = await connectedUdp(hostname);
    const { peer, client } = sockets;
    const op = await ProjectOperation.open(root, { storePath, legacyInputs });
    try {
      await op.allocate(allocation(root, "udp", peer.port), claims("udp", peer.port), targets(root));
      op.file("env").publish("UDP sentinel\n");
      await expect(op.prepareRetirement()).rejects.toThrow("CLEANUP_REQUIRED");
      expect(readFileSync(path.join(root, ".localnet.env"), "utf8")).toBe("UDP sentinel\n");
      expect(ProjectOperation.inspect(root, storePath)?.claims).toContainEqual({ domain: "host-port", resource: String(peer.port) });
      peer.close();
      // A later connection can take an already reserved port; retirement must
      // distinguish that socket from the peerless listener above.
      await op.allocate(allocation(root, "udp", client.port), claims("udp", client.port), targets(root));
      await expect(op.prepareRetirement()).rejects.toThrow("CLEANUP_REQUIRED");
      await sockets.releaseListeners();
      const proof = await op.prepareRetirement();
      op.file("env").remove(); op.retire(proof);
      expect(ProjectOperation.inspect(root, storePath)?.claims).toEqual([]);
      expect(existsSync(path.join(root, ".localnet.env"))).toBe(false);
    } finally { op.finish(); await sockets.close(); }
  }, 180_000);

  for (const failure of ["tcp6 missing", "udp6 missing", "both missing", "malformed row", "read error", "listing error", "incomplete listing"] as const) {
    test(`${failure} retains claims and snapshots on retirement and replacement`, async () => {
      const root = project("uncertain");
      const listenerProbe = failure === "listing error" || failure === "incomplete listing"
        ? createListenerProbe({ platform: "darwin", listSockets: async () => {
          if (failure === "listing error") throw new Error("observation failed");
          return { exitCode: 0, stdout: "p123\0\n", stderr: "" };
        } })
        : createListenerProbe({ platform: "linux", exists: async () => true, readText: async file => {
          if (failure === "read error") throw new Error("observation failed");
          if ((failure === "tcp6 missing" && file.endsWith("tcp6")) ||
              (failure === "udp6 missing" && file.endsWith("udp6")) ||
              (failure === "both missing" && file.endsWith("6"))) throw Object.assign(new Error("missing"), { code: "ENOENT" });
          return "sl local_address rem_address st\n" + (failure === "malformed row" ? "0: 0100007F:C350 00000000:0000\n" : "");
        } });
      const op = await ProjectOperation.open(root, { storePath, legacyInputs, listenerProbe });
      try {
        await op.allocate(allocation(root, "uncertain", 50000), claims("uncertain", 50000), targets(root));
        op.file("env").publish("owned sentinel\n");
        const before = ProjectOperation.inspect(root, storePath);
        await expect(op.prepareRetirement()).rejects.toThrow();
        await expect(op.allocate(allocation(root, "uncertain", 50001), claims("uncertain", 50001), targets(root))).rejects.toThrow();
        expect(ProjectOperation.inspect(root, storePath)).toEqual(before);
        expect(readFileSync(path.join(root, ".localnet.env"), "utf8")).toBe("owned sentinel\n");
      } finally { op.finish(); }
    });
  }

  test("a physically replaced parent cannot redirect owned cleanup", async () => {
    const root = project("a"); const op = await open(root);
    try {
      await op.allocate(allocation(root, "a"), claims("a", 3000), [
        ...targets(root).filter(t => t.role !== "env"), { role: "env", target: prepareFileTarget(root, "output/out.env", "env") },
      ]);
      op.file("env").publish("owner\n");
      renameSync(path.join(root, "output"), path.join(root, "saved")); mkdirSync(path.join(root, "output")); writeFileSync(path.join(root, "output/out.env"), "peer\n");
      expect(() => op.file("env").remove()).toThrow("PATH_CHANGED");
      expect(readFileSync(path.join(root, "output/out.env"), "utf8")).toBe("peer\n");
      expect(readFileSync(path.join(root, "saved/out.env"), "utf8")).toBe("owner\n");
    } finally { op.finish(); }
  });
});
