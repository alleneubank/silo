import { runCommand } from "../utils/exec";
import { SiloError } from "../utils/errors";
import { LAUNCH_START_TIMEOUT_MS } from "./constants";

/** What a null signal says about a PID or (negative) process group. */
type SignalProbe = "absent" | "exists" | "uncertain";

export const probeProcess = (pidOrGroup: number): SignalProbe => {
  if (!Number.isSafeInteger(pidOrGroup) || Math.abs(pidOrGroup) <= 1) return "exists";
  try {
    process.kill(pidOrGroup, 0);
    return "exists";
  } catch (error) {
    // EPERM names a PID another account now owns; it proves nothing about ours.
    return error instanceof Error && "code" in error && error.code === "ESRCH" ? "absent" : "uncertain";
  }
};

/**
 * `uid pgid lstart command` for one PID, or null when `ps` cannot show it.
 * The start time and command distinguish a recorded process from a later
 * process that reuses its numeric PID.
 */
const identityCommand = (pid: number): string[] => ["ps", "-ww", "-p", String(pid), "-o", "uid=,pgid=,lstart=,command="];
const IDENTITY_ENV = { LC_ALL: "C", TZ: "UTC" };

export const processIdentity = async (pid: number, timeoutMs = LAUNCH_START_TIMEOUT_MS): Promise<string | null> => {
  const result = await runCommand(identityCommand(pid), { env: IDENTITY_ENV, timeoutMs, context: "inspect recorded process", stdio: "pipe" });
  if (result.exitCode !== 0) return null;
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
};

/** What one identity read proved: a failed or signalled read proves nothing. */
export type IdentityProbe = { kind: "present"; identity: string } | { kind: "absent" } | { kind: "unknown" };

/**
 * One `ps` read in its own process group, so a signal sent to silo's group
 * cannot end the read and pass for the process being gone. Absence is only
 * ever ESRCH.
 */
export const probeIdentity = async (pid: number, timeoutMs: number): Promise<IdentityProbe> => {
  if (probeProcess(pid) === "absent") return { kind: "absent" };
  let value = "";
  try {
    const result = await runCommand(identityCommand(pid), { env: IDENTITY_ENV, timeoutMs, context: "probe recorded process", stdio: "pipe", ownGroup: true });
    if (result.exitCode === 0) value = result.stdout.trim();
  } catch (error) {
    if (!(error instanceof SiloError && error.code === "TIMEOUT")) throw error;
  }
  if (value.length > 0) return { kind: "present", identity: value };
  return probeProcess(pid) === "absent" ? { kind: "absent" } : { kind: "unknown" };
};

export type Liveness = "absent" | "live" | "unknown";

/**
 * Absence is ESRCH, or a readable identity that differs from the recorded
 * one (the PID now names another process). A PID another account now owns
 * (EPERM) is compared the same way, since `ps` still shows its owner and
 * start time. An unreadable identity stays unknown.
 */
export const recordedProcessLiveness = async (recorded: { pid: number; identity: string }): Promise<Liveness> => {
  if (probeProcess(recorded.pid) === "absent") return "absent";
  const identity = await processIdentity(recorded.pid);
  if (identity === null) return probeProcess(recorded.pid) === "absent" ? "absent" : "unknown";
  return identity === recorded.identity ? "live" : "absent";
};
