import { drainWindowMs, startGate, type Gate, type GateResult } from "../core/owned_command";
import { probeProcess, processIdentity } from "../core/process_identity";
import { OperationInterrupts } from "../utils/interrupt";
import { logger } from "../utils/logger";
import { observe, raceOperations, type Cancellable } from "../utils/timeout";

const POLL_MS_MIN = 50;
const POLL_MS_MAX = 1000;
/** Time for a SIGKILLed process or group to leave the process table. */
const KILL_SETTLE_MS = 5000;

/** Everything a run's gate needs except what supervision itself decides. */
type RunGate<Fact extends { exitCode: number }> = Omit<Gate<Fact>, "timeoutMs" | "capture" | "teardown">;

export type Deadline = { atMs: number; label: string };

export type Supervised<Fact> =
  | { kind: "exited"; result: GateResult<Fact>; groupEnded: boolean }
  // The deadline found the command running and stopped it.
  | { kind: "timed-out"; groupEnded: boolean };

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

const settle = <T>(promise: Promise<T>): Promise<Settled<T>> =>
  promise.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));

const unwrap = <T>(settled: Settled<T>): T => {
  if (settled.ok) return settled.value;
  throw settled.error;
};

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

const timer = (atMs: number): Cancellable<"deadline"> => {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const result = new Promise<"deadline">(resolve => { handle = setTimeout(() => resolve("deadline"), Math.max(0, atMs - Date.now())); });
  return { result, cancel: () => clearTimeout(handle) };
};

const untilDeadline = <T>(promise: Promise<T>, atMs: number): Promise<T | "deadline"> =>
  raceOperations<T | "deadline">([observe(promise), timer(atMs)]);

/**
 * Runs one Janitor-supervised group that tears down the executor's proven
 * descendants as well as its group. With a deadline, a command still running
 * when it passes is stopped through the supervisor within its drain window;
 * a supervisor that is gone or does not drain is replaced by signalling the
 * recorded group directly, and only while its leader is still the recorded
 * process, so the group ID can never name a reused group. A deadline is a
 * timeout only when the command had not finished and no interrupt came
 * first; once it is, a later interrupt does not change the outcome.
 */
export const supervise = async <Fact extends { exitCode: number }>(
  gate: RunGate<Fact>, deadline: Deadline | null, commandRecorded: () => boolean,
): Promise<Supervised<Fact>> => {
  const running = await startGate<Fact>({ ...gate, timeoutMs: null, capture: false, teardown: "descendants" });
  const exited = settle(running.exited);
  const { leaderPid, groupId } = running.identity;
  // Read after the grant, outside the launch's startup budget; null once the executor has already exited.
  const leaderIdentity = await OperationInterrupts.outside(() => processIdentity(leaderPid));
  let supervisorGone = false;
  void running.supervisorExited.then(() => { supervisorGone = true; });
  const groupEnded = () => supervisorGone && probeProcess(-groupId) === "absent";
  const leaderIsRecorded = async () => leaderIdentity !== null && probeProcess(leaderPid) !== "absent" &&
    (await processIdentity(leaderPid)) === leaderIdentity;
  const finish = async (settled: Settled<GateResult<Fact>>): Promise<Supervised<Fact>> =>
    ({ kind: "exited", result: unwrap(settled), groupEnded: await waitUntil(groupEnded, drainWindowMs(gate.graceMs)) });

  if (deadline === null) return finish(await exited);
  const first = await untilDeadline(exited, deadline.atMs);
  if (first !== "deadline") {
    unwrap(first);
    // A supervisor lost mid-run leaves the command unsupervised; its deadline still applies.
    if (!(await outlivesUntil(leaderIsRecorded, deadline.atMs))) return finish(first);
    return stopAtDeadline();
  }
  if (gate.signal?.aborted || commandRecorded() || !(await leaderIsRecorded())) return finish(await exited);
  return stopAtDeadline();

  async function stopAtDeadline(): Promise<Supervised<Fact>> {
    logger.warn(`${deadline!.label} reached; stopping the command's process group (SIGTERM, then SIGKILL after ${gate.graceMs}ms)`);
    const ended = await OperationInterrupts.outside(stopGroup);
    // The supervisor's own report only flushes output now; it cannot change the outcome.
    const report = await OperationInterrupts.outside(() => untilDeadline(exited, Date.now() + KILL_SETTLE_MS));
    if (report !== "deadline" && !report.ok) logger.verbose("supervisor report after the deadline:", report.error instanceof Error ? report.error.message : String(report.error));
    return { kind: "timed-out", groupEnded: ended };
  }

  async function stopGroup(): Promise<boolean> {
    if (!supervisorGone) {
      running.stop();
      if (await waitUntil(groupEnded, drainWindowMs(gate.graceMs))) return true;
      // A supervisor that did not drain in its window is ended so it cannot act later.
      running.kill();
      await waitUntil(() => supervisorGone, KILL_SETTLE_MS);
    }
    for (const [signal, settleMs] of [["SIGTERM", gate.graceMs], ["SIGKILL", KILL_SETTLE_MS]] as const) {
      if (groupEnded() || !(await leaderIsRecorded())) break;
      logger.warn(`sending ${signal} to process group ${groupId} directly: its supervisor is gone`);
      try { process.kill(-groupId, signal); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
      if (await waitUntil(groupEnded, settleMs)) return true;
    }
    return groupEnded();
  }
};

/** True when `alive` still holds at `atMs`; false as soon as it stops holding before then. */
const outlivesUntil = async (alive: () => Promise<boolean>, atMs: number): Promise<boolean> => {
  let delay = POLL_MS_MIN;
  while (await alive()) {
    const remaining = atMs - Date.now();
    if (remaining <= 0) return true;
    await Bun.sleep(Math.min(delay, remaining));
    delay = Math.min(delay * 2, POLL_MS_MAX);
  }
  return false;
};
