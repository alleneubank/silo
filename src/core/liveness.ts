import { readLockfile } from "./lockfile";
import { isPidRunning, isTrackedTiltProcess } from "../utils/process";
import type { DisownedTilt, InstanceState } from "./types";

/**
 * Answers whether a pid silo recorded is still the Tilt it recorded.
 *
 * Injectable so callers can be tested without a real process tree.
 */
type TiltProbe = (pid: number) => Promise<boolean>;

/**
 * Liveness for a recorded pid: running AND still the tracked tilt/supervisor.
 *
 * The second half is what makes this safe against pid reuse — an unrelated
 * process that inherited the number must not read as a live stack.
 */
export const probeTilt: TiltProbe = async (pid: number): Promise<boolean> =>
  isPidRunning(pid) && (await isTrackedTiltProcess(pid));

export const findLiveDisowned = async (params: {
  disowned: readonly DisownedTilt[] | undefined;
  probe?: TiltProbe;
}): Promise<DisownedTilt[]> => {
  const { disowned, probe = probeTilt } = params;
  if (!disowned || disowned.length === 0) {
    return [];
  }
  const liveness = await Promise.all(disowned.map((entry) => probe(entry.pid)));
  return disowned.filter((_entry, index) => liveness[index] === true);
};

/** One line per stack: pid, instance name, and the ports it still answers on. */
export const describeDisownedStacks = (entries: readonly DisownedTilt[]): string =>
  entries
    .map(
      (entry) =>
        `pid ${entry.pid} (instance '${entry.name}', ports ${Object.values(entry.ports).join(", ")})`
    )
    .join("; ");

/** Every port the given stacks still answer on. */
export const disownedPorts = (entries: readonly DisownedTilt[]): number[] =>
  entries.flatMap((entry) => Object.values(entry.ports));

/**
 * Why a running instance does not satisfy what the caller asked for, or null
 * when it does.
 *
 * Reusing a live instance is only a no-op if it is the instance that was
 * requested: `silo up other-name` or `silo up --profile other` must not report
 * success for something else.
 */
export const describeInstanceMismatch = (params: {
  instance: InstanceState;
  requestedName: string | undefined;
  requestedProfile: string | undefined;
}): string | null => {
  const { instance, requestedName, requestedProfile } = params;

  if (requestedName !== undefined && requestedName !== instance.name) {
    return `it is running as '${instance.name}', not '${requestedName}'`;
  }
  if (requestedProfile !== undefined && requestedProfile !== instance.profile) {
    const current = instance.profile
      ? `profile '${instance.profile}'`
      : "the base config";
    return `it is running with ${current}, not profile '${requestedProfile}'`;
  }
  return null;
};

/**
 * The instance state after the Tilt with `pid` has exited.
 *
 * `tiltPid` is cleared only when it is still this pid: after `silo up --force`
 * the lockfile belongs to the replacement stack, and the displaced `silo up`
 * exiting later must not erase the replacement's ownership. Either way the pid
 * stops being listed as a live disowned stack.
 */
export const releaseTiltOwnership = (params: {
  instance: InstanceState;
  pid: number | undefined;
}): InstanceState => {
  const { instance, pid } = params;
  const { tiltPid, tiltStartedAt, disownedTilts, ...rest } = instance;

  const remaining = (disownedTilts ?? []).filter((entry) => entry.pid !== pid);
  const keepsOwner = tiltPid !== undefined && tiltPid !== pid;

  return {
    ...rest,
    ...(keepsOwner
      ? {
          tiltPid,
          ...(tiltStartedAt !== undefined && { tiltStartedAt }),
        }
      : {}),
    ...(remaining.length > 0 ? { disownedTilts: remaining } : {}),
  };
};

/**
 * What `silo up` should do about the instance already recorded in the lockfile.
 *
 * `reuse` carries the live instance so the caller can report it instead of
 * forking a second stack; `start` carries the stack `--force` is about to
 * displace, if any.
 */
type UpPreflight =
  | { readonly action: "reuse"; readonly instance: InstanceState; readonly pid: number }
  | { readonly action: "blocked"; readonly liveDisowned: readonly DisownedTilt[] }
  | { readonly action: "start"; readonly disowning: DisownedTilt | null };

/**
 * Decide what happens to a live Tilt when `silo up` runs again.
 *
 * Read-only on purpose: the displaced stack is only written into the lockfile
 * as part of the same write that hands ownership to its replacement. Recording
 * the transfer up front would, on any later failure, leave a live stack with no
 * `tiltPid` — and the next ordinary `up` would start a duplicate beside it.
 */
export const resolveUpPreflight = async (params: {
  projectRoot: string;
  force: boolean;
  probe?: TiltProbe;
}): Promise<UpPreflight> => {
  const { projectRoot, force, probe = probeTilt } = params;

  const lockfile = await readLockfile(projectRoot);
  const instance = lockfile?.instance;
  const pid = instance?.tiltPid;
  if (!instance || pid === undefined || !(await probe(pid))) {
    if (force) {
      return { action: "start", disowning: null };
    }
    // Nobody owns the lockfile, but a stack from this project is still up:
    // either a `--force` run failed partway through the handover, or the
    // replacement it started has since exited. Starting here would be the
    // silent duplicate this guard exists to prevent, so make the call the
    // caller's: stop that stack, or ask for a parallel one with --force.
    const liveDisowned = await findLiveDisowned({
      disowned: instance?.disownedTilts,
      probe,
    });
    if (liveDisowned.length > 0) {
      return { action: "blocked", liveDisowned };
    }
    return { action: "start", disowning: null };
  }

  if (!force) {
    return { action: "reuse", instance, pid };
  }

  return {
    action: "start",
    disowning: {
      pid,
      name: instance.name,
      ports: instance.ports,
      ...(instance.tiltStartedAt !== undefined && { startedAt: instance.tiltStartedAt }),
      disownedAt: new Date().toISOString(),
    },
  };
};
