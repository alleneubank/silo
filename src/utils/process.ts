import { promises as fs } from "fs";
import {
  PROCESS_CHECK_TIMEOUT_MS,
  TILT_STOP_TIMEOUT_MS,
  TILT_SUPERVISOR_BIN,
} from "../core/constants";
import { runCommand } from "./exec";
import { sleep } from "./sleep";

/** One row of the system process table. */
type ProcessTableRow = {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
};

export const isPidRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const getProcessCommand = async (pid: number): Promise<string | null> => {
  const result = await runCommand(["ps", "-p", String(pid), "-o", "comm="], {
    timeoutMs: PROCESS_CHECK_TIMEOUT_MS,
    context: `ps ${pid}`,
    stdio: "pipe",
  });
  if (result.exitCode !== 0) {
    return null;
  }
  const cmd = result.stdout.trim();
  return cmd.length > 0 ? cmd : null;
};

/**
 * True when `comm` names the process silo tracks as its Tilt.
 *
 * silo records the pid it spawned, which is the supervisor wrapping `tilt up`,
 * so the supervisor counts as well as tilt itself. Anything else means the pid
 * was reused by an unrelated process.
 */
export const isTrackedTiltCommand = (comm: string): boolean =>
  comm.includes("tilt") || comm.includes(TILT_SUPERVISOR_BIN);

export const isTrackedTiltProcess = async (pid: number): Promise<boolean> => {
  const command = await getProcessCommand(pid);
  if (!command) {
    return false;
  }
  return isTrackedTiltCommand(command);
};

const parsePids = (stdout: string): number[] =>
  stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => Number(line))
    .filter((pid) => Number.isInteger(pid));

/**
 * pid, parent and group for every process, in one call.
 *
 * Read as a table rather than per-pid: attributing a Tilt to the stack that
 * started it means walking its ancestry, and a `ps` per step is both slower and
 * racier than one snapshot.
 */
export const readProcessTable = async (): Promise<ProcessTableRow[]> => {
  const result = await runCommand(["ps", "-A", "-o", "pid=,ppid=,pgid="], {
    timeoutMs: PROCESS_CHECK_TIMEOUT_MS,
    context: "ps table",
    stdio: "pipe",
  });
  if (result.exitCode !== 0) {
    return [];
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(
      (fields): fields is [number, number, number] =>
        fields.length === 3 && fields.every((value) => Number.isInteger(value))
    )
    .map(([pid, ppid, pgid]) => ({ pid, ppid, pgid }));
};

/**
 * The working directory of a running process, or null when it cannot be read.
 *
 * Linux exposes it as a symlink in procfs; macOS and the BSDs need lsof. When
 * neither is available the answer is unknown, not "no": callers must treat null
 * as "cannot attribute this process" rather than as a match.
 */
export const getProcessCwd = async (pid: number): Promise<string | null> => {
  if (process.platform === "linux") {
    try {
      return await fs.realpath(`/proc/${pid}/cwd`);
    } catch {
      return null;
    }
  }

  const result = await runCommand(["lsof", "-a", "-d", "cwd", "-p", String(pid), "-Fn"], {
    timeoutMs: PROCESS_CHECK_TIMEOUT_MS,
    context: `lsof cwd ${pid}`,
    stdio: "pipe",
  });
  if (result.exitCode !== 0) {
    return null;
  }

  const line = result.stdout
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("n"));
  return line ? line.slice(1) : null;
};

/**
 * Pids of Tilt processes whose working directory is `cwd`.
 *
 * A process's directory is not in its argv — silo starts Tilt with the project
 * root as the spawn cwd, and a developer's own `tilt up` is just `tilt up` — so
 * the candidates are found by command name and then attributed by reading each
 * one's actual working directory.
 */
export const findTiltPidsInDir = async (cwd: string): Promise<number[]> => {
  const result = await runCommand(["pgrep", "-f", "tilt"], {
    timeoutMs: PROCESS_CHECK_TIMEOUT_MS,
    context: "pgrep tilt",
    stdio: "pipe",
  });
  if (result.exitCode !== 0) {
    return [];
  }

  const target = await fs.realpath(cwd).catch(() => cwd);
  const candidates = parsePids(result.stdout).filter((pid) => pid !== process.pid);

  const attributed = await Promise.all(
    candidates.map(async (pid) => {
      const command = await getProcessCommand(pid);
      if (!command || !isTrackedTiltCommand(command)) {
        return null;
      }
      const processCwd = await getProcessCwd(pid);
      if (processCwd === null) {
        return null;
      }
      const resolved = await fs.realpath(processCwd).catch(() => processCwd);
      return resolved === target ? pid : null;
    })
  );

  return attributed.filter((pid): pid is number => pid !== null);
};

/**
 * Candidates that belong to no stack silo started.
 *
 * Matching on pid alone is not enough: silo records the supervisor's pid, and
 * the supervisor runs `tilt up` as a child in a process group of its own. A
 * Tilt is therefore silo's if it is a recorded pid, descends from one, or sits
 * in the group one leads — anything else is a Tilt started outside silo.
 */
export const excludeKnownStacks = (params: {
  candidates: readonly number[];
  known: readonly number[];
  table: readonly ProcessTableRow[];
}): number[] => {
  const { candidates, known, table } = params;
  const knownPids = new Set(known);
  if (knownPids.size === 0) {
    return [...candidates];
  }

  const rows = new Map(table.map((row) => [row.pid, row]));
  const knownGroups = new Set<number>(known);
  known.forEach((pid) => {
    const row = rows.get(pid);
    if (row) {
      knownGroups.add(row.pgid);
    }
  });

  const belongsToKnownStack = (pid: number): boolean => {
    if (knownPids.has(pid)) {
      return true;
    }
    const seen = new Set<number>();
    let current = rows.get(pid);
    while (current && !seen.has(current.pid)) {
      if (knownPids.has(current.pid) || knownGroups.has(current.pgid)) {
        return true;
      }
      seen.add(current.pid);
      current = current.ppid > 1 ? rows.get(current.ppid) : undefined;
    }
    return false;
  };

  return candidates.filter((pid) => !belongsToKnownStack(pid));
};

export const stopProcess = async (pid: number): Promise<void> => {
  if (!isPidRunning(pid)) {
    return;
  }

  try {
    process.kill(pid, "SIGINT");
  } catch {
    return;
  }

  const start = Date.now();
  while (Date.now() - start < TILT_STOP_TIMEOUT_MS) {
    if (!isPidRunning(pid)) {
      return;
    }
    await sleep(200);
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
};
