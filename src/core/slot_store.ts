import type { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { SiloError } from "../utils/errors";
import { queuedDefaults, resolveSlotCap, type SlotCap } from "./host_caps";
import { hasSlotTables, openDatabase } from "./lease_store";
import { probeProcess, recordedProcessLiveness, type Liveness } from "./process_identity";
import {
  MAX_SLOT_RUNS, SlotCompletionSchema, SlotRunSchema,
  type HeldSlotRun, type HostCaps, type SlotCompletion, type SlotGrant, type SlotLaunch, type SlotName, type SlotRun,
} from "./slot_types";

type RunRow = { ticket: number; receipt: string; completion: string | null };

/** One durable queue row. `revision` is the stored receipt text a peer release must still match. */
export type QueuedRun = { ticket: number; run: SlotRun; revision: string; completion: SlotCompletion | null };

export type GrantDecision =
  | { kind: "grant"; units: ReadonlyMap<SlotName, number> }
  | { kind: "wait"; slot: SlotName; cap: number; held: number; ahead: number; holders: readonly QueuedRun[] };

const holdsSlot = (queued: QueuedRun, slot: SlotName): boolean =>
  queued.run.phase === "held" && queued.run.grants.some(grant => grant.slot === slot);

const requestsSlot = (queued: QueuedRun, slot: SlotName): boolean =>
  queued.run.requests.some(request => request.slot === slot);

/**
 * FIFO, all-or-none. A ticket takes a unit of a slot only while more units are
 * free than earlier waiting tickets need from that slot, so a later run never
 * overtakes an earlier one on a slot both want, and a multi-slot run is granted
 * every slot at once or none.
 */
export const decideGrant = (caps: ReadonlyMap<SlotName, number>, runs: readonly QueuedRun[], ticket: number, slots: readonly SlotName[]): GrantDecision => {
  const units = new Map<SlotName, number>();
  for (const slot of slots) {
    const cap = caps.get(slot);
    assert(cap !== undefined && cap >= 1, `Slot ${slot} has a resolved cap`);
    const holders = runs.filter(queued => holdsSlot(queued, slot));
    const held = new Set(holders.flatMap(queued => queued.run.phase === "held" ? queued.run.grants.filter(g => g.slot === slot).map(g => g.unit) : []));
    const ahead = runs.filter(queued => queued.ticket < ticket && queued.run.phase === "waiting" && requestsSlot(queued, slot)).length;
    // Units at or above a lowered cap still count as held.
    if (cap - held.size <= ahead) return { kind: "wait", slot, cap, held: held.size, ahead, holders };
    let unit = 0;
    while (held.has(unit)) unit += 1;
    assert(unit < cap, "A free unit exists below the cap");
    units.set(slot, unit);
  }
  return { kind: "grant", units };
};

export type GrantAttempt =
  | { kind: "granted"; run: HeldSlotRun }
  | { kind: "unavailable"; slot: SlotName; cap: Extract<SlotCap, { kind: "off" | "none" }> }
  | { kind: "waiting"; decision: Extract<GrantDecision, { kind: "wait" }> }
  // Port blocks are probed outside the store lock; the transaction only checks claims.
  | { kind: "needs-ports"; claimed: ReadonlySet<number> };

/**
 * Release by a contender: every recorded process is proved absent (ESRCH, or
 * a readable start identity that differs from the recorded one) and the
 * executor group has no member. Anything else keeps the claim.
 */
export const runLiveness = async (run: SlotRun): Promise<Liveness> => {
  const waiter = await recordedProcessLiveness(run.waiter);
  if (waiter === "live" || run.phase === "waiting" || run.launch === null) return waiter;
  const supervisor = await recordedProcessLiveness(run.launch.supervisor);
  if (supervisor === "live") return "live";
  const group = probeProcess(-run.launch.groupId);
  if (group === "exists") return "live";
  if (group === "uncertain") return "unknown";
  return waiter === "absent" && supervisor === "absent" ? "absent" : "unknown";
};

/** Status observes with signals only (ESRCH), never `ps`, and never releases. */
export const runEndedByEsrch = (run: SlotRun): boolean => {
  if (probeProcess(run.waiter.pid) !== "absent") return false;
  if (run.phase === "waiting" || run.launch === null) return true;
  return probeProcess(run.launch.supervisor.pid) === "absent" && probeProcess(-run.launch.groupId) === "absent";
};

const parseRow = (row: RunRow): QueuedRun => ({
  ticket: row.ticket, run: SlotRunSchema.parse(JSON.parse(row.receipt)), revision: row.receipt,
  completion: row.completion === null ? null : SlotCompletionSchema.parse(JSON.parse(row.completion)),
});

const selectRuns = (db: Database): QueuedRun[] => {
  const rows = db.query<RunRow, [number]>("SELECT ticket, receipt, completion FROM slot_runs ORDER BY ticket LIMIT ?").all(MAX_SLOT_RUNS + 1);
  if (rows.length > MAX_SLOT_RUNS) throw new SiloError("STORE_FULL: slot queue exceeds its row limit", "STORE_FULL");
  return rows.map(parseRow);
};

const selectRun = (db: Database, runId: string): QueuedRun | null => {
  const row = db.query<RunRow, [string]>("SELECT ticket, receipt, completion FROM slot_runs WHERE id = ?").get(runId);
  return row ? parseRow(row) : null;
};

// Only reached through a slot connection, which guarantees the slot tables.
const claimedPorts = (db: Database): Set<number> => new Set([
  ...db.query<{ resource: string }, []>("SELECT resource FROM claims WHERE domain = 'host-port'").all().map(row => Number(row.resource)),
  ...db.query<{ port: number }, []>("SELECT port FROM slot_ports").all().map(row => row.port),
]);

/**
 * The host-wide slot queue in the account store. Each call opens, uses and
 * closes its own connection, so a run holds no connection while it waits or
 * while its command runs.
 */
export class SlotQueue {
  constructor(readonly storePath: string) {}

  private write<T>(work: (db: Database) => T): T {
    const db = openDatabase(this.storePath, false, true, undefined, true);
    try { return db.transaction(() => work(db)).immediate(); }
    finally { db.close(); }
  }

  runs(): QueuedRun[] {
    return this.write(selectRuns);
  }

  enqueue(run: Extract<SlotRun, { phase: "waiting" }>): number {
    return this.write(db => {
      const count = db.query<{ count: number }, []>("SELECT count(*) AS count FROM slot_runs").get()!.count;
      if (count >= MAX_SLOT_RUNS) throw new SiloError("STORE_FULL: the slot queue is full; inspect silo status", "STORE_FULL");
      const result = db.query("INSERT INTO slot_runs (id, receipt) VALUES (?, ?)").run(run.id, JSON.stringify(SlotRunSchema.parse(run)));
      return Number(result.lastInsertRowid);
    });
  }

  /**
   * Grants every requested unit and port block in one transaction, or nothing.
   * Caps resolve here, against the queue this transaction reads.
   */
  attemptGrant(runId: string, host: HostCaps, blocks: ReadonlyMap<SlotName, readonly number[]>, grantedAt: string): GrantAttempt {
    return this.write((db): GrantAttempt => {
      const runs = selectRuns(db);
      const self = runs.find(queued => queued.run.id === runId);
      if (self?.run.phase !== "waiting") throw new SiloError(`STALE_SLOT_RUN: run ${runId} is no longer waiting`, "STALE_SLOT_RUN");
      const waiting = self.run;
      const caps = new Map<SlotName, number>();
      for (const { slot } of waiting.requests) {
        const cap = resolveSlotCap(host, slot, queuedDefaults(runs, slot));
        if (cap.kind === "off" || cap.kind === "none") return { kind: "unavailable", slot, cap };
        caps.set(slot, cap.cap);
      }
      const decision = decideGrant(caps, runs, self.ticket, waiting.requests.map(request => request.slot));
      if (decision.kind === "wait") return { kind: "waiting", decision };
      const claimed = claimedPorts(db);
      const grants: SlotGrant[] = [];
      for (const request of waiting.requests) {
        const ports = request.ports === 0 ? [] : blocks.get(request.slot);
        if (ports === undefined || ports.length !== request.ports || ports.some(port => claimed.has(port))) return { kind: "needs-ports", claimed };
        grants.push({ slot: request.slot, unit: decision.units.get(request.slot)!, ports: [...ports] });
      }
      const allPorts = grants.flatMap(grant => grant.ports);
      assert(new Set(allPorts).size === allPorts.length, "Port blocks of one run are disjoint");
      const held: HeldSlotRun = { ...waiting, phase: "held", grants, grantedAt, launch: null };
      for (const grant of grants) {
        db.query("INSERT INTO slot_units (slot, unit, run_id) VALUES (?, ?, ?)").run(grant.slot, grant.unit, runId);
        for (const port of grant.ports) db.query("INSERT INTO slot_ports (port, run_id) VALUES (?, ?)").run(port, runId);
      }
      db.query("UPDATE slot_runs SET receipt = ? WHERE id = ?").run(JSON.stringify(SlotRunSchema.parse(held)), runId);
      return { kind: "granted", run: held };
    });
  }

  /** Records the verified executor group as the holder before the grant reaches it. */
  recordLaunch(runId: string, launch: SlotLaunch): HeldSlotRun {
    return this.write(db => {
      const queued = selectRun(db, runId);
      if (queued?.run.phase !== "held" || queued.run.launch !== null) throw new SiloError(`STALE_SLOT_RUN: run ${runId} no longer holds its units`, "STALE_SLOT_RUN");
      const held: HeldSlotRun = { ...queued.run, launch };
      db.query("UPDATE slot_runs SET receipt = ? WHERE id = ?").run(JSON.stringify(SlotRunSchema.parse(held)), runId);
      return held;
    });
  }

  /**
   * Deletes the run with its units and port blocks. A contender passes the
   * revision it proved absent; a changed row is kept.
   */
  release(runId: string, revision: string | null = null): boolean {
    return this.write(db => {
      const queued = selectRun(db, runId);
      if (!queued || (revision !== null && queued.revision !== revision)) return false;
      db.query("DELETE FROM slot_ports WHERE run_id = ?").run(runId);
      db.query("DELETE FROM slot_units WHERE run_id = ?").run(runId);
      db.query("DELETE FROM slot_runs WHERE id = ?").run(runId);
      return true;
    });
  }

  /** The durable fact once the group has ended; waits on the store lock like any write. */
  recordedCompletion(runId: string): SlotCompletion | null {
    return this.write(db => selectRun(db, runId)?.completion ?? null);
  }

  /** A read that never waits on the store lock; a locked store yields no fact for this poll. */
  completion(runId: string): SlotCompletion | null {
    const db = openDatabase(this.storePath, true, false, 0);
    try { return selectRun(db, runId)?.completion ?? null; }
    finally { db.close(); }
  }

  /** Read-only: a missing store or a format-3 store holds no slot run. */
  static inspect(storePath: string): QueuedRun[] {
    if (!existsSync(storePath)) return [];
    const db = openDatabase(storePath, true);
    try { return hasSlotTables(db) ? db.transaction(() => selectRuns(db))() : []; }
    finally { db.close(); }
  }

  /** The executor's check that its group is the recorded holder of this run. */
  static recordedHolder(storePath: string, runId: string, leaderPid: number): HeldSlotRun {
    const db = openDatabase(storePath, true);
    try {
      const run = hasSlotTables(db) ? selectRun(db, runId)?.run : undefined;
      if (run?.phase !== "held" || run.launch?.leaderPid !== leaderPid || run.launch.groupId !== leaderPid) {
        throw new SiloError("Slot executor is not the recorded holder of its run", "STALE_EXECUTOR");
      }
      return run;
    } finally { db.close(); }
  }

  /** Written once by the holder's executor; a repeat must agree with the first fact. */
  static recordCompletion(storePath: string, fact: SlotCompletion): void {
    const completion = SlotCompletionSchema.parse(fact);
    const db = openDatabase(storePath, false, false);
    try {
      db.transaction(() => {
        const queued = selectRun(db, completion.runId);
        const launch = queued?.run.phase === "held" ? queued.run.launch : null;
        if (!queued || launch?.leaderPid !== completion.leaderPid || launch.groupId !== completion.groupId) {
          throw new SiloError("Slot completion does not match the recorded holder", "STALE_EXECUTOR");
        }
        if (queued.completion) {
          assert.deepEqual([queued.completion.started, queued.completion.exitCode, queued.completion.failedStep], [completion.started, completion.exitCode, completion.failedStep], "Slot completion is immutable");
          return;
        }
        db.query("UPDATE slot_runs SET completion = ? WHERE id = ?").run(JSON.stringify(completion), completion.runId);
      }).immediate();
    } finally { db.close(); }
  }
}
