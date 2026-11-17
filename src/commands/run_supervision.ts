import { drainWindowMs, startRunGate, type RunGate, type SupervisorEnd } from "../core/owned_command";
import { probeProcess, processIdentity } from "../core/process_identity";
import { SiloError } from "../utils/errors";
import { OperationInterrupts } from "../utils/interrupt";
import { logger } from "../utils/logger";
import { observe, raceOperations, type Cancellable } from "../utils/timeout";

const POLL_MS_MIN = 50;
const POLL_MS_MAX = 1000;
/** Time for a SIGKILLed process or group to leave the process table. */
const KILL_SETTLE_MS = 5000;
/** The report's own output window plus margin; see startRunGate. */
const REPORT_BUDGET_MS = 10_000;
/** Bound on one `ps` read of the executor's identity. */
const PROBE_TIMEOUT_MS = 5000;

type RunGateLaunch = Parameters<typeof startRunGate>[0];

export type Deadline = { atMs: number; label: string };

/** Why a stop could not prove the command's processes gone. */
export type UnprovedReason =
  // Janitor was lost, so descendants that left the group with setsid cannot be proved gone.
  | "supervisor-lost"
  // Janitor was lost and the executor had exited, so silo sent the group no signal.
  | "leader-exited"
  | "group-survived-kill"
  | "group-outlived-supervisor";

/** What ended the run, once it ended. */
export type Cause =
  | { kind: "exited"; exitCode: number; stderr: string }
  | { kind: "timed-out" }
  | { kind: "interrupted"; interruption: unknown };

/**
 * Only a group proved gone may be reported as stopped, timed out or
 * released; every other end carries the reason it is unproved.
 */
export type Supervised =
  | { end: "proved-gone"; cause: Cause }
  | { end: "unproved"; cause: Cause["kind"]; reason: UnprovedReason; groupId: number };

type Bounded<T> = { kind: "settled"; value: T } | { kind: "supervisor-lost" };

/** Polls `condition` with bounded backoff until it holds or `windowMs` passes; returns its final value. */
export const waitUntil = async (condition: () => boolean, windowMs: number): Promise<boolean> => {
  const deadline = Date.now() + windowMs;
  let delay = POLL_MS_MIN;
  while (!condition()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await Bun.sleep(Math.min(delay, remaining));
    delay = Math.min(delay * 2, POLL_MS_MAX);
  }
  return true;
};

const after = <T>(delayMs: number, value: T): Cancellable<T> => {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const result = new Promise<T>(resolve => { handle = setTimeout(() => resolve(value), Math.max(0, delayMs)); });
  return { result, cancel: () => clearTimeout(handle) };
};

const aborted = (signal: AbortSignal): Cancellable<"interrupt"> => {
  let listener = () => {};
  const result = new Promise<"interrupt">(resolve => {
    listener = () => resolve("interrupt");
    if (signal.aborted) listener();
    else signal.addEventListener("abort", listener, { once: true });
  });
  return { result, cancel: () => signal.removeEventListener("abort", listener) };
};

/** The executor's start identity, or null when `ps` cannot show it within its bound. */
const identityOf = async (pid: number): Promise<string | null> => {
  try { return await processIdentity(pid, PROBE_TIMEOUT_MS); }
  catch (error) {
    if (error instanceof SiloError && error.code === "TIMEOUT") return null;
    throw error;
  }
};

/**
 * Runs one Janitor-supervised group until the command ends, its deadline
 * passes, or an interrupt arrives, whichever comes first. Deadline and
 * interrupt share one stop. Every wait after that point is bounded by
 * `within`, which SIGKILLs Janitor when its budget runs out, and none of it
 * runs inside the interrupt scope, so a later signal cannot cut a stop short.
 */
export const supervise = async (
  gate: RunGateLaunch, deadline: Deadline | null, commandRecorded: () => boolean,
): Promise<Supervised> => {
  const running = await startRunGate(gate);
  return OperationInterrupts.outside(() => watch(running, gate, deadline, commandRecorded));
};

