import { runCommand } from "../utils/exec";
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
export const processIdentity = async (pid: number, timeoutMs = LAUNCH_START_TIMEOUT_MS): Promise<string | null> => {
  const result = await runCommand(["ps", "-ww", "-p", String(pid), "-o", "uid=,pgid=,lstart=,command="], {
    env: { LC_ALL: "C", TZ: "UTC" }, timeoutMs, context: "inspect recorded process", stdio: "pipe",
  });
  if (result.exitCode !== 0) return null;
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
};

export type Liveness = "absent" | "live" | "unknown";

/**
 * Absence is ESRCH, or a readable identity that differs from the recorded
 * one (the PID now names another process). EPERM and an unreadable identity
 * stay unknown.
 */
export const recordedProcessLiveness = async (recorded: { pid: number; identity: string }): Promise<Liveness> => {
  const probe = probeProcess(recorded.pid);
  if (probe === "absent") return "absent";
  if (probe === "uncertain") return "unknown";
  const identity = await processIdentity(recorded.pid);
  if (identity === null) return probeProcess(recorded.pid) === "absent" ? "absent" : "unknown";
  return identity === recorded.identity ? "live" : "absent";
};
