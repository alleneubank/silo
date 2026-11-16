import { randomUUID } from "node:crypto";
import { loadConfig } from "../core/config";
import { assertNoLegacyState } from "../core/legacy_check";
import { accountStorePath } from "../core/allocation_domain";
import { hostConfigPath, readHostCaps } from "../core/host_caps";
import { drainWindowMs } from "../core/owned_command";
import { supervise, waitUntil, type Deadline, type Supervised } from "./run_supervision";
import { findPortBlock, livePortSpace, type PortSpace } from "../core/ports";
import { probeProcess, processIdentity } from "../core/process_identity";
import { SlotQueue, runLiveness, type GrantAttempt, type GrantDecision, type QueuedRun } from "../core/slot_store";
import {
  MAX_RUN_SLOTS, SlotNameSchema, renderSlotValue,
  type HeldSlotRun, type HostCaps, type RunExecutorGrant, type SlotCompletion, type SlotConfig, type SlotExecutorGrant, type SlotGrant, type SlotName, type SlotRequest,
} from "../core/slot_types";
import { TILT_DRAIN_GRACE_MS } from "../core/constants";
import { SiloError } from "../utils/errors";
import { logger } from "../utils/logger";
import { sleep } from "../utils/sleep";
import { commandRoot } from "./prepare";

const POLL_MS_MIN = 50;
const POLL_MS_MAX = 1000;
const MAX_PORT_RACES = 64;

/** Exit status for a bounded wait that ran out (EX_TEMPFAIL). */
const SLOT_WAIT_TIMEOUT_EXIT = 75;
/** Exit status for a slot this project or host does not provide. */
const SLOT_UNAVAILABLE_EXIT = 2;
/** Exit status for a run stopped at its --timeout, as coreutils timeout(1). */
const TIMED_OUT_EXIT = 124;

type RunOptions = {
  config: string;
  slots: readonly string[];
  wait: string | undefined;
  timeout: string | undefined;
  killAfter: string | undefined;
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
    // True when --timeout stopped the group; exitCode is then 124.
    timedOut: boolean;
    // False when the group outlived the release window; a later contender releases it.
    released: boolean;
  };
};

type DurationBounds = { flag: string; minMs: number; maxMs: number; range: string };

const SECOND_MS = 1000;
const DAY_MS = 24 * 60 * 60 * SECOND_MS;
// Seven days also keeps every delay below setTimeout's 2^31-1 ms limit.
const WAIT_BOUNDS: DurationBounds = { flag: "--wait", minMs: 0, maxMs: 7 * DAY_MS, range: "at most 7 days" };
const TIMEOUT_BOUNDS: DurationBounds = { flag: "--timeout", minMs: SECOND_MS, maxMs: 7 * DAY_MS, range: "1s to 7 days" };
const KILL_AFTER_BOUNDS: DurationBounds = { flag: "--kill-after", minMs: SECOND_MS, maxMs: 10 * 60 * SECOND_MS, range: "1s to 10m" };

/** `500ms`, `30s`, `5m`, `2h`; a bare number is seconds. */
const parseDuration = (value: string, bounds: DurationBounds): number => {
  const match = /^(\d+)(ms|s|m|h)?$/.exec(value.trim());
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match?.[2] ?? "s"];
  const amount = Number(match?.[1]);
  const ms = amount * (unit ?? Number.NaN);
  if (!match || !Number.isSafeInteger(ms) || ms < bounds.minMs || ms > bounds.maxMs) {
    throw new SiloError(`INVALID_ARGUMENT: ${bounds.flag} takes a duration such as 30s, 5m or 2h (${bounds.range}), got '${value}'`, "INVALID_ARGUMENT");
  }
  return ms;
};

/** The run's time bounds: the queue wait, the run from grant, and the stop grace. */
type Limits = { waitMs: number | null; timeoutMs: number | null; graceMs: number };

