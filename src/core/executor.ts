import { z } from "zod";
import { ProjectOperation } from "./lease_store";
import { LaunchSchema, type ExecutorContext } from "./lease_types";
import { runCommand } from "../utils/exec";
import { withTimeout } from "../utils/timeout";
import { SiloError } from "../utils/errors";

const MAX_GRANT_BYTES = 1024 * 1024;
const ArgumentsSchema = z.tuple([z.string().uuid(), z.string().max(4096), z.string().uuid(), z.coerce.number().int().positive(), z.enum(["account", "parent"])]);

const readGrant = async (): Promise<string> => {
  const reader = Bun.stdin.stream().getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size <= MAX_GRANT_BYTES) {
    const chunk = await reader.read();
    if (chunk.done) return Buffer.concat(chunks).toString("utf8");
    size += chunk.value.byteLength;
    if (size > MAX_GRANT_BYTES) throw new SiloError("Executor grant exceeds 1 MiB", "INVALID_GRANT");
    chunks.push(chunk.value);
  }
  throw new Error("Unreachable grant limit");
};

/** The group leader stays alive to publish completion even when its owning CLI dies. */
export const executorMain = async (args: string[]): Promise<void> => {
  const [id, root, projectId, generation, journal] = ArgumentsSchema.parse(args);
  const group = await runCommand(["ps", "-o", "pgid=", "-p", String(process.pid)], { timeoutMs: 2000, context: "executor group", stdio: "pipe" });
  if (group.exitCode !== 0 || Number(group.stdout.trim()) !== process.pid) throw new SiloError("Executor is not its process-group leader", "INVALID_EXECUTOR");
  const context: ExecutorContext = { launchId: id, root, projectId, generation, leaderPid: process.pid, groupId: process.pid };
  let child: Bun.Subprocess | undefined;
  let cancelled = false;
  // Janitor signals the entire recorded group, including the tool. A second
  // signal can force a tool to exit before it has drained its own foreground work.
  const stop = () => { cancelled = true; };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, stop);
  console.log(`SILO_GATE ${id} ${process.pid} ${process.pid}`);
  let started = false;
  let exitCode = 77;
  try {
    const payload = await withTimeout(readGrant(), 10_000, "executor grant");
    if (payload.trim().length > 0 && !cancelled) {
      const grant = LaunchSchema.parse(JSON.parse(payload));
      if (grant.phase !== "granted" || grant.id !== id || grant.leaderPid !== process.pid || grant.groupId !== process.pid) throw new SiloError("Executor received another launch's grant", "INVALID_GRANT");
      if (journal === "account") await ProjectOperation.validateExecutorGrant(context, grant);
      if (!cancelled) {
        child = Bun.spawn(grant.command, { cwd: root, env: process.env, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
        started = true;
        exitCode = await child.exited;
      }
    }
    if (journal === "account") await ProjectOperation.recordExecutorCompletion(context, { started, exitCode, completedAt: new Date().toISOString() });
    process.exitCode = exitCode;
  } finally {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.off(signal, stop);
  }
};
