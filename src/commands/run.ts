import { randomUUID } from "node:crypto";
import { loadConfig } from "../core/config";
import { assertNoLegacyState } from "../core/legacy_check";
import { accountStorePath } from "../core/allocation_domain";
import { hostConfigPath, readHostCaps } from "../core/host_caps";
import { startGate } from "../core/owned_command";
import { findPortBlock, livePortSpace, type PortSpace } from "../core/ports";
import { probeProcess, processIdentity } from "../core/process_identity";
import { SlotQueue, runLiveness, type GrantAttempt, type GrantDecision, type QueuedRun } from "../core/slot_store";
import {
  MAX_RUN_SLOTS, SlotNameSchema, renderSlotValue,
  type HeldSlotRun, type HostCaps, type SlotCompletion, type SlotConfig, type SlotExecutorGrant, type SlotGrant, type SlotName, type SlotRequest,
} from "../core/slot_types";
import { TILT_DRAIN_GRACE_MS } from "../core/constants";
import { SiloError } from "../utils/errors";
import { logger } from "../utils/logger";
import { sleep } from "../utils/sleep";
import { commandRoot } from "./prepare";

const POLL_MS_MIN = 50;
const POLL_MS_MAX = 1000;
const MAX_PORT_RACES = 64;
// Janitor's drain grace plus margin for the group to leave the process table.
const GROUP_EXIT_TIMEOUT_MS = TILT_DRAIN_GRACE_MS + 5000;
const MAX_WAIT_MS = 7 * 24 * 60 * 60 * 1000;

/** Exit status for a bounded wait that ran out (EX_TEMPFAIL). */
const SLOT_WAIT_TIMEOUT_EXIT = 75;
/** Exit status for a slot this project or host does not provide. */
const SLOT_UNAVAILABLE_EXIT = 2;

type RunOptions = {
  config: string;
  slots: readonly string[];
  wait: string | undefined;
  command: readonly string[];
  json: boolean;
  executorEntrypoint: string;
  signal: AbortSignal | undefined;
};

type RunResult = {
  schemaVersion: 1;
  run: {
    id: string; root: string; command: string[];
    slots: SlotGrant[];
    waitedMs: number; exitCode: number;
    // False when the group outlived the release window; a later contender releases it.
    released: boolean;
  };
};

/** `500ms`, `30s`, `5m`, `2h`; a bare number is seconds. */
const parseWait = (value: string): number => {
  const match = /^(\d+)(ms|s|m|h)?$/.exec(value.trim());
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match?.[2] ?? "s"];
  const amount = Number(match?.[1]);
  if (!match || unit === undefined || !Number.isSafeInteger(amount * unit) || amount * unit > MAX_WAIT_MS) {
    throw new SiloError(`INVALID_ARGUMENT: --wait takes a duration such as 30s, 5m or 2h (at most 7 days), got '${value}'`, "INVALID_ARGUMENT");
  }
  return amount * unit;
};

const unavailable = (slot: string, where: string): SiloError => new SiloError(
  `SLOT_UNAVAILABLE: slot '${slot}' is not ${where}`, "SLOT_UNAVAILABLE", { details: { slot, exitCode: SLOT_UNAVAILABLE_EXIT } },
);

type Plan = { root: string; requests: SlotRequest[]; configs: ReadonlyMap<SlotName, SlotConfig> };

const notCapped = (slot: string): SiloError => unavailable(slot, `capped on this host; add it under [slots] in ${hostConfigPath()}`);

/** Caps are re-read for every grant attempt, so an operator's change applies to queued runs. */
const currentCaps = (slots: readonly SlotName[]): HostCaps => {
  const caps = readHostCaps();
  const missing = slots.find(slot => !caps.has(slot));
  if (missing !== undefined) throw notCapped(missing);
  return caps;
};

