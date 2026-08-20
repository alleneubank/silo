import {
  TILT_CI_TIMEOUT_MS,
  TILT_DOWN_TIMEOUT_MS,
  TILT_DRAIN_GRACE_MS,
  TILT_SUPERVISOR_BIN,
} from "../core/constants";
import { runCommandChecked } from "../utils/exec";

/**
 * argv that runs `tilt up` under a supervisor.
 *
 * The supervisor flags must precede `--`; everything after it is the command
 * janitor supervises and drains when silo, its parent, goes away.
 */
export const buildSupervisedTiltArgv = (): readonly string[] => [
  TILT_SUPERVISOR_BIN,
  "--grace-ms",
  String(TILT_DRAIN_GRACE_MS),
  "--",
  "tilt",
  "up",
];

export const startTilt = (params: {
  cwd: string;
  env: Record<string, string>;
}): Bun.Subprocess => {
  const { cwd, env } = params;
  return Bun.spawn([...buildSupervisedTiltArgv()], {
    cwd,
    env: { ...process.env, ...env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
};

export const tiltDown = async (params: {
  cwd: string;
  env: Record<string, string>;
}): Promise<void> => {
  const { cwd, env } = params;
  await runCommandChecked(["tilt", "down"], {
    cwd,
    env,
    timeoutMs: TILT_DOWN_TIMEOUT_MS,
    context: "tilt down",
    stdio: "inherit",
  });
};

export const tiltCi = async (params: {
  cwd: string;
  env: Record<string, string>;
  timeout: string | undefined;
  extraArgs: string[];
}): Promise<void> => {
  const { cwd, env, timeout, extraArgs } = params;
  const args = ["tilt", "ci"];
  if (timeout) {
    args.push("--timeout", timeout);
  }
  if (extraArgs.length > 0) {
    args.push(...extraArgs);
  }
  await runCommandChecked(args, {
    cwd,
    env,
    timeoutMs: TILT_CI_TIMEOUT_MS,
    context: "tilt ci",
    stdio: "inherit",
  });
};
