import { ProjectOperation, processAbsent, type CacheDeletionCapability, type CompletionKey } from "./lease_store";
import type { DockerDeletionTarget, ExecutorCompletion, Launch } from "./lease_types";
import { runCommand } from "../utils/exec";
import { SiloError } from "../utils/errors";
import { withTimeout, observe, raceOperations } from "../utils/timeout";
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

const supervisorIdentity = async (pid: number, timeoutMs = LAUNCH_START_TIMEOUT_MS): Promise<string | null> => {
  const result = await runCommand(["ps", "-ww", "-p", String(pid), "-o", "uid=,pgid=,lstart=,command="], {
    env: { LC_ALL: "C", TZ: "UTC" }, timeoutMs, context: "inspect recorded supervisor", stdio: "pipe",
  });
  if (result.exitCode !== 0) return null;
  const value = result.stdout.trim();
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

const drain = async (reader: ReadableStreamDefaultReader<Uint8Array>, capture: boolean, channel: NodeJS.WriteStream): Promise<string> => {
  const decoder = new TextDecoder();
  let result = "";
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return result + decoder.decode();
    if (capture) {
      size += chunk.value.byteLength;
      if (size > MAX_OUTPUT_BYTES) throw new SiloError("Command output exceeds 1 MiB", "COMMAND_OUTPUT_LIMIT");
      result += decoder.decode(chunk.value, { stream: true });
    } else {
      result = (result + decoder.decode(chunk.value, { stream: true })).slice(-4096);
      await new Promise<void>((resolve, reject) => channel.write(chunk.value, error => error ? reject(error) : resolve()));
    }
  }
};

type CompletionWatch = { completion: Promise<ExecutorCompletion>; stop: () => void };

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
const watchCompletion = (key: CompletionKey): CompletionWatch => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let readFailureLogged = false;
  const completion = new Promise<ExecutorCompletion>(resolve => {
    const poll = (delayMs: number) => {
      timer = setTimeout(() => {
        if (stopped) return;
        let fact: ExecutorCompletion | null = null;
        try { fact = ProjectOperation.readExecutorCompletion(key); }
        catch (error) {
          if (!readFailureLogged) logger.verbose(`Completion read for launch ${key.launchId} failed; retrying:`, error instanceof Error ? error.message : String(error));
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

const startPlannedCommand = async (owner: ProjectOperation, intent: Extract<Launch, { phase: "planned" }>, options: CommandOptions): Promise<RunningCommand> => {
  const startupDeadline = Date.now() + Math.min(options.timeoutMs ?? LAUNCH_START_TIMEOUT_MS, LAUNCH_START_TIMEOUT_MS);
  const startupRemaining = () => {
    const remaining = startupDeadline - Date.now();
    if (remaining <= 0) throw new SiloError("Timed out waiting for launch identity", "TIMEOUT");
    return remaining;
  };
  const proc = Bun.spawn([
    TILT_SUPERVISOR_BIN, "--pgroup-only", "--watch-pid", String(process.pid), "--grace-ms", String(TILT_DRAIN_GRACE_MS),
    "--", ...executorCommand(owner.executorEntrypoint), intent.id, owner.root,
    owner.projectId, String(owner.generation), owner.completionJournal,
  ], {
    cwd: owner.root, env: { ...process.env, ...options.env }, detached: true,
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  // Bun reaps the supervisor itself; once it has, the handle's PID may be
  // reused, so only a handle with no recorded exit is signalled.
  const stopSupervisor = () => { if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGTERM"); };
  const capture = options.capture ?? true;
  const stdoutReader = proc.stdout.getReader();
  const stderrReader = proc.stderr.getReader();
  const stderr = drain(stderrReader, capture, process.stderr);
  const stopAndDrain = async () => {
    stopSupervisor();
    try { await withTimeout(observe(proc.exited), STOP_TIMEOUT_MS, "supervisor drain"); }
    finally { await Promise.all([stdoutReader.cancel(), stderrReader.cancel()]); }
  };
  try {
    const handshakeTimeout = startupRemaining();
    const handshake = await withTimeout({ result: firstLine(stdoutReader), cancel: () => stdoutReader.cancel() }, handshakeTimeout, "launch gate");
    const parts = /^SILO_GATE (\S+) (\d+) (\d+)$/.exec(handshake);
    const leaderPid = Number(parts?.[2]);
    const groupId = Number(parts?.[3]);
    if (parts?.[1] !== intent.id || !Number.isSafeInteger(leaderPid) || leaderPid <= 1 || groupId !== leaderPid) {
      throw new SiloError("Launch gate did not report its actual group leader", "LAUNCH_FAILED");
    }
    const identity = await supervisorIdentity(proc.pid, startupRemaining());
    if (!identity?.includes(intent.id)) throw new SiloError("Cannot verify launch supervisor", "LAUNCH_FAILED");
    startupRemaining();
    const launch: Extract<Launch, { phase: "granted" }> = { ...intent, phase: "granted", reconciled: false, terminal: false, exitCode: null, supervisorPid: proc.pid, supervisorIdentity: identity, leaderPid, groupId };
    owner.checkpointLaunch(launch);
    proc.stdin.write(`${JSON.stringify(launch)}\n`);
    proc.stdin.end();
    const finished = Promise.all([proc.exited, drain(stdoutReader, capture, process.stderr), stderr]);
    const journal = watchCompletion({ storePath: owner.storePath, projectId: owner.projectId, generation: owner.generation, launchId: launch.id });
    // The result is known once the supervisor exits or the executor's fact is
    // journaled. Neither a supervisor that misses its child's exit nor an
    // escaped descendant holding the inherited pipes may then hold the command
    // open: both get one stop window, after which only this launch's own
    // supervisor handle is signalled and the pipes are abandoned.
    const complete = async (): Promise<OwnedCommandResult> => {
      const journaled = await raceOperations<ExecutorCompletion | null>([
        observe(proc.exited.then(() => null)), observe(finished.then(() => null)),
        { result: journal.completion, cancel: journal.stop },
      ]);
      if (!(await settlesWithin(finished, STOP_TIMEOUT_MS))) {
        await stopAndDrain();
      }
      const [supervisorExitCode, stdout, stderrText] = await finished;
      const exitCode = journaled?.exitCode ?? supervisorExitCode;
      return { exitCode, stdout, stderr: stderrText, launch: { ...launch, phase: "exited", started: true, exitCode, reconciled: options.effect === "none" } };
    };
    const completed = complete().catch(async error => {
      await stopAndDrain();
      throw error;
    }).finally(journal.stop);
    const exited = options.timeoutMs === null ? completed : withTimeout({ result: completed, cancel: stopAndDrain }, options.timeoutMs, options.kind);
    return { launch, exited, stop: stopSupervisor };
  } catch (error) {
    proc.stdin.end();
    await stopAndDrain();
    const exitCode = proc.exitCode ?? 1;
    const diagnostic = await stderr;
    if (error instanceof SiloError && error.code === "LAUNCH_FAILED") {
      throw new SiloError(`${error.message}; supervisor exited ${exitCode}. ${diagnostic.slice(-4096)}`.trimEnd(), error.code, {
        cause: error, details: { ...error.details, launchId: intent.id, generation: owner.generation, supervisorExitCode: exitCode },
      });
    }
    throw error;
  }
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
