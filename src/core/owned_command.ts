import { ProjectOperation, processAbsent } from "./lease_store";
import type { Launch } from "./lease_types";
import { runCommand } from "../utils/exec";
import { SiloError } from "../utils/errors";
import { withTimeout } from "../utils/timeout";
import { sleep } from "../utils/sleep";
import { TILT_DRAIN_GRACE_MS, TILT_SUPERVISOR_BIN } from "./constants";

const MAX_OUTPUT_BYTES = 1024 * 1024;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = TILT_DRAIN_GRACE_MS + 5000;

const supervisorIdentity = async (pid: number): Promise<string | null> => {
  const result = await runCommand(["ps", "-ww", "-p", String(pid), "-o", "uid=,pgid=,lstart=,command="], {
    env: { LC_ALL: "C", TZ: "UTC" }, timeoutMs: 2000, context: "inspect recorded supervisor", stdio: "pipe",
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

type CommandOptions = {
  kind: string;
  effect: Launch["effect"];
  env?: Record<string, string>;
  timeoutMs: number | null;
  capture?: boolean;
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

export const startOwnedCommand = async (
  owner: ProjectOperation, command: string[], options: CommandOptions,
): Promise<RunningCommand> => {
  if (options.timeoutMs === null && options.kind !== "tilt-up") throw new Error("Only the interactive Tilt session may have an until-stop lifetime");
  const intent = owner.planLaunch({ kind: options.kind, command, effect: options.effect });
  const proc = Bun.spawn([
    TILT_SUPERVISOR_BIN, "--pgroup-only", "--watch-pid", String(process.pid), "--grace-ms", String(TILT_DRAIN_GRACE_MS),
    "--", process.execPath, owner.executorEntrypoint, "__silo_execute", intent.id, owner.root,
    owner.projectId, String(owner.generation), owner.completionJournal,
  ], {
    cwd: owner.root, env: { ...process.env, ...options.env }, detached: true,
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  const stdoutReader = proc.stdout.getReader();
  const stderr = drain(proc.stderr.getReader(), options.capture ?? true, process.stderr);
  try {
    const handshake = await withTimeout(firstLine(stdoutReader), HANDSHAKE_TIMEOUT_MS, "launch gate");
    const parts = /^SILO_GATE (\S+) (\d+) (\d+)$/.exec(handshake);
    const leaderPid = Number(parts?.[2]);
    const groupId = Number(parts?.[3]);
    if (parts?.[1] !== intent.id || !Number.isSafeInteger(leaderPid) || leaderPid <= 1 || groupId !== leaderPid) {
      throw new SiloError("Launch gate did not report its actual group leader", "LAUNCH_FAILED");
    }
    const identity = await supervisorIdentity(proc.pid);
    if (!identity?.includes(intent.id)) throw new SiloError("Cannot verify launch supervisor", "LAUNCH_FAILED");
    const launch: Extract<Launch, { phase: "granted" }> = { ...intent, phase: "granted", reconciled: false, terminal: false, exitCode: null, supervisorPid: proc.pid, supervisorIdentity: identity, leaderPid, groupId };
    owner.checkpointLaunch(launch);
    proc.stdin.write(`${JSON.stringify(launch)}\n`);
    proc.stdin.end();
    const completed = Promise.all([
      proc.exited, drain(stdoutReader, options.capture ?? true, process.stderr), stderr,
    ]).then(([exitCode, stdout, stderrText]): OwnedCommandResult => ({
      exitCode, stdout, stderr: stderrText, launch: { ...launch, phase: "exited", started: true, exitCode, reconciled: options.effect === "none" },
    }));
    const waited = options.timeoutMs === null ? completed : withTimeout(completed, options.timeoutMs, options.kind);
    const exited = waited.catch(async error => {
      proc.kill("SIGTERM");
      await withTimeout(proc.exited, STOP_TIMEOUT_MS, "supervisor drain");
      throw error;
    });
    return { launch, exited, stop: () => proc.kill("SIGTERM") };
  } catch (error) {
    proc.stdin.end();
    proc.kill("SIGTERM");
    await withTimeout(proc.exited, STOP_TIMEOUT_MS, "ungranted supervisor drain");
    await stderr;
    throw error;
  }
};

export const runOwnedCommand = async (owner: ProjectOperation, command: string[], options: CommandOptions): Promise<OwnedCommandResult> => {
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
