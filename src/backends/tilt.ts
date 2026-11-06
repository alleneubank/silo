import { TILT_CI_TIMEOUT_MS } from "../core/constants";
import { startOwnedCommand } from "../core/owned_command";
import type { ProjectOperation } from "../core/lease_store";
import type { TiltConfig } from "../core/types";
import { SiloError } from "../utils/errors";

type TiltCiOptions = { timeout: string | undefined; extraArgs: readonly string[]; webMode?: TiltConfig["webMode"]; managesPort?: boolean };

export const buildTiltCiArgv = ({ timeout, extraArgs, webMode, managesPort }: TiltCiOptions): string[] => {
  if (extraArgs.some(arg => arg === "--host" || arg.startsWith("--host=") ||
    (managesPort && (arg === "--port" || arg.startsWith("--port="))))) {
    throw new SiloError("Tilt host/port passthrough conflicts with silo's exported identity; configure hosts and TILT_PORT in silo.toml", "INVALID_CONFIG");
  }
  if (webMode !== undefined && extraArgs.some(arg => arg === "--web-mode" || arg.startsWith("--web-mode="))) {
    throw new SiloError("Tilt --web-mode passthrough conflicts with tilt.webMode; remove the passthrough flag", "INVALID_CONFIG");
  }
  return ["tilt", "ci", ...(webMode === undefined ? [] : [`--web-mode=${webMode}`]), ...(timeout ? ["--timeout", timeout] : []), ...extraArgs];
};

export const startTilt = (owner: ProjectOperation, env: Record<string, string>, webMode?: TiltConfig["webMode"]) =>
  startOwnedCommand(owner, ["tilt", "up", ...(webMode === undefined ? [] : [`--web-mode=${webMode}`])], {
    kind: "tilt-up", effect: "workload", env, timeoutMs: null, capture: false,
  });

export const tiltCi = async (owner: ProjectOperation, env: Record<string, string>, options: TiltCiOptions) => {
  const running = await startOwnedCommand(owner, buildTiltCiArgv(options), { kind: "tilt-ci", effect: "workload", env, timeoutMs: TILT_CI_TIMEOUT_MS });
  const result = await running.exited;
  const recorded = owner.recordCommandResult(result.launch);
  return { ...result, launch: recorded, exitCode: recorded.exitCode ?? result.exitCode };
};
