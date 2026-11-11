import { z } from "zod";
import { setImmediate } from "node:timers/promises";
import { ProjectOperation } from "./lease_store";
import { LaunchSchema, type ExecutorContext } from "./lease_types";
import { runCommand } from "../utils/exec";
import { withTimeout, type Cancellable } from "../utils/timeout";
import { SiloError } from "../utils/errors";
import { EXECUTOR_GRANT_TIMEOUT_MS, LAUNCH_START_TIMEOUT_MS } from "./constants";
import { prepareCacheRemoval } from "./cache_executor";

const MAX_GRANT_BYTES = 1024 * 1024;
const ArgumentsSchema = z.tuple([z.string().uuid(), z.string().max(4096), z.string().uuid(), z.coerce.number().int().positive(), z.enum(["account", "parent"])]);

const consumeGrant = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> => {
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

const readGrant = (): Cancellable<string> => {
  const reader = Bun.stdin.stream().getReader();
  let released = false;
  const release = () => { if (!released) { reader.releaseLock(); released = true; } };
  const result = consumeGrant(reader).then(payload => { release(); return payload; });
  return { result, cancel: async () => { if (!released) { await reader.cancel(); release(); } } };
};

/** The group leader stays alive to publish completion even when its owning CLI dies. */
export const executorMain = async (args: string[]): Promise<void> => {
  const [id, root, projectId, generation, journal] = ArgumentsSchema.parse(args);
  const group = await runCommand(["ps", "-o", "pgid=", "-p", String(process.pid)], { timeoutMs: LAUNCH_START_TIMEOUT_MS, context: "executor group", stdio: "pipe" });
  if (group.exitCode !== 0 || Number(group.stdout.trim()) !== process.pid) throw new SiloError("Executor is not its process-group leader", "INVALID_EXECUTOR");
  const context: ExecutorContext = { launchId: id, root, projectId, generation, leaderPid: process.pid, groupId: process.pid };
  let child: Bun.Subprocess | undefined;
  let cancelled = false;
  const grantCancelled = new AbortController();
  // Janitor signals the entire recorded group, including the tool. A second
  // signal can force a tool to exit before it has drained its own foreground work.
  const stop = () => { cancelled = true; grantCancelled.abort(); };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, stop);
  console.log(`SILO_GATE ${id} ${process.pid} ${process.pid}`);
  let started = false;
  let exitCode = 77;
  try {
    let payload: string;
    try {
      payload = await withTimeout(readGrant(), EXECUTOR_GRANT_TIMEOUT_MS, "executor grant", grantCancelled.signal);
    } catch (error) {
      if (journal === "account") await ProjectOperation.recordExecutorRefusal(context);
      if (grantCancelled.signal.aborted && error === grantCancelled.signal.reason) { process.exitCode = 77; return; }
      throw error;
    }
    if (payload.trim().length > 0 && !cancelled) {
      const grant = LaunchSchema.parse(JSON.parse(payload));
      if (grant.phase !== "granted" || grant.id !== id || grant.leaderPid !== process.pid || grant.groupId !== process.pid) throw new SiloError("Executor received another launch's grant", "INVALID_GRANT");
      if (journal === "account") await ProjectOperation.validateExecutorGrant(context, grant);
      const cache = grant.deletionTarget?.kind === "image-cache" ? await prepareCacheRemoval(context, grant, journal).catch(async error => {
        if (journal === "account") await ProjectOperation.recordExecutorCompletion(context, { started: false, exitCode: 77, completedAt: new Date().toISOString() });
        throw error;
      }) : null;
      // Grant reads and validation can finish in microtasks while a delivered
      // signal is still queued. Let its handler run before authorizing spawn.
      await setImmediate();
      if (!cancelled) {
        // WAIVER(atomicity): Docker has no conditional volume delete. External
        // delete/recreate after the final inspect can replace this cache before
        // removal. Permanent — the local volume API offers only a name address.
        const command = cache ? ["docker", "volume", "rm", cache.name] : grant.command;
        child = Bun.spawn(command, { cwd: root, env: process.env, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
        started = true;
        exitCode = await child.exited;
      }
    }
    if (journal === "account") {
      if (started) await ProjectOperation.recordExecutorCompletion(context, { started, exitCode, completedAt: new Date().toISOString() });
      else await ProjectOperation.recordExecutorRefusal(context);
    }
    process.exitCode = exitCode;
  } finally {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.off(signal, stop);
  }
};