const watch = async (running: RunGate, gate: RunGateLaunch, deadline: Deadline | null, commandRecorded: () => boolean): Promise<Supervised> => {
  const { leaderPid, groupId } = running.identity;
  const leaderIdentity = await identityOf(leaderPid);
  let supervisorEnd: SupervisorEnd | null = null;
  void running.supervisorEnd.then(end => { supervisorEnd = end; });
  const groupAbsent = () => probeProcess(-groupId) === "absent";
  // A group's ID cannot be reused while any member lives; signals go only
  // while that member is the recorded executor itself.
  const leaderRecorded = async () => leaderIdentity !== null && probeProcess(leaderPid) !== "absent" && (await identityOf(leaderPid)) === leaderIdentity;

  /** The one bounded wait: when its budget runs out Janitor is SIGKILLed and the wait reports it lost. */
  const within = async <T>(promise: Promise<T>, budgetMs: number): Promise<Bounded<T>> => {
    const outcome = await raceOperations<{ kind: "settled"; value: T } | { kind: "expired" }>([
      observe(promise.then(value => ({ kind: "settled" as const, value }))), after(budgetMs, { kind: "expired" as const }),
    ]);
    if (outcome.kind === "settled") return outcome;
    running.kill();
    return { kind: "supervisor-lost" };
  };

  const unproved = (cause: Cause["kind"], reason: UnprovedReason): Supervised => ({ end: "unproved", cause, reason, groupId });

  /** Without a working Janitor: signal the recorded group directly. Descendants outside it stay unproved. */
  const stopWithoutSupervisor = async (): Promise<UnprovedReason> => {
    running.kill();
    await within(running.supervisorEnd, KILL_SETTLE_MS);
    for (const [signal, settleMs] of [["SIGTERM", gate.graceMs], ["SIGKILL", KILL_SETTLE_MS]] as const) {
      if (groupAbsent()) return "supervisor-lost";
      if (!(await leaderRecorded())) return "leader-exited";
      logger.warn(`sending ${signal} to process group ${groupId} directly: its supervisor is gone`);
      try { process.kill(-groupId, signal); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
      await waitUntil(groupAbsent, settleMs);
    }
    return groupAbsent() ? "supervisor-lost" : "group-survived-kill";
  };

  /** Janitor drained and exited on its own, and the executor group has no member. */
  const drainedByJanitor = async (end: Bounded<SupervisorEnd>): Promise<UnprovedReason | null> => {
    if (end.kind === "supervisor-lost" || end.value.signal !== null) return stopWithoutSupervisor();
    return (await waitUntil(groupAbsent, KILL_SETTLE_MS)) ? null : "group-outlived-supervisor";
  };

  /** The deadline's and the interrupt's stop: Janitor drains within its window, else silo stops the group itself. */
  const stop = async (cause: Cause): Promise<Supervised> => {
    if (cause.kind === "timed-out") logger.warn(`${deadline!.label} reached; stopping the command's process group (SIGTERM, then SIGKILL after ${gate.graceMs}ms)`);
    let reason: UnprovedReason | null;
    if (supervisorEnd === null) {
      running.stop();
      reason = await drainedByJanitor(await within(running.supervisorEnd, drainWindowMs(gate.graceMs)));
    } else {
      reason = await stopWithoutSupervisor();
    }
    return reason === null ? { end: "proved-gone", cause } : unproved(cause.kind, reason);
  };

  /** The command ended on its own; its status counts only once Janitor has exited cleanly. */
  const ended = async (): Promise<Supervised> => {
    const reason = await drainedByJanitor(await within(running.supervisorEnd, drainWindowMs(gate.graceMs)));
    if (reason !== null) return unproved("exited", reason);
    const report = await within(running.report, REPORT_BUDGET_MS);
    if (report.kind === "supervisor-lost") return unproved("exited", "supervisor-lost");
    return { end: "proved-gone", cause: { kind: "exited", ...report.value } };
  };

  const event = await raceOperations<"supervisor-ended" | "deadline" | "interrupt">([
    observe(running.supervisorEnd.then(() => "supervisor-ended" as const)),
    ...(deadline === null ? [] : [after(deadline.atMs - Date.now(), "deadline" as const)]),
    ...(gate.signal === undefined ? [] : [aborted(gate.signal)]),
  ]);
  let outcome: Supervised;
  if (event === "supervisor-ended") outcome = await ended();
  else if (event === "interrupt") outcome = await stop({ kind: "interrupted", interruption: gate.signal!.reason });
  // A deadline is a timeout only while the command is still running.
  else if (commandRecorded() || !(await leaderRecorded())) outcome = await ended();
  else outcome = await stop({ kind: "timed-out" });
  // Janitor is gone on every path, so the output settles within its own window.
  await within(running.report, REPORT_BUDGET_MS);
  return outcome;
};
