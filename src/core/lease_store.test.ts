import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProjectOperation, digest } from "./lease_store";
import { fileIdentity, prepareFileTarget } from "./file_target";
import { appendGithubEnv, writeEnvAndLockfile } from "./env";
import { runOwnedCommand, startOwnedCommand } from "./owned_command";
import type { Allocation, Claim, FileReceipt } from "./lease_types";

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
const open = (root: string, recover = false) => ProjectOperation.open(root, { storePath, legacyInputs, recover, portProbe: async () => true });
const retire = async (owner: ProjectOperation) => owner.retire(await owner.prepareRetirement());
const injectReceipt = (owner: ProjectOperation, receipt: FileReceipt) => {
  const db = new Database(storePath);
  try { db.query("UPDATE files SET receipt = ? WHERE project_id = ? AND generation = ? AND role = ?").run(JSON.stringify(receipt), owner.projectId, owner.generation, receipt.role); }
  finally { db.close(); }
};
const claims = (name: string, port: number): Claim[] => [
  { domain: "instance-name", resource: name }, { domain: "host-port", resource: String(port) },
];

describe("atomic account leases", () => {
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

  test("a failed creating tool keeps its port, even after its executor is absent", async () => {
    const root = project("a"); const op = await open(root);
    try {
      await op.allocate(allocation(root, "a"), claims("a", 3000), targets(root));
      await expect(runOwnedCommand(op, ["/bin/sh", "-c", "exit 17"], { kind: "uncertain-create", effect: "create", timeoutMs: 5000 })).rejects.toThrow("COMMAND_FAILED");
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
      await expect(runOwnedCommand(op, ["/bin/sh", "-c", "printf executed > must-not-exist"], {
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
        await expect(runOwnedCommand(op, [process.execPath, "-e", 'await Bun.write(process.argv[1], "executed")', canary], { kind: "refused-grant", effect: "hook", timeoutMs: 5000 })).rejects.toThrow("fixture checkpoint failure");
        expect(existsSync(canary)).toBe(false);
      } finally { db.exec("DROP TRIGGER fail_grant"); db.close(); }
    } finally { op.finish(); }
  }, 15_000);

  test("a declared listener blocks both retirement and reallocation before snapshots are removed", async () => {
    const root = project("a");
    const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = listener.port; listener.stop();
    const op = await ProjectOperation.open(root, { storePath, legacyInputs });
    try {
      await op.allocate(allocation(root, "a", port), claims("a", port), targets(root));
      op.file("env").publish("owned sentinel\n");
      const squatter = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("squatter") });
      try {
        await expect(op.prepareRetirement()).rejects.toThrow("CLEANUP_REQUIRED");
        await expect(op.allocate(allocation(root, "a", port + 1), claims("a", port + 1), targets(root))).rejects.toThrow("CLEANUP_REQUIRED");
        expect(readFileSync(path.join(root, ".localnet.env"), "utf8")).toBe("owned sentinel\n");
        expect(ProjectOperation.inspect(root, storePath)?.claims).toContainEqual({ domain: "host-port", resource: String(port) });
        expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe("squatter");
      } finally { await squatter.stop(true); }
      const proof = await op.prepareRetirement();
      expect(() => op.planLaunch({ kind: "late-create", command: ["true"], effect: "create" })).toThrow("OPERATION_SEALED");
      expect(() => op.file("env").publish("late write")).toThrow("OPERATION_SEALED");
      op.file("env").remove(); op.retire(proof);
      expect(ProjectOperation.inspect(root, storePath)?.claims).toEqual([]);
    } finally { op.finish(); }
  });

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
