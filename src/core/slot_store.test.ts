import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ProjectOperation } from "./lease_store";
import { prepareFileTarget } from "./file_target";
import { SlotQueue, decideGrant, runLiveness, type QueuedRun } from "./slot_store";
import { SlotNameSchema, type SlotName, type SlotRun } from "./slot_types";
import { processIdentity } from "./process_identity";
import type { Allocation } from "./lease_types";

const slot = (name: string): SlotName => SlotNameSchema.parse(name);
const A = slot("slot-a");
const B = slot("slot-b");

let base: string;
let storePath: string;
let selfIdentity: string;

beforeEach(async () => {
  base = mkdtempSync(path.join(os.tmpdir(), "silo-slots-"));
  storePath = path.join(base, "store", "leases.sqlite");
  selfIdentity = (await processIdentity(process.pid))!;
});
afterEach(() => rmSync(base, { recursive: true }));

const waiting = (requests: { slot: SlotName; ports?: number }[], waiter = { pid: process.pid, identity: selfIdentity }): Extract<SlotRun, { phase: "waiting" }> => ({
  phase: "waiting", id: randomUUID(), root: base, command: ["true"],
  requests: requests.map(r => ({ slot: r.slot, ports: r.ports ?? 0 })), waiter, enqueuedAt: "2026-11-16T00:00:00Z",
});

const queued = (ticket: number, run: SlotRun): QueuedRun => ({ ticket, run, revision: JSON.stringify(run), completion: null });
const held = (ticket: number, grants: { slot: SlotName; unit: number }[]): QueuedRun => queued(ticket, {
  ...waiting(grants.map(g => ({ slot: g.slot }))), phase: "held", grants: grants.map(g => ({ ...g, ports: [] })), grantedAt: "2026-11-16T00:00:00Z", launch: null,
});

describe("decideGrant", () => {
  test("grants the lowest free unit up to the cap and then waits", () => {
    const caps = new Map([[A, 2]]);
    expect(decideGrant(caps, [], 1, [A])).toEqual({ kind: "grant", units: new Map([[A, 0]]) });
    expect(decideGrant(caps, [held(1, [{ slot: A, unit: 0 }])], 2, [A])).toEqual({ kind: "grant", units: new Map([[A, 1]]) });
    const full = decideGrant(caps, [held(1, [{ slot: A, unit: 0 }]), held(2, [{ slot: A, unit: 1 }])], 3, [A]);
    expect(full.kind === "wait" && [full.slot, full.held, full.cap]).toEqual([A, 2, 2]);
  });

  test("a later ticket never overtakes an earlier waiter on a slot both want", () => {
    const caps = new Map([[A, 1], [B, 1]]);
    // Ticket 2 waits for {A, B} because B is held; A is free but reserved for it.
    const runs = [held(1, [{ slot: B, unit: 0 }]), queued(2, waiting([{ slot: A }, { slot: B }]))];
    const decision = decideGrant(caps, runs, 3, [A]);
    expect(decision.kind === "wait" && [decision.slot, decision.held, decision.ahead]).toEqual([A, 0, 1]);
  });

  test("a multi-slot run is granted every slot or none", () => {
    const caps = new Map([[A, 1], [B, 1]]);
    expect(decideGrant(caps, [held(1, [{ slot: B, unit: 0 }])], 2, [A, B]).kind).toBe("wait");
    expect(decideGrant(caps, [], 2, [A, B])).toEqual({ kind: "grant", units: new Map([[A, 0], [B, 0]]) });
  });

  test("units held above a lowered cap still count against it", () => {
    const decision = decideGrant(new Map([[A, 1]]), [held(1, [{ slot: A, unit: 1 }])], 2, [A]);
    expect(decision.kind === "wait" && decision.held).toBe(1);
  });
});

