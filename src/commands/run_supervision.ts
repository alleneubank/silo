import { drainWindowMs, startRunGate, type RunGate, type SupervisorEnd } from "../core/owned_command";
import { probeIdentity, probeProcess, type IdentityProbe } from "../core/process_identity";
import { OperationInterrupts } from "../utils/interrupt";
import { logger } from "../utils/logger";
import { observe, raceOperations, type Cancellable } from "../utils/timeout";

const POLL_MS_MIN = 50;
const POLL_MS_MAX = 1000;
/** Time for a SIGKILLed process or group to leave the process table. */
const KILL_SETTLE_MS = 5000;
/** The report's own output window plus margin; see startRunGate. */
const REPORT_BUDGET_MS = 10_000;
/** Bound on one `ps` read of the executor's identity, and how many reads an unknown answer gets. */
const PROBE_TIMEOUT_MS = 5000;
const PROBE_ATTEMPTS = 3;
/** How often a running command's executor is checked for having exited unreaped. */
const EXECUTOR_IDENTITY_POLL_MS = 5000;

type RunGateLaunch = Parameters<typeof startRunGate>[0];

export type Deadline = { atMs: number; label: string };

/** Why a stop could not prove the command's processes gone. */
export type UnprovedReason =
  // Janitor was lost, so descendants that left the group with setsid cannot be proved gone.
  | "supervisor-lost"
  // Janitor was lost and the executor had exited, so silo sent the group no signal.
  | "leader-exited"
  // Repeated reads could not tell whether the executor still runs.
  | "liveness-unknown"
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

/** The executor as last read: still the recorded process, gone (exited or unreaped), or unknown. */
type Executor = "recorded" | "gone" | "unknown";

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

/** Reads `pid`'s identity, retrying an unknown answer within a fixed number of bounded reads. */
const readIdentity = async (pid: number): Promise<IdentityProbe> => {
  for (let attempt = 1; ; attempt += 1) {
    const probe = await probeIdentity(pid, PROBE_TIMEOUT_MS);
    if (probe.kind !== "unknown" || attempt >= PROBE_ATTEMPTS) return probe;
    await Bun.sleep(POLL_MS_MIN * attempt);
  }
};

/**
 * Runs one Janitor-supervised group until the first of: Janitor exits, the
 * executor exits, the deadline passes, or an interrupt arrives. Deadline and
 * interrupt share one stop. Every wait after that event is bounded by
 * `within`, which SIGKILLs Janitor when its budget runs out, and none of it
 * runs inside the interrupt scope; the probes it spawns run in their own
 * process group, so a later signal cannot cut a stop short or fake an answer.
 */
export const supervise = async (
  gate: RunGateLaunch, deadline: Deadline | null, commandRecorded: () => boolean,
): Promise<Supervised> => {
  const running = await startRunGate(gate);
  return OperationInterrupts.outside(() => watch(running, gate, deadline, commandRecorded));
};