/** Every refusal here happens before any store effect. */
const plan = async (options: RunOptions): Promise<Plan> => {
  if (options.command.length === 0) throw new SiloError("INVALID_ARGUMENT: silo run needs a command after --", "INVALID_ARGUMENT");
  if (options.slots.length === 0) throw new SiloError("INVALID_ARGUMENT: silo run needs at least one --slot", "INVALID_ARGUMENT");
  if (options.slots.length > MAX_RUN_SLOTS) throw new SiloError(`INVALID_ARGUMENT: at most ${MAX_RUN_SLOTS} --slot values`, "INVALID_ARGUMENT");
  if (new Set(options.slots).size !== options.slots.length) throw new SiloError("INVALID_ARGUMENT: each --slot may be named once; a run holds one unit of each", "INVALID_ARGUMENT");
  const config = await loadConfig(options.config);
  const configs = new Map<SlotName, SlotConfig>();
  for (const name of [...options.slots].sort()) {
    const slot = SlotNameSchema.safeParse(name);
    const declared = slot.success ? config.slots[slot.data] : undefined;
    if (!slot.success || declared === undefined) throw unavailable(name, `declared in ${config.configPath} ([slots.${name}])`);
    configs.set(slot.data, declared);
  }
  currentCaps([...configs.keys()]);
  const keys = [...configs.values()].flatMap(slot => Object.keys(slot.env));
  if (new Set(keys).size !== keys.length) throw new SiloError("INVALID_CONFIG: the requested slots inject the same env variable", "INVALID_CONFIG");
  return {
    root: commandRoot(options.config), configs,
    requests: [...configs.entries()].map(([slot, declared]) => ({ slot, ports: declared.ports })),
  };
};

const holderLabel = (queued: QueuedRun | undefined, slot: SlotName): string => {
  if (queued?.run.phase !== "held") return "";
  const unit = queued.run.grants.find(grant => grant.slot === slot)?.unit;
  return `#${unit} ${queued.run.root} pid ${queued.run.waiter.pid}`;
};

const waitingMessage = (decision: Extract<GrantDecision, { kind: "wait" }>): string => {
  const next = decision.held >= decision.cap
    ? `next: ${holderLabel(decision.holders[0], decision.slot)}`
    : `${decision.ahead} earlier run${decision.ahead === 1 ? "" : "s"} waiting`;
  return `waiting for ${decision.slot} (${decision.held}/${decision.cap} held; ${next})`;
};

// Rows of other slots a pass may also inspect, so crashed runs of a slot
// nobody requests do not hold port blocks forever.
const MAX_SWEEP_PER_PASS = 8;

/**
 * Releases rows whose every recorded process is proved absent: contending
 * peers on this run's slots first, then a bounded sweep of other rows whose
 * waiter no longer answers a null signal. Uncertain liveness keeps the row,
 * and the waiter says so once per row.
 */
const releaseAbsentPeers = async (queue: SlotQueue, runId: string, slots: readonly SlotName[], reported: Set<string>): Promise<void> => {
  const runs = queue.runs();
  const self = runs.find(queued => queued.run.id === runId);
  if (!self) return;
  const contends = (queued: QueuedRun) => queued.run.requests.some(request => slots.includes(request.slot)) &&
    (queued.run.phase === "held" || queued.ticket < self.ticket);
  const peers = runs.filter(queued => queued.run.id !== runId);
  const contending = peers.filter(contends);
  const sweep = peers.filter(queued => !contends(queued) && probeProcess(queued.run.waiter.pid) !== "exists").slice(0, MAX_SWEEP_PER_PASS);
  for (const peer of [...contending, ...sweep]) {
    const liveness = await runLiveness(peer.run);
    if (liveness === "absent" && queue.release(peer.run.id, peer.revision)) {
      logger.progress(`released ${peer.run.phase === "held" ? "slot units" : "the queue ticket"} of ended run ${peer.run.id} (${peer.run.root})`);
    } else if (liveness === "unknown" && contends(peer) && !reported.has(peer.run.id)) {
      reported.add(peer.run.id);
      logger.progress(`keeping the claim of run ${peer.run.id} (${peer.run.root}, pid ${peer.run.waiter.pid}): its liveness is uncertain (permission denied or identity unreadable); inspect that PID`);
    }
  }
};

