import { TOOL_CHECK_TIMEOUT_MS } from "../core/constants";
import { missingToolsMessage } from "./breadcrumbs";
import { runCommand } from "./exec";
import { SiloError } from "./errors";

const commandExists = async (cmd: string): Promise<boolean> => {
  const result = await runCommand(["/bin/sh", "-c", `command -v ${cmd}`], {
    timeoutMs: TOOL_CHECK_TIMEOUT_MS,
    context: `command -v ${cmd}`,
    stdio: "pipe",
  });

  return result.exitCode === 0 && result.stdout.trim().length > 0;
};

export const ensureToolsAvailable = async (tools: string[]): Promise<void> => {
  const checks = await Promise.all(
    tools.map(async (tool) => ({ tool, ok: await commandExists(tool) }))
  );

  const missing = checks.filter((check) => !check.ok).map((check) => check.tool);
  if (missing.length > 0) {
    throw new SiloError(missingToolsMessage(missing), "MISSING_TOOL");
  }
};
