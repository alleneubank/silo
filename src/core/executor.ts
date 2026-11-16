import { z } from "zod";
import { setImmediate } from "node:timers/promises";
import { ProjectOperation } from "./lease_store";
import { LaunchSchema, type ExecutorContext } from "./lease_types";
import { runCommand } from "../utils/exec";
import { withTimeout, type Cancellable } from "../utils/timeout";
import { SiloError } from "../utils/errors";
import { EXECUTOR_GRANT_TIMEOUT_MS, LAUNCH_START_TIMEOUT_MS } from "./constants";
import { prepareCacheRemoval } from "./cache_executor";
import assert from "node:assert/strict";
import { accountStorePath } from "./allocation_domain";
import { SlotQueue } from "./slot_store";
import { RunExecutorGrantSchema, SlotExecutorGrantSchema, type RunExecutorGrant, type SlotCompletion } from "./slot_types";

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

const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** Janitor started this process as the leader of the group the parent will record. */
const assertGroupLeader = async (): Promise<void> => {
  const group = await runCommand(["ps", "-o", "pgid=", "-p", String(process.pid)], { timeoutMs: LAUNCH_START_TIMEOUT_MS, context: "executor group", stdio: "pipe" });
  if (group.exitCode !== 0 || Number(group.stdout.trim()) !== process.pid) throw new SiloError("Executor is not its process-group leader", "INVALID_EXECUTOR");
};

/**
 * Janitor signals the entire recorded group, including the tool. A second
 * signal can force a tool to exit before it has drained its own foreground
 * work, so the executor only stops starting new work.
 */
const stopRequests = () => {
  const controller = new AbortController();
  const stop = () => controller.abort();
  for (const signal of STOP_SIGNALS) process.on(signal, stop);
  return { signal: controller.signal, close: () => { for (const signal of STOP_SIGNALS) process.off(signal, stop); } };
};