describe("SlotQueue", () => {
  test("grants in ticket order and releases units with the run", () => {
    const queue = new SlotQueue(storePath);
    const caps = new Map([[A, 1]]);
    const first = waiting([{ slot: A }]);
    const second = waiting([{ slot: A }]);
    queue.enqueue(first);
    queue.enqueue(second);
    expect(queue.attemptGrant(second.id, caps, new Map(), "t").kind).toBe("waiting");
    const granted = queue.attemptGrant(first.id, caps, new Map(), "t");
    expect(granted.kind === "granted" && granted.run.grants).toEqual([{ slot: A, unit: 0, ports: [] }]);
    expect(queue.attemptGrant(second.id, caps, new Map(), "t").kind).toBe("waiting");
    expect(queue.release(first.id)).toBe(true);
    expect(queue.attemptGrant(second.id, caps, new Map(), "t").kind).toBe("granted");
  });

  test("a peer release only removes the exact revision it proved absent", () => {
    const queue = new SlotQueue(storePath);
    const run = waiting([{ slot: A }]);
    queue.enqueue(run);
    expect(queue.release(run.id, "stale revision")).toBe(false);
    expect(SlotQueue.inspect(storePath).map(q => q.run.id)).toEqual([run.id]);
  });

  test("slot port blocks and generation port claims are one host-port domain", async () => {
    const queue = new SlotQueue(storePath);
    const caps = new Map([[A, 1]]);
    const run = waiting([{ slot: A, ports: 2 }]);
    queue.enqueue(run);
    expect(queue.attemptGrant(run.id, caps, new Map(), "t").kind).toBe("needs-ports");
    expect(queue.attemptGrant(run.id, caps, new Map([[A, [40100, 40101]]]), "t").kind).toBe("granted");

    const root = path.join(base, "project");
    mkdirSync(root);
    writeFileSync(path.join(root, "silo.toml"), "version = 1\n[ports]\nAPP_PORT = 40101\n");
    const owner = await ProjectOperation.open(root, { storePath, legacyInputs: { accountHome: path.join(base, "account"), home: path.join(base, "home"), registryDir: undefined }, listenerProbe: async () => true });
    try {
      expect(owner.excludedPorts().has(40101)).toBe(true);
      const allocation: Allocation = {
        state: { name: "p", ports: { APP_PORT: 40101 }, createdAt: "t", k3dClusterCreated: false,
          identity: { name: "p", prefix: "localnet", composeName: "localnet-p", dockerNetwork: "localnet-p", volumePrefix: "localnet-p", containerPrefix: "localnet-p-", hosts: { APP_HOST: "p.localhost" } } },
        configPath: path.join(root, "silo.toml"), configSource: "", fingerprint: "f", urls: {}, k3dArgs: [], hostOrder: ["APP_HOST"], portOrder: ["APP_PORT"], urlOrder: [], engine: null,
      };
      const targets = [
        { role: "env" as const, target: prepareFileTarget(root, ".localnet.env", "env") },
        { role: "lock" as const, target: prepareFileTarget(root, ".silo.lock", "lock") },
        { role: "config" as const, target: prepareFileTarget(root, "silo.toml", "config") },
      ];
      await expect(owner.allocate(allocation, [{ domain: "host-port", resource: "40101" }], targets)).rejects.toThrow("PORT_CLAIM_CONFLICT");
      await owner.allocate({ ...allocation, state: { ...allocation.state, ports: { APP_PORT: 40102 } } }, [{ domain: "host-port", resource: "40102" }], targets);
    } finally { owner.finish(); }

    const second = waiting([{ slot: A, ports: 1 }]);
    queue.release(run.id);
    queue.enqueue(second);
    const lost = queue.attemptGrant(second.id, caps, new Map([[A, [40102]]]), "t");
    expect(lost.kind === "needs-ports" && lost.claimed.has(40102)).toBe(true);
  });

  test("project-only use keeps a format-3 store; the first slot run upgrades it", async () => {
    const version = () => {
      const db = new Database(storePath, { readonly: true });
      try { return db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version; }
      finally { db.close(); }
    };
    const root = path.join(base, "project-only");
    mkdirSync(root);
    const legacyInputs = { accountHome: path.join(base, "account"), home: path.join(base, "home"), registryDir: undefined };
    (await ProjectOperation.open(root, { storePath, legacyInputs })).finish();
    expect(version()).toBe(3);
    expect(SlotQueue.inspect(storePath)).toEqual([]);
    (await ProjectOperation.open(root, { storePath, legacyInputs })).finish();
    expect(version()).toBe(3);
    const run = waiting([{ slot: A }]);
    new SlotQueue(storePath).enqueue(run);
    expect(version()).toBe(4);
    expect(SlotQueue.inspect(storePath).map(q => q.run.id)).toEqual([run.id]);
    (await ProjectOperation.open(root, { storePath, legacyInputs })).finish();
    expect(version()).toBe(4);
  });
});

