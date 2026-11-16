import { ProjectOperation, processAbsent, type CacheDeletionCapability, type CompletionKey } from "./lease_store";
import type { DockerDeletionTarget, ExecutorCompletion, Launch } from "./lease_types";
import { processIdentity } from "./process_identity";
import { SiloError } from "../utils/errors";
import { withTimeout, observe, raceOperations, type Cancellable } from "../utils/timeout";
import { sleep } from "../utils/sleep";
import { logger } from "../utils/logger";
import { LAUNCH_START_TIMEOUT_MS, TILT_DRAIN_GRACE_MS, TILT_SUPERVISOR_BIN } from "./constants";

const MAX_OUTPUT_BYTES = 1024 * 1024;
const STOP_TIMEOUT_MS = TILT_DRAIN_GRACE_MS + 5000;
const JOURNAL_POLL_MS_MIN = 50;
const JOURNAL_POLL_MS_MAX = 1000;

const executorCommand = (entrypoint: string): string[] =>
  "isStandaloneExecutable" in Bun && Bun.isStandaloneExecutable === true
    ? [process.execPath, "__silo_execute"]
    : [process.execPath, entrypoint, "__silo_execute"];

/** A supervisor is this account's process and leads its own group. */
const supervisorIdentity = async (pid: number, timeoutMs = LAUNCH_START_TIMEOUT_MS): Promise<string | null> => {
  const value = await processIdentity(pid, timeoutMs);
  if (value === null) return null;
  const [uid, group] = value.split(/\s+/, 2);
  if (Number(uid) !== process.geteuid?.() || Number(group) !== pid) return null;
  return value;
};

export const commandLiveness = async (launch: Launch): Promise<"terminal" | "live" | "unknown"> => {
  if (launch.terminal || launch.phase === "planned") return "terminal";
  if (processAbsent(launch.supervisorPid) && processAbsent(-launch.groupId)) return "terminal";
  const identity = await supervisorIdentity(launch.supervisorPid);
  return identity === launch.supervisorIdentity && identity.includes(launch.id) ? "live" : "unknown";
};

export type CommandOptions = {
  kind: string;
  effect: Launch["effect"];
  env?: Record<string, string>;
  timeoutMs: number | null;
  capture?: boolean;
  deletionTarget?: DockerDeletionTarget;
};
export type OwnedCommandResult = { exitCode: number; stdout: string; stderr: string; launch: Extract<Launch, { phase: "exited" }> };
export type RunningCommand = {
  launch: Extract<Launch, { phase: "granted" }>;
  exited: Promise<OwnedCommandResult>;
  stop: () => void;
};

const firstLine = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> => {
  const decoder = new TextDecoder();
  let value = "";
  while (value.length < 4096) {
    const chunk = await reader.read();
    if (chunk.done) throw new SiloError("Launch gate exited before its handshake", "LAUNCH_FAILED");
    value += decoder.decode(chunk.value, { stream: true });
    const end = value.indexOf("\n");
    if (end >= 0) {
      if (end !== value.length - 1) throw new SiloError("Launch gate produced output before its grant", "LAUNCH_FAILED");
      return value.slice(0, end);
    }
  }
  throw new SiloError("Oversized launch handshake", "LAUNCH_FAILED");
};

/** Where uncaptured output goes: stderr keeps stdout free for structured results. */
type OutputSink = "stdout" | "stderr";

const drain = (reader: ReadableStreamDefaultReader<Uint8Array>, capture: boolean, target: OutputSink = "stderr"): Cancellable<string> => {
  const decoder = new TextDecoder();
  const sink = capture ? null : (target === "stdout" ? Bun.stdout : Bun.stderr).writer();
  let ending: Promise<number> | undefined;
  const end = () => ending ??= Promise.resolve(sink?.end() ?? 0);
  let text = "";
  let size = 0;
  let stopped = false;
  const copy = async (): Promise<string> => {
    while (!stopped) {
      const chunk = await reader.read();
      if (chunk.done) { await end(); return text + decoder.decode(); }
      if (sink) {
        text = (text + decoder.decode(chunk.value, { stream: true })).slice(-4096);
        await sink.write(chunk.value);
        await sink.flush();
      } else {
        size += chunk.value.byteLength;
        if (size > MAX_OUTPUT_BYTES) throw new SiloError("Command output exceeds 1 MiB", "COMMAND_OUTPUT_LIMIT");
        text += decoder.decode(chunk.value, { stream: true });
      }
    }
    return text;
  };
  const copied = observe(copy());
  let abandon: (text: string) => void;
  const abandoned = new Promise<string>(resolve => { abandon = resolve; });
  const release = async () => {
    stopped = true;
    copied.cancel();
    await reader.cancel();
  };
  const result = raceOperations([
    { result: copied.result, cancel: release },
    { result: abandoned, cancel: () => {} },
  ]).finally(() => {
    try {
      // Normal EOF awaits the flush above. On abandonment, end stops new
      // writes and unref releases the native flush from process lifetime.
      // The shared output descriptor stays with the caller.
      observe(end()).cancel();
    } finally {
      sink?.unref();
      reader.releaseLock();
    }
  });
  return { result, cancel: async () => { abandon(text); await result; } };
};