/** The group leader stays alive to publish completion even when its owning CLI dies. */
export const executorMain = async (args: string[]): Promise<void> => {
  if (args[0] === "slot") return slotExecutorMain(args.slice(1));
  if (args[0] === "run") return runExecutorMain(args.slice(1));
  const [id, root, projectId, generation, journal] = ArgumentsSchema.parse(args);
  await assertGroupLeader();
  const context: ExecutorContext = { launchId: id, root, projectId, generation, leaderPid: process.pid, groupId: process.pid };
  let child: Bun.Subprocess | undefined;
  const stop = stopRequests();
  console.log(`SILO_GATE ${id} ${process.pid} ${process.pid}`);
  let started = false;
  let exitCode = 77;
  try {
    let payload: string;
    try {
      payload = await withTimeout(readGrant(), EXECUTOR_GRANT_TIMEOUT_MS, "executor grant", stop.signal);
    } catch (error) {
      if (journal === "account") await ProjectOperation.recordExecutorRefusal(context);
      if (stop.signal.aborted && error === stop.signal.reason) { process.exitCode = 77; return; }
      throw error;
    }
    if (payload.trim().length > 0 && !stop.signal.aborted) {
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
      if (!stop.signal.aborted) {
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
    stop.close();
  }
};

// Each attempt already waits the store's 5 s busy timeout.
const COMPLETION_RECORD_ATTEMPTS = 3;
const COMPLETION_RETRY_MS = 250;
const RunArgumentsSchema = z.tuple([z.string().uuid(), z.string().max(4096)]);
const SPAWN_REFUSED_EXIT = 77;

/** Reports this group to the parent, then reads its grant; null when stopped or closed without one. */
const awaitRunGrant = async (runId: string, stop: AbortSignal): Promise<string | null> => {
  console.log(`SILO_GATE ${runId} ${process.pid} ${process.pid}`);
  let payload: string;
  try { payload = await withTimeout(readGrant(), EXECUTOR_GRANT_TIMEOUT_MS, "executor grant", stop); }
  catch (error) {
    if (stop.aborted && error === stop.reason) return null;
    throw error;
  }
  // EOF without a grant executes nothing and records nothing.
  return payload.trim().length === 0 ? null : payload;
};

const assertOwnGrant = (grant: RunExecutorGrant, runId: string): void => {
  if (grant.runId !== runId || grant.leaderPid !== process.pid || grant.groupId !== process.pid) throw new SiloError("Executor received another run's grant", "INVALID_GRANT");
};

/** A run without slots: the command alone, its status carried only by this process's exit. */
const runExecutorMain = async (args: string[]): Promise<void> => {
  const [runId, root] = RunArgumentsSchema.parse(args);
  await assertGroupLeader();
  const stop = stopRequests();
  try {
    const payload = await awaitRunGrant(runId, stop.signal);
    if (payload === null) { process.exitCode = SPAWN_REFUSED_EXIT; return; }
    const grant = RunExecutorGrantSchema.parse(JSON.parse(payload));
    assertOwnGrant(grant, runId);
    // Let a queued stop signal run before authorizing the spawn.
    await setImmediate();
    if (stop.signal.aborted) { process.exitCode = SPAWN_REFUSED_EXIT; return; }
    const child = Bun.spawn(grant.command, { cwd: root, env: process.env, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
    process.exitCode = await child.exited;
  } finally {
    stop.close();
  }
};

/**
 * A slot run's group: each on-acquire step, then the command, in the project
 * root. The first failing step stops the run before the command starts.
 */
const slotExecutorMain = async (args: string[]): Promise<void> => {
  const [runId, root] = RunArgumentsSchema.parse(args);
  await assertGroupLeader();
  const stop = stopRequests();
  const storePath = accountStorePath();
  // The exit status is set first: if the store stays busy past every retry,
  // the parent still reads the command's status from the supervisor's exit.
  const record = async (fact: Omit<SlotCompletion, "runId" | "leaderPid" | "groupId" | "completedAt">) => {
    process.exitCode = fact.exitCode;
    const completion = { runId, leaderPid: process.pid, groupId: process.pid, ...fact, completedAt: new Date().toISOString() };
    for (let attempt = 1; ; attempt += 1) {
      try { SlotQueue.recordCompletion(storePath, completion); return; }
      catch (error) {
        const storeUnavailable = error instanceof SiloError && error.code === "LEASE_STORE_UNAVAILABLE";
        const storeBusy = error instanceof Error && "code" in error && String(error.code).startsWith("SQLITE_BUSY");
        const busy = storeUnavailable || storeBusy;
        if (!busy || attempt >= COMPLETION_RECORD_ATTEMPTS) {
          process.stderr.write(`silo warn: completion of run ${runId} was not recorded: ${error instanceof Error ? error.message : String(error)}\n`);
          return;
        }
        await Bun.sleep(COMPLETION_RETRY_MS * attempt);
      }
    }
  };
  try {
    const payload = await awaitRunGrant(runId, stop.signal);
    if (payload === null) { process.exitCode = SPAWN_REFUSED_EXIT; return; }
    const grant = SlotExecutorGrantSchema.parse(JSON.parse(payload));
    assertOwnGrant(grant, runId);
    const holder = SlotQueue.recordedHolder(storePath, runId, process.pid);
    assert.deepEqual([holder.command, holder.root], [grant.command, root], "Slot grant differs from its durable run");
    const steps = [...grant.onAcquire.map(step => ["/bin/sh", "-c", step]), grant.command];
    for (const [index, command] of steps.entries()) {
      // Let a queued stop signal run before authorizing the next spawn.
      await setImmediate();
      if (stop.signal.aborted) { await record({ started: false, exitCode: SPAWN_REFUSED_EXIT, failedStep: index < grant.onAcquire.length ? index : null }); return; }
      const child = Bun.spawn(command, { cwd: root, env: process.env, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
      const exitCode = await child.exited;
      const isCommand = index === grant.onAcquire.length;
      if (isCommand || exitCode !== 0) {
        await record({ started: isCommand, exitCode, failedStep: isCommand ? null : index });
        return;
      }
    }
  } finally {
    stop.close();
  }
};