const choosePorts = async (requests: readonly SlotRequest[], claimed: ReadonlySet<number>, space: PortSpace): Promise<Map<SlotName, number[]>> => {
  const excluded = new Set(claimed);
  const blocks = new Map<SlotName, number[]>();
  for (const request of requests.filter(r => r.ports > 0)) {
    const block = await findPortBlock({ size: request.ports, space, excluded });
    block.forEach(port => excluded.add(port));
    blocks.set(request.slot, block);
  }
  return blocks;
};

const waitForGrant = async (queue: SlotQueue, runId: string, planned: Plan, waitMs: number | null, signal: AbortSignal | undefined): Promise<HeldSlotRun> => {
  const deadline = waitMs === null ? null : Date.now() + waitMs;
  const slots = planned.requests.map(request => request.slot);
  const space = planned.requests.some(request => request.ports > 0) ? livePortSpace() : null;
  let blocks = new Map<SlotName, number[]>();
  let lastMessage = "";
  let delay = POLL_MS_MIN;
  let portRaces = 0;
  const reported = new Set<string>();
  for (;;) {
    signal?.throwIfAborted();
    await releaseAbsentPeers(queue, runId, slots, reported);
    const attempt: GrantAttempt = queue.attemptGrant(runId, currentCaps(slots), blocks, new Date().toISOString());
    if (attempt.kind === "granted") return attempt.run;
    if (attempt.kind === "needs-ports") {
      if (++portRaces > MAX_PORT_RACES) throw new SiloError("PORTS_EXHAUSTED: slot port blocks kept losing to concurrent claims", "PORTS_EXHAUSTED");
      blocks = await choosePorts(planned.requests, attempt.claimed, space!);
      continue;
    }
    const message = waitingMessage(attempt.decision);
    if (message !== lastMessage) { logger.progress(message); lastMessage = message; }
    const remaining = deadline === null ? delay : deadline - Date.now();
    if (remaining <= 0) {
      const holders = attempt.decision.holders.map(holder => holderLabel(holder, attempt.decision.slot));
      throw new SiloError(`SLOT_WAIT_TIMEOUT: ${attempt.decision.slot} stayed unavailable for ${waitMs}ms (${attempt.decision.held}/${attempt.decision.cap} held${holders.length ? `: ${holders.join(", ")}` : ""})`, "SLOT_WAIT_TIMEOUT", {
        details: { slot: attempt.decision.slot, holders, exitCode: SLOT_WAIT_TIMEOUT_EXIT },
      });
    }
    await sleep(Math.min(delay, remaining), signal);
    delay = Math.min(delay * 2, POLL_MS_MAX);
  }
};

const slotEnvironment = (held: HeldSlotRun, configs: ReadonlyMap<SlotName, SlotConfig>): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const grant of held.grants) {
    for (const [key, template] of Object.entries(configs.get(grant.slot)!.env)) env[key] = renderSlotValue(template, grant);
  }
  return env;
};

/** The run releases its own units only once its executor group is terminal. */
const releaseWhenGroupEnds = async (queue: SlotQueue, held: HeldSlotRun): Promise<boolean> => {
  const deadline = Date.now() + GROUP_EXIT_TIMEOUT_MS;
  const launch = held.launch;
  const groupEnded = () => launch === null || (probeProcess(launch.supervisor.pid) === "absent" && probeProcess(-launch.groupId) === "absent");
  let delay = POLL_MS_MIN;
  while (!groupEnded()) {
    if (Date.now() >= deadline) {
      logger.warn(`slot units of run ${held.id} stay held: group ${launch!.groupId} still has members. A later silo run releases them once it is gone.`);
      return false;
    }
    await Bun.sleep(delay);
    delay = Math.min(delay * 2, POLL_MS_MAX);
  }
  return queue.release(held.id);
};