describe("runLiveness", () => {
  test("a live waiter with its recorded identity is live", async () => {
    expect(await runLiveness(waiting([{ slot: A }]))).toBe("live");
  });

  test("a PID reused by an unrelated process is absent", async () => {
    const unrelated = Bun.spawn(["sleep", "30"], { stdout: "ignore", stderr: "ignore" });
    try {
      const run = waiting([{ slot: A }], { pid: unrelated.pid, identity: "501 1 Mon Jan  1 00:00:00 2024 silo run" });
      expect(await runLiveness(run)).toBe("absent");
    } finally { unrelated.kill("SIGKILL"); await unrelated.exited; }
  });

  test("an exited waiter is absent", async () => {
    const ended = Bun.spawn(["true"]);
    await ended.exited;
    expect(await runLiveness(waiting([{ slot: A }], { pid: ended.pid, identity: "anything" }))).toBe("absent");
  });

  test("a held run whose supervisor PID now names an unrelated process is absent", async () => {
    const unrelated = Bun.spawn(["sleep", "30"], { stdout: "ignore", stderr: "ignore" });
    const ended = Bun.spawn(["true"]);
    await ended.exited;
    try {
      const run: SlotRun = {
        ...waiting([{ slot: A }], { pid: ended.pid, identity: "gone" }), phase: "held",
        grants: [{ slot: A, unit: 0, ports: [] }], grantedAt: "t",
        launch: { supervisor: { pid: unrelated.pid, identity: "501 1 Thu Jan  1 00:00:00 2026 janitor" }, leaderPid: ended.pid, groupId: ended.pid },
      };
      expect(await runLiveness(run)).toBe("absent");
    } finally { unrelated.kill("SIGKILL"); await unrelated.exited; }
  });

  test("a PID another account now owns is compared by identity, not treated as unknown", async () => {
    // A root-owned process answers a null signal with EPERM for this account.
    const listing = Bun.spawnSync(["ps", "-axo", "pid=,uid="], { stdout: "pipe" }).stdout.toString();
    const rootPid = listing.split("\n").map(line => line.trim().split(/\s+/).map(Number)).find(([pid, uid]) => uid === 0 && pid! > 1)?.[0];
    expect(rootPid).toBeDefined();
    expect(await runLiveness(waiting([{ slot: A }], { pid: rootPid!, identity: selfIdentity }))).toBe("absent");
  });

  test("a held run stays live while its executor group has a member", async () => {
    const member = Bun.spawn(["sleep", "30"], { detached: true, stdout: "ignore", stderr: "ignore" });
    try {
      const ended = Bun.spawn(["true"]);
      await ended.exited;
      const run: SlotRun = {
        ...waiting([{ slot: A }], { pid: ended.pid, identity: "gone" }), phase: "held",
        grants: [{ slot: A, unit: 0, ports: [] }], grantedAt: "t",
        launch: { supervisor: { pid: ended.pid, identity: "gone" }, leaderPid: member.pid, groupId: member.pid },
      };
      expect(await runLiveness(run)).toBe("live");
      member.kill("SIGKILL");
      await member.exited;
      expect(await runLiveness(run)).toBe("absent");
    } finally { if (member.exitCode === null && member.signalCode === null) member.kill("SIGKILL"); }
  });
});
