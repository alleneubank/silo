import {
  TILT_CI_TIMEOUT_MS,
  TILT_DOWN_TIMEOUT_MS,
  TILT_DRAIN_GRACE_MS,
  TILT_SUPERVISOR_BIN,
} from "../core/constants";
import { runCommandChecked } from "../utils/exec";
import type { TiltConfig } from "../core/types";
import { SiloError } from "../utils/errors";

/**
 * argv that runs `tilt up` under a supervisor.
 *
 * The supervisor flags must precede `--`; everything after it is the command
 * janitor supervises and drains when silo, its parent, goes away.
 */
export const buildSupervisedTiltArgv = (webMode?: TiltConfig["webMode"]): readonly string[] => [
  TILT_SUPERVISOR_BIN,
  "--grace-ms",
  String(TILT_DRAIN_GRACE_MS),
  "--",
  "tilt",
  "up",
  ...(webMode === undefined ? [] : [`--web-mode=${webMode}`]),
];

export const startTilt = (params: {
  cwd: string;
  env: Record<string, string>;
  webMode?: TiltConfig["webMode"];
}): Bun.Subprocess => {
  const { cwd, env } = params;
  return Bun.spawn([...buildSupervisedTiltArgv(params.webMode)], {
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

type TiltCiOptions = {
  timeout: string | undefined;
  extraArgs: readonly string[];
  webMode?: TiltConfig["webMode"];
};

export const buildTiltCiArgv = ({ timeout, extraArgs, webMode }: TiltCiOptions): string[] => {
  if (webMode !== undefined && extraArgs.some((arg) => arg === "--web-mode" || arg.startsWith("--web-mode="))) {
    throw new SiloError("Tilt --web-mode passthrough conflicts with tilt.webMode; remove the passthrough flag", "INVALID_CONFIG");
  }
  const args = ["tilt", "ci"];
  if (webMode !== undefined) {
    args.push(`--web-mode=${webMode}`);
  }
  if (timeout) {
    args.push("--timeout", timeout);
  }
  if (extraArgs.length > 0) {
    args.push(...extraArgs);
  }
  return args;
};

export const tiltCi = async (params: TiltCiOptions & {
  cwd: string;
  env: Record<string, string>;
}): Promise<void> => {
  const { cwd, env } = params;
  await runCommandChecked(buildTiltCiArgv(params), {
    cwd,
    env,
    timeoutMs: TILT_CI_TIMEOUT_MS,
    context: "tilt ci",
    stdio: "inherit",
  });
};