const acquireFailure = (completion: SlotCompletion, step: string, stderrTail: string): SiloError => new SiloError(
  `SLOT_ACQUIRE_FAILED: on-acquire step ${completion.failedStep! + 1} (${step}) exited ${completion.exitCode}; the command did not start and its units were released. ${stderrTail.slice(-2048)}`.trimEnd(),
  "SLOT_ACQUIRE_FAILED", { details: { failedStep: completion.failedStep, exitCode: completion.exitCode } },
);

/** Waits for one unit of every named slot, runs on-acquire then the command, and releases on exit. */
export const run = async (options: RunOptions): Promise<RunResult> => {
  const waitMs = options.wait === undefined ? null : parseWait(options.wait);
  const planned = await plan(options);
  // Legacy clients can only collide with slot port blocks (owner decision 2026-11-16).
  if (planned.requests.some(request => request.ports > 0)) await assertNoLegacyState(planned.root);
  const identity = await processIdentity(process.pid);
  if (identity === null) throw new SiloError("Cannot read this process's start identity", "PROCESS_IDENTITY_UNAVAILABLE");
  const queue = new SlotQueue(accountStorePath());
  const runId = randomUUID();
  const command = [...options.command];
  const startedWaiting = Date.now();
  queue.enqueue({ phase: "waiting", id: runId, root: planned.root, command, requests: planned.requests, waiter: { pid: process.pid, identity }, enqueuedAt: new Date().toISOString() });
  let held: HeldSlotRun | null = null;
  let released = false;
  try {
    held = await waitForGrant(queue, runId, planned, waitMs, options.signal);
    const waitedMs = Date.now() - startedWaiting;
    const onAcquire = held.grants.flatMap(grant => planned.configs.get(grant.slot)!["on-acquire"]);
    const granted: HeldSlotRun = held;
    const running = await startGate<SlotCompletion>({
      id: runId, root: planned.root, executorEntrypoint: options.executorEntrypoint, executorArgs: ["slot", runId, planned.root],
      kind: "slot-run", env: slotEnvironment(granted, planned.configs), timeoutMs: null, capture: false,
      output: options.json ? "stderr" : "stdout", signal: options.signal,
      grant: gate => {
        held = queue.recordLaunch(runId, { supervisor: { pid: gate.supervisorPid, identity: gate.supervisorIdentity }, leaderPid: gate.leaderPid, groupId: gate.groupId });
        const grant: SlotExecutorGrant = { runId, leaderPid: gate.leaderPid, groupId: gate.groupId, onAcquire, command };
        return JSON.stringify(grant);
      },
      readCompletion: () => queue.completion(runId),
      failureDetails: { runId },
    });
    const result = await running.exited;
    // The supervisor's exit can win the race with the executor's fact; read
    // the durable fact before the row is released with the units.
    const completion = result.completion ?? queue.recordedCompletion(runId);
    released = await releaseWhenGroupEnds(queue, held);
    if (completion !== null && !completion.started && completion.failedStep !== null) {
      throw acquireFailure(completion, onAcquire[completion.failedStep] ?? "", result.stderr);
    }
    return { schemaVersion: 1, run: { id: runId, root: planned.root, command, slots: held.grants, waitedMs, exitCode: result.exitCode, released } };
  } catch (error) {
    const wasHeld = held !== null;
    if (!released) {
      // A waiting ticket holds nothing. Held units are released once the
      // group is terminal; an interrupt has already stopped the supervisor.
      released = held === null ? queue.release(runId) : await releaseWhenGroupEnds(queue, held);
    }
    if (error instanceof SiloError && error.code === "INTERRUPTED") {
      const outcome = !wasHeld ? "left the queue" : released ? "its group was stopped and its units released" : "its group was stopped; its units stay held until the group is gone";
      throw new SiloError(`run interrupted by ${String(error.details.signal)}; ${outcome}`, "INTERRUPTED", { details: error.details });
    }
    throw error;
  }
};