const watch = async (running: RunGate, gate: RunGateLaunch, deadline: Deadline | null, commandRecorded: () => boolean): Promise<Supervised> => {
  const { leaderPid, groupId } = running.identity;
  const recorded = await readIdentity(leaderPid);
  let supervisorEnd: SupervisorEnd | null = null;
  void running.supervisorEnd.then(end => { supervisorEnd = end; });
  const groupAbsent = () => probeProcess(-groupId) === "absent";
  const executor = async (): Promise<Executor> => {
    if (recorded.kind !== "present") return recorded.kind === "absent" ? "gone" : "unknown";
    const now = await readIdentity(leaderPid);
    if (now.kind === "unknown") return "unknown";
    // An exited executor that Janitor has not reaped shows a different identity.
    return now.kind === "present" && now.identity === recorded.identity ? "recorded" : "gone";
  };

  /** The one bounded wait: when its budget runs out Janitor is SIGKILLed and the wait reports it lost. */
  const within = async <T>(promise: Promise<T>, budgetMs: number): Promise<Bounded<T>> => {
    const outcome = await raceOperations<{ kind: "settled"; value: T } | { kind: "expired" }>([
      observe(promise.then(value => ({ kind: "settled" as const, value }))), after(budgetMs, { kind: "expired" as const }),
    ]);
    if (outcome.kind === "settled") return outcome;
    running.kill();
    return { kind: "supervisor-lost" };
  };

  /** Fires once the executor has exited, whether or not Janitor reaps it. */
  const executorExit = (): Cancellable<"executor-exited"> => {
    let watching = true;
    const result = new Promise<"executor-exited">(resolve => {
      void (async () => {
        let delay = POLL_MS_MIN;
        let identityDue = Date.now() + EXECUTOR_IDENTITY_POLL_MS;
        while (watching) {
          await Bun.sleep(delay);
          delay = Math.min(delay * 2, POLL_MS_MAX);
          let exited = commandRecorded() || probeProcess(leaderPid) === "absent";
          if (!exited && Date.now() >= identityDue) {
            exited = (await executor()) === "gone";
            identityDue = Date.now() + EXECUTOR_IDENTITY_POLL_MS;
          }
          if (exited && watching) { resolve("executor-exited"); return; }
        }
      })();
    });
    return { result, cancel: () => { watching = false; } };
  };

  const unproved = (cause: Cause["kind"], reason: UnprovedReason): Supervised => ({ end: "unproved", cause, reason, groupId });

  /** Without a working Janitor: signal the recorded group directly. Descendants outside it stay unproved. */
  const stopWithoutSupervisor = async (): Promise<UnprovedReason> => {
    running.kill();
    await within(running.supervisorEnd, KILL_SETTLE_MS);
    for (const [signal, settleMs] of [["SIGTERM", gate.graceMs], ["SIGKILL", KILL_SETTLE_MS]] as const) {
      if (groupAbsent()) return "supervisor-lost";
      // A group's ID cannot be reused while any member lives; signals go
      // only while that member is the recorded executor itself.
      const state = await executor();
      if (state === "gone") return "leader-exited";
      if (state === "unknown") return "liveness-unknown";
      logger.warn(`sending ${signal} to process group ${groupId} directly: its supervisor is gone`);
      try { process.kill(-groupId, signal); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
      await waitUntil(groupAbsent, settleMs);
    }
    return groupAbsent() ? "supervisor-lost" : "group-survived-kill";
  };

  /**
   * Proof needs Janitor to have exited on its own, which it does only after
   * draining the group, and the executor group to have no member. Any other
   * end of Janitor means silo stops the group itself, which proves nothing.
   */
  const drainedByJanitor = async (budgetMs: number): Promise<UnprovedReason | null> => {
    const end = await within(running.supervisorEnd, budgetMs);
    if (end.kind === "supervisor-lost" || end.value.signal !== null) return stopWithoutSupervisor();
    return (await waitUntil(groupAbsent, KILL_SETTLE_MS)) ? null : "group-outlived-supervisor";
  };

  /** The deadline's and the interrupt's stop. SIGTERM to an exited Janitor is a no-op, so one path serves both. */
  // WAIVER(stop proof when Janitor already exited): stop has one path, and drainedByJanitor decides proof for every way Janitor ends; a Janitor that has already exited reaches stop only when its exit and a deadline or interrupt resolve in the same tick, which no test can stage. Permanent — there is no separate branch to get wrong.
  const stop = async (cause: Cause): Promise<Supervised> => {
    if (cause.kind === "timed-out") logger.warn(`${deadline!.label} reached; stopping the command's process group (SIGTERM, then SIGKILL after ${gate.graceMs}ms)`);
    running.stop();
    const reason = await drainedByJanitor(drainWindowMs(gate.graceMs));
    return reason === null ? { end: "proved-gone", cause } : unproved(cause.kind, reason);
  };

  /** The command ended on its own; its status counts only once Janitor has exited cleanly. */
  const ended = async (): Promise<Supervised> => {
    const reason = await drainedByJanitor(drainWindowMs(gate.graceMs));
    if (reason !== null) return unproved("exited", reason);
    const report = await within(running.report, REPORT_BUDGET_MS);
    if (report.kind === "supervisor-lost") return unproved("exited", "supervisor-lost");
    return { end: "proved-gone", cause: { kind: "exited", ...report.value } };
  };

  /** A deadline is a timeout only while the command is still running; an unreadable executor stays unproved. */
  const atDeadline = async (): Promise<Supervised> => {
    const state = commandRecorded() ? "gone" : await executor();
    if (state === "gone") return ended();
    const outcome = await stop({ kind: "timed-out" });
    return state === "unknown" && outcome.end === "proved-gone" ? unproved("timed-out", "liveness-unknown") : outcome;
  };

  const event = await raceOperations<"supervisor-ended" | "executor-exited" | "deadline" | "interrupt">([
    observe(running.supervisorEnd.then(() => "supervisor-ended" as const)),
    executorExit(),
    ...(deadline === null ? [] : [after(deadline.atMs - Date.now(), "deadline" as const)]),
    ...(gate.signal === undefined ? [] : [aborted(gate.signal)]),
  ]);
  let outcome: Supervised;
  if (event === "interrupt") outcome = await stop({ kind: "interrupted", interruption: gate.signal!.reason });
  else if (event === "deadline") outcome = await atDeadline();
  else outcome = await ended();
  // Janitor is gone on every path, so the output settles within its own window.
  await within(running.report, REPORT_BUDGET_MS);
  return outcome;
};