const parseLimits = (options: RunOptions): Limits => {
  if (options.wait !== undefined && options.slots.length === 0) {
    throw new SiloError("INVALID_ARGUMENT: --wait bounds the wait for slots; a run without --slot does not wait", "INVALID_ARGUMENT");
  }
  return {
    waitMs: options.wait === undefined ? null : parseDuration(options.wait, WAIT_BOUNDS),
    timeoutMs: options.timeout === undefined ? null : parseDuration(options.timeout, TIMEOUT_BOUNDS),
    // Without --kill-after a stop keeps the grace every supervised group gets.
    graceMs: options.killAfter === undefined ? TILT_DRAIN_GRACE_MS : parseDuration(options.killAfter, KILL_AFTER_BOUNDS),
  };
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

const keepHeld = (held: HeldSlotRun): false => {
  logger.warn(`slot units of run ${held.id} stay held: group ${held.launch?.groupId} still has members. A later silo run releases them once it is gone.`);
  return false;
};

/** After an interrupt, the run releases its units only once its executor group is terminal. */
const releaseWhenGroupEnds = async (queue: SlotQueue, held: HeldSlotRun, graceMs: number): Promise<boolean> => {
  const launch = held.launch;
  const ended = await waitUntil(() => launch === null || (probeProcess(launch.supervisor.pid) === "absent" && probeProcess(-launch.groupId) === "absent"), drainWindowMs(graceMs));
  return ended ? queue.release(held.id) : keepHeld(held);
};

const acquireFailure = (completion: SlotCompletion, step: string, stderrTail: string): SiloError => new SiloError(
  `SLOT_ACQUIRE_FAILED: on-acquire step ${completion.failedStep! + 1} (${step}) exited ${completion.exitCode}; the command did not start and its units were released. ${stderrTail.slice(-2048)}`.trimEnd(),
  "SLOT_ACQUIRE_FAILED", { details: { failedStep: completion.failedStep, exitCode: completion.exitCode } },
);

const stopIncomplete = (deadline: Deadline, runId: string, held: string): SiloError => new SiloError(
  `RUN_STOP_INCOMPLETE: ${deadline.label} reached, but the command's process group could not be proved gone after SIGKILL; ${held}`,
  "RUN_STOP_INCOMPLETE", { details: { runId } },
);

const gateFor = (options: RunOptions, limits: Limits, id: string, root: string) => ({
  id, root, executorEntrypoint: options.executorEntrypoint, graceMs: limits.graceMs,
  output: options.json ? "stderr" as const : "stdout" as const, signal: options.signal,
});

const deadlineFrom = (start: number, options: RunOptions, limits: Limits): Deadline | null =>
  limits.timeoutMs === null ? null : { atMs: start + limits.timeoutMs, label: `--timeout ${options.timeout}` };

const interrupted = (error: unknown, outcome: string): unknown => error instanceof SiloError && error.code === "INTERRUPTED"
  ? new SiloError(`run interrupted by ${String(error.details.signal)}; ${outcome}`, "INTERRUPTED", { details: error.details })
  : error;

/** Runs the command alone under supervision; it reads no project config and opens no store. */
const runWithoutSlots = async (options: RunOptions, limits: Limits): Promise<RunResult> => {
  const root = commandRoot(options.config);
  const runId = randomUUID();
  const command = [...options.command];
  const deadline = deadlineFrom(Date.now(), options, limits);
  let supervised: Supervised<never>;
  try {
    supervised = await supervise<never>({
      ...gateFor(options, limits, runId, root), executorArgs: ["run", runId, root], kind: "run", env: undefined,
      grant: gate => JSON.stringify({ runId, leaderPid: gate.leaderPid, groupId: gate.groupId, command } satisfies RunExecutorGrant),
      readCompletion: () => null, failureDetails: { runId },
    }, deadline, () => false);
  } catch (error) {
    throw interrupted(error, "its group was stopped");
  }
  const run = { id: runId, root, command, slots: [], waitedMs: 0 };
  if (supervised.kind === "exited") return { schemaVersion: 1, run: { ...run, exitCode: supervised.result.exitCode, timedOut: false, released: supervised.groupEnded } };
  if (!supervised.groupEnded) throw stopIncomplete(deadline!, runId, "inspect it with ps");
  return { schemaVersion: 1, run: { ...run, exitCode: TIMED_OUT_EXIT, timedOut: true, released: true } };
};

/** Waits for one unit of every named slot, runs on-acquire then the command, and releases on exit. */
export const run = async (options: RunOptions): Promise<RunResult> => {
  if (options.command.length === 0) throw new SiloError("INVALID_ARGUMENT: silo run needs a command after --", "INVALID_ARGUMENT");
  const limits = parseLimits(options);
  return options.slots.length === 0 ? runWithoutSlots(options, limits) : runWithSlots(options, limits);
};

const runWithSlots = async (options: RunOptions, limits: Limits): Promise<RunResult> => {
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
  // Null until the run has decided whether its units are released.
  let released: boolean | null = null;
  try {
    held = await waitForGrant(queue, runId, planned, limits.waitMs, options.signal);
    const grantedAt = Date.now();
    const waitedMs = grantedAt - startedWaiting;
    const onAcquire = held.grants.flatMap(grant => planned.configs.get(grant.slot)!["on-acquire"]);
    const deadline = deadlineFrom(grantedAt, options, limits);
    const supervised = await supervise<SlotCompletion>({
      ...gateFor(options, limits, runId, planned.root), executorArgs: ["slot", runId, planned.root], kind: "slot-run",
      env: slotEnvironment(held, planned.configs),
      grant: gate => {
        held = queue.recordLaunch(runId, { supervisor: { pid: gate.supervisorPid, identity: gate.supervisorIdentity }, leaderPid: gate.leaderPid, groupId: gate.groupId });
        const grant: SlotExecutorGrant = { runId, leaderPid: gate.leaderPid, groupId: gate.groupId, onAcquire, command };
        return JSON.stringify(grant);
      },
      readCompletion: () => queue.completion(runId),
      failureDetails: { runId },
    }, deadline, () => queue.completion(runId) !== null);
    const run = { id: runId, root: planned.root, command, slots: held.grants, waitedMs };
    // The supervisor's exit can win the race with the executor's fact; read
    // the durable fact before the row is released with the units.
    const completion = supervised.kind === "exited" ? supervised.result.completion ?? queue.recordedCompletion(runId) : null;
    released = supervised.groupEnded ? queue.release(runId) : keepHeld(held);
    if (supervised.kind === "timed-out") {
      if (!released) throw stopIncomplete(deadline!, runId, "its units stay held until a later run proves it gone");
      return { schemaVersion: 1, run: { ...run, exitCode: TIMED_OUT_EXIT, timedOut: true, released } };
    }
    if (completion !== null && !completion.started && completion.failedStep !== null) {
      throw acquireFailure(completion, onAcquire[completion.failedStep] ?? "", supervised.result.stderr);
    }
    return { schemaVersion: 1, run: { ...run, exitCode: supervised.result.exitCode, timedOut: false, released } };
  } catch (error) {
    const wasHeld = held !== null;
    // A waiting ticket holds nothing. Held units are released once the
    // group is terminal; an interrupt has already stopped the supervisor.
    released ??= held === null ? queue.release(runId) : await releaseWhenGroupEnds(queue, held, limits.graceMs);
    throw interrupted(error, !wasHeld ? "left the queue" : released ? "its group was stopped and its units released" : "its group was stopped; its units stay held until the group is gone");
  }
};