type CompletionWatch<T> = { completion: Promise<T>; stop: () => void };

/**
 * The store offers no change event, so the executor's fact is polled with
 * bounded backoff until stopped. The watch holds only the fact's immutable
 * key, never the operation that started the launch: an until-stop command
 * outlives that operation, and `down` needs the project free meanwhile.
 *
 * The fact only lets the command finish before its supervisor exits; it is
 * never the sole evidence of the result, which the caller imports durably
 * afterwards. A failed read therefore just yields no fact for that poll and
 * cannot, by itself, end or signal the command.
 */
const watchCompletion = <T>(label: string, read: () => T | null): CompletionWatch<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let readFailureLogged = false;
  const completion = new Promise<T>(resolve => {
    const poll = (delayMs: number) => {
      timer = setTimeout(() => {
        if (stopped) return;
        let fact: T | null = null;
        try { fact = read(); }
        catch (error) {
          if (!readFailureLogged) logger.verbose(`Completion read for ${label} failed; retrying:`, error instanceof Error ? error.message : String(error));
          readFailureLogged = true;
        }
        if (fact) resolve(fact);
        else poll(Math.min(delayMs * 2, JOURNAL_POLL_MS_MAX));
      }, delayMs);
    };
    poll(JOURNAL_POLL_MS_MIN);
  });
  return { completion, stop: () => { stopped = true; clearTimeout(timer); } };
};

const settlesWithin = async (promise: Promise<unknown>, timeoutMs: number): Promise<boolean> => {
  try {
    await withTimeout(observe(promise), timeoutMs, "command completion observation");
    return true;
  } catch (error) {
    if (error instanceof SiloError && error.code === "TIMEOUT") return false;
    throw error;
  }
};

export const startOwnedCommand = async (
  owner: ProjectOperation, command: string[], options: CommandOptions,
): Promise<RunningCommand> => {
  if (options.timeoutMs === null && options.kind !== "tilt-up") throw new Error("Only the interactive Tilt session may have an until-stop lifetime");
  const intent = owner.planLaunch({ kind: options.kind, command, effect: options.effect,
    ...(options.deletionTarget === undefined ? {} : { deletionTarget: options.deletionTarget }) });
  return startPlannedCommand(owner, intent, options);
};

export const startImageCacheCreation = (owner: ProjectOperation, timeoutMs: number): Promise<RunningCommand> => {
  const intent = owner.planImageCacheCreation();
  return startPlannedCommand(owner, intent, { kind: intent.kind, effect: "create", timeoutMs });
};

export const runImageCacheDeletion = async (owner: ProjectOperation, capability: CacheDeletionCapability, timeoutMs: number): Promise<OwnedCommandResult> => {
  const intent = owner.planImageCacheDeletion(capability);
  const result = await (await startPlannedCommand(owner, intent, { kind: intent.kind, effect: "delete", timeoutMs })).exited;
  const launch = owner.recordCommandResult(result.launch);
  const completed = { ...result, launch, exitCode: launch.exitCode ?? result.exitCode };
  if (completed.exitCode !== 0) throw new SiloError(`CLEANUP_REQUIRED: ${intent.kind} failed; receipts and claims retained. ${completed.stderr.slice(-4096)}`, "CLEANUP_REQUIRED");
  return completed;
};

/** The executor group a gate reported and the parent verified, before any grant. */
type GateIdentity = { supervisorPid: number; supervisorIdentity: string; leaderPid: number; groupId: number };

/**
 * One Janitor-supervised executor group: what to launch, how its grant is
 * durably recorded, and where its completion fact is read. Project launches
 * and slot runs differ only in these bindings.
 */
