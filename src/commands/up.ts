import { loadConfig } from "../core/config";
import {
  describeDisownedStacks,
  describeInstanceMismatch,
  disownedPorts,
  releaseTiltOwnership,
  resolveUpPreflight,
} from "../core/liveness";
import { withStartupClaim } from "../core/startup_claim";
import { resolveInstanceUrls } from "../core/instance";
import { readLockfile, updateLockfile, writeLockfile } from "../core/lockfile";
import { registerInstance } from "../core/port_registry";
import { sanitizeName } from "../core/name";
import { applyProfile, resolveExplicitProfile } from "../core/profile";
import { logKeyValues, logger } from "../utils/logger";
import { startTilt } from "../backends/tilt";
import { SiloError } from "../utils/errors";
import { prepareTiltEnvironment } from "./prepare";
import type { InstanceState, ResolvedConfig } from "../core/types";

const reportRunningInstance = (params: {
  baseConfig: ResolvedConfig;
  instance: InstanceState;
  pid: number;
}): void => {
  const { baseConfig, instance, pid } = params;
  const profileName = instance.profile;
  // The running stack's profile may have been removed from silo.toml since it
  // started. Reporting it is still the right answer; only its URLs are lost.
  let config = baseConfig;
  if (profileName) {
    try {
      config = applyProfile(baseConfig, profileName);
    } catch {
      logger.warn(
        `Profile '${profileName}' is no longer defined in config; URLs may be incomplete`
      );
    }
  }

  logger.info(`Instance '${instance.name}' is already running (Tilt pid ${pid})`);
  if (profileName) {
    logger.info(`Profile: ${profileName}`);
  }
  logKeyValues("Ports", instance.ports);
  logKeyValues("URLs", resolveInstanceUrls({ config, instance }));
  logger.info(
    "Nothing to start. Run 'silo down' to stop it, or 'silo up --force' for a parallel stack."
  );
};

/**
 * Everything from the liveness check to recording the new pid.
 *
 * Held under the project's startup claim, because until `tiltPid` is written
 * the lockfile cannot tell a concurrent `silo up` that a stack is coming up.
 * Returns the started process, or null when the run was an idempotent no-op.
 */
const startStack = async (params: {
  baseConfig: ResolvedConfig;
  nameArg: string | undefined;
  options: { config: string; force: boolean; profile: string | undefined };
}): Promise<{ config: ResolvedConfig; proc: Bun.Subprocess } | null> => {
  const { baseConfig, nameArg, options } = params;

  // Before anything mutates ports, clusters or hooks: a live Tilt for this
  // project root means `up` has nothing to do. Starting a second one would
  // succeed silently on ephemeral ports and leave two stacks answering for
  // one project.
  const preflight = await resolveUpPreflight({
    projectRoot: baseConfig.projectRoot,
    force: options.force,
  });

  if (preflight.action === "blocked") {
    throw new SiloError(
      `${preflight.liveDisowned.length} stack(s) from this project are running but no longer own the lockfile: ` +
        `${describeDisownedStacks(preflight.liveDisowned)}. ` +
        "Stop them with 'kill <pid>', or run 'silo up --force' to start another stack beside them.",
      "DISOWNED_RUNNING"
    );
  }

  if (preflight.action === "reuse") {
    // Reuse is only a no-op when the live instance is the one being asked for.
    const mismatch = describeInstanceMismatch({
      instance: preflight.instance,
      requestedName: nameArg ? sanitizeName(nameArg) : undefined,
      requestedProfile: resolveExplicitProfile(options.profile),
    });
    if (mismatch) {
      throw new SiloError(
        `Instance '${preflight.instance.name}' is already running: ${mismatch}. ` +
          "Run 'silo down' first, or 'silo up --force' for a parallel stack.",
        "ALREADY_RUNNING"
      );
    }

    reportRunningInstance({
      baseConfig,
      instance: preflight.instance,
      pid: preflight.pid,
    });
    return null;
  }
  if (preflight.disowning) {
    const { name, pid } = preflight.disowning;
    logger.warn(
      `Instance '${name}' is still running (Tilt pid ${pid}); --force starts a parallel stack on new ports.`
    );
    logger.warn(
      `It no longer owns the lockfile. Stop it with 'kill ${pid}'; 'silo down' will not.`
    );
  }

  const { config, envVars } = await prepareTiltEnvironment({
    baseConfig,
    nameArg,
    options,
    disowning: preflight.disowning,
  });

  logger.info("Starting Tilt");
  const tiltProc = startTilt({ cwd: config.projectRoot, env: envVars });
  await updateLockfile(config.projectRoot, (current) => ({
    ...current.instance,
    tiltPid: tiltProc.pid,
    tiltStartedAt: new Date().toISOString(),
  }));
  logger.info(`Tilt started (pid ${tiltProc.pid})`);

  return { config, proc: tiltProc };
};

export const up = async (
  nameArg: string | undefined,
  options: { config: string; force: boolean; profile: string | undefined }
): Promise<void> => {
  logger.info("Loading config");
  const baseConfig = await loadConfig(options.config);
  logger.verbose(`Config path: ${baseConfig.configPath}`);

  const started = await withStartupClaim(baseConfig.projectRoot, () =>
    startStack({ baseConfig, nameArg, options })
  );
  if (!started) {
    return;
  }
  const { config, proc: tiltProc } = started;

  const handleExit = async () => {
    const current = await readLockfile(config.projectRoot);
    if (!current) {
      return;
    }

    const next = releaseTiltOwnership({
      instance: current.instance,
      pid: tiltProc.pid,
    });
    await writeLockfile(config.projectRoot, next);

    // This stack's ports are free again. The registry entry is per project and
    // stays live while the lockfile exists, so peers keep avoiding whatever it
    // last named until someone rewrites it — do that here rather than leaving
    // the ports reserved until the next silo command.
    await registerInstance({
      projectRoot: config.projectRoot,
      name: next.name,
      ports: [
        ...Object.values(next.ports),
        ...disownedPorts(next.disownedTilts ?? []),
      ],
    });
  };

  const signalHandler = async (signal: NodeJS.Signals) => {
    try {
      tiltProc.kill(signal);
    } catch {
      // ignore
    }
  };

  process.on("SIGINT", signalHandler);
  process.on("SIGTERM", signalHandler);

  await tiltProc.exited;
  await handleExit();
};