type Gate<Fact extends { exitCode: number }> = {
  id: string;
  root: string;
  executorEntrypoint: string;
  executorArgs: readonly string[];
  kind: string;
  env: Record<string, string> | undefined;
  timeoutMs: number | null;
  capture: boolean;
  output: OutputSink;
  signal: AbortSignal | undefined;
  /** Records the verified group as the launch's owner; returns the grant line the executor receives. */
  grant: (identity: GateIdentity) => string;
  readCompletion: () => Fact | null;
  failureDetails: Readonly<Record<string, unknown>>;
};
type GateResult<Fact> = { exitCode: number; stdout: string; stderr: string; completion: Fact | null };
type RunningGate<Fact> = { identity: GateIdentity; exited: Promise<GateResult<Fact>>; stop: () => void };

export const startGate = async <Fact extends { exitCode: number }>(gate: Gate<Fact>): Promise<RunningGate<Fact>> => {
  gate.signal?.throwIfAborted();
  const startupDeadline = Date.now() + Math.min(gate.timeoutMs ?? LAUNCH_START_TIMEOUT_MS, LAUNCH_START_TIMEOUT_MS);
  const startupRemaining = () => {
    const remaining = startupDeadline - Date.now();
    if (remaining <= 0) throw new SiloError("Timed out waiting for launch identity", "TIMEOUT");
    return remaining;
  };
  const proc = Bun.spawn([
    TILT_SUPERVISOR_BIN, "--pgroup-only", "--watch-pid", String(process.pid), "--grace-ms", String(TILT_DRAIN_GRACE_MS),
    "--", ...executorCommand(gate.executorEntrypoint), ...gate.executorArgs,
  ], {
    cwd: gate.root, env: { ...process.env, ...gate.env }, detached: true,
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  // Bun reaps the supervisor itself; once it has, the handle's PID may be
  // reused, so only a handle with no recorded exit is signalled.
  const stopSupervisor = () => { if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGTERM"); };
  const stdoutReader = proc.stdout.getReader();
  const stderrReader = proc.stderr.getReader();
  const stderr = drain(stderrReader, gate.capture);
  let stdout: Cancellable<string> | undefined;
  const stopAndDrain = async () => {
    stopSupervisor();
    try { await withTimeout(observe(proc.exited), STOP_TIMEOUT_MS, "supervisor drain"); }
    finally { await Promise.all([stdout ? stdout.cancel() : stdoutReader.cancel(), stderr.cancel()]); }
  };
  try {
    const handshakeTimeout = startupRemaining();
    const handshake = await withTimeout({ result: firstLine(stdoutReader), cancel: () => stdoutReader.cancel() }, handshakeTimeout, "launch gate", gate.signal);
    const parts = /^SILO_GATE (\S+) (\d+) (\d+)$/.exec(handshake);
    const leaderPid = Number(parts?.[2]);
    const groupId = Number(parts?.[3]);
    if (parts?.[1] !== gate.id || !Number.isSafeInteger(leaderPid) || leaderPid <= 1 || groupId !== leaderPid) {
      throw new SiloError("Launch gate did not report its actual group leader", "LAUNCH_FAILED");
    }
    const supervisor = await supervisorIdentity(proc.pid, startupRemaining());
    if (!supervisor?.includes(gate.id)) throw new SiloError("Cannot verify launch supervisor", "LAUNCH_FAILED");
    startupRemaining();
    gate.signal?.throwIfAborted();
    const identity: GateIdentity = { supervisorPid: proc.pid, supervisorIdentity: supervisor, leaderPid, groupId };
    proc.stdin.write(`${gate.grant(identity)}\n`);
    proc.stdin.end();
    stdout = drain(stdoutReader, gate.capture, gate.output);
    const finished = Promise.all([proc.exited, stdout.result, stderr.result]);
    const journal = watchCompletion(`${gate.kind} ${gate.id}`, gate.readCompletion);
    // The result is known once the supervisor exits or the executor's fact is
    // journaled. Neither a supervisor that misses its child's exit nor an
    // escaped descendant holding the inherited pipes may then hold the command
    // open: both get one stop window, after which only this launch's own
    // supervisor handle is signalled and the pipes are abandoned.
    const complete = async (): Promise<GateResult<Fact>> => {
      const journaled = await raceOperations<Fact | null>([
        observe(proc.exited.then(() => null)), observe(finished.then(() => null)),
        { result: journal.completion, cancel: journal.stop },
      ]);
      if (!(await settlesWithin(finished, STOP_TIMEOUT_MS))) {
        await stopAndDrain();
      }
      const [supervisorExitCode, stdoutText, stderrText] = await finished;
      return { exitCode: journaled?.exitCode ?? supervisorExitCode, stdout: stdoutText, stderr: stderrText, completion: journaled };
    };
    const completed = complete().catch(async error => {
      await stopAndDrain();
      throw error;
    }).finally(journal.stop);
    const exited = withTimeout({ result: completed, cancel: stopAndDrain }, gate.timeoutMs, gate.kind, gate.signal);
    return { identity, exited, stop: stopSupervisor };
  } catch (error) {
    proc.stdin.end();
    await stopAndDrain();
    const exitCode = proc.exitCode ?? 1;
    const diagnostic = await stderr.result;
    if (error instanceof SiloError && error.code === "LAUNCH_FAILED") {
      throw new SiloError(`${error.message}; supervisor exited ${exitCode}. ${diagnostic.slice(-4096)}`.trimEnd(), error.code, {
        cause: error, details: { ...error.details, ...gate.failureDetails, supervisorExitCode: exitCode },
      });
    }
    throw error;
  }
};

const startPlannedCommand = async (owner: ProjectOperation, intent: Extract<Launch, { phase: "planned" }>, options: CommandOptions): Promise<RunningCommand> => {
  let granted: Extract<Launch, { phase: "granted" }> | undefined;
  const key: CompletionKey = { storePath: owner.storePath, projectId: owner.projectId, generation: owner.generation, launchId: intent.id };
  const running = await startGate<ExecutorCompletion>({
    id: intent.id, root: owner.root, executorEntrypoint: owner.executorEntrypoint,
    executorArgs: [intent.id, owner.root, owner.projectId, String(owner.generation), owner.completionJournal],
    kind: options.kind, env: options.env, timeoutMs: options.timeoutMs, capture: options.capture ?? true, output: "stderr",
    signal: owner.signal,
    grant: identity => {
      granted = { ...intent, phase: "granted", reconciled: false, terminal: false, exitCode: null, ...identity };
      owner.checkpointLaunch(granted);
      return JSON.stringify(granted);
    },
    readCompletion: () => ProjectOperation.readExecutorCompletion(key),
    failureDetails: { launchId: intent.id, generation: owner.generation },
  });
  const launch = granted!;
  const exited = running.exited.then(({ exitCode, stdout, stderr }): OwnedCommandResult => ({
    exitCode, stdout, stderr, launch: { ...launch, phase: "exited", started: true, exitCode, reconciled: options.effect === "none" },
  }));
  return { launch, exited, stop: running.stop };
};

export const runOwnedCommand = async (owner: ProjectOperation, command: string[], options: CommandOptions & { effect: "none" | "delete" }): Promise<OwnedCommandResult> => {
  const running = await startOwnedCommand(owner, command, options);
  const result = await running.exited;
  const recorded = owner.recordCommandResult(result.launch);
  const completed = { ...result, launch: recorded, exitCode: recorded.exitCode ?? result.exitCode };
  if (completed.exitCode !== 0) throw commandFailure(completed, options.kind, owner.generation);
  if (completed.launch.effect === "delete") return { ...completed, launch: owner.reconcileDeletion(completed.launch) };
  return completed;
};

export const commandFailure = (result: OwnedCommandResult, kind: string, generation: number): SiloError => {
  const output = `${result.stdout}\n${result.stderr}`;
  const binding = /address already in use|port is already allocated|failed to bind|EADDRINUSE/i.test(output);
  const code = binding ? "PORT_BIND_CONFLICT" : "COMMAND_FAILED";
  return new SiloError(`${code}: ${kind} exited ${result.exitCode}; owned claims retained. ${output.slice(-4096)}`, code, { details: { launchId: result.launch.id, generation } });
};

/** Signals only the exact journaled supervisor, after identity and group verification. */
export const stopOwnedCommand = async (launch: Launch): Promise<void> => {
  if (launch.terminal) return;
  if (launch.supervisorPid === null) return;
  if (!processAbsent(launch.supervisorPid)) {
    const identity = await supervisorIdentity(launch.supervisorPid);
    if (identity !== launch.supervisorIdentity || !identity?.includes(launch.id)) {
      throw new SiloError(`CLEANUP_REQUIRED: supervisor ${launch.supervisorPid} identity is live or unknown; no signal sent`, "CLEANUP_REQUIRED");
    }
    process.kill(-launch.supervisorPid, "SIGTERM");
  }
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const supervisorGone = processAbsent(launch.supervisorPid);
    const groupGone = launch.groupId === null || processAbsent(-launch.groupId);
    if (supervisorGone && groupGone) return;
    await sleep(50);
  }
  throw new SiloError(`CLEANUP_REQUIRED: recorded group ${launch.groupId} is still live or unknown; claims retained`, "CLEANUP_REQUIRED");
};
