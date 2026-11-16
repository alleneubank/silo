import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SlotQueue, type QueuedRun } from "../core/slot_store";
import { kernelEphemeralRange, insideRange } from "../core/port_range";
import { withTimeout } from "../utils/timeout";

// The CLI is built with its native account home replaced by a private
// directory, so these runs never read or write the real ~/.silo. HOME points
// there too, keeping the legacy-registry scan inside the private account.
let base: string;
let account: string;
let bin: string;
let cli: string;
let storePath: string;
let hostFile: string;

beforeAll(async () => {
  // silo records resolved project roots; macOS TMPDIR sits behind the /var symlink.
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "silo-run-")));
  account = path.join(base, "account");
  bin = path.join(base, "bin");
  mkdirSync(path.join(account, ".silo"), { recursive: true });
  mkdirSync(bin);
  storePath = path.join(account, ".silo/leases.sqlite");
  hostFile = path.join(account, ".silo/host.toml");
  // Any Docker invocation leaves evidence; slot runs must never make one.
  writeFileSync(path.join(bin, "docker"), `#!/bin/sh\necho "$*" >> ${JSON.stringify(path.join(base, "docker-called"))}\nexit 1\n`, { mode: 0o755 });
  const privateAccount: Bun.BunPlugin = {
    name: "private-account",
    setup(build) {
      build.onLoad({ filter: /\/allocation_domain\.ts$/ }, () => ({
        contents: `export const accountHome = () => ${JSON.stringify(account)}; export const accountStorePath = () => ${JSON.stringify(storePath)};`,
        loader: "ts",
      }));
    },
  };
  const build = await Bun.build({ entrypoints: [path.resolve(import.meta.dir, "../cli.ts")], target: "bun", outdir: base, plugins: [privateAccount] });
  if (!build.success) throw new AggregateError(build.logs, "Private CLI build failed");
  cli = path.join(base, "cli.js");
}, 60_000);

afterAll(() => { if (base) rmSync(base, { recursive: true }); });

const setCaps = (caps: Record<string, number>): void => {
  writeFileSync(hostFile, `[slots]\n${Object.entries(caps).map(([name, cap]) => `${name} = ${cap}`).join("\n")}\n`);
};

/** A project whose silo.toml declares the given slot tables. */
const project = (slots: string): string => {
  const root = path.join(base, `project-${randomUUID().slice(0, 8)}`);
  mkdirSync(root);
  writeFileSync(path.join(root, "silo.toml"), `version = 1\n${slots}\n`);
  return root;
};

type Finished = { exitCode: number; stdout: string; stderr: string };
type Started = { proc: Bun.Subprocess<"ignore", "pipe", "pipe">; finished: Promise<Finished>; stderrSoFar: () => string };

const collect = async (stream: ReadableStream<Uint8Array>, onText: (text: string) => void): Promise<string> => {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) { text += decoder.decode(chunk, { stream: true }); onText(text); }
  return text + decoder.decode();
};

// Every CLI process a test starts; afterEach kills survivors and the groups
// they recorded, so a failing test leaks no process.
const startedPids = new Set<number>();
const started: Started[] = [];

afterEach(async () => {
  const leftover = started.splice(0).filter(s => s.proc.exitCode === null && s.proc.signalCode === null);
  const groups = existsSync(storePath) ? runs().flatMap(q => q.run.phase === "held" && q.run.launch && startedPids.has(q.run.waiter.pid) ? [q.run.launch.groupId] : []) : [];
  for (const s of leftover) s.proc.kill("SIGKILL");
  for (const group of groups) { try { process.kill(-group, "SIGKILL"); } catch { /* already gone */ } }
  await Promise.all(leftover.map(s => s.proc.exited));
  startedPids.clear();
});

const start = (root: string, args: string[]): Started => {
  const proc = Bun.spawn([process.execPath, cli, ...args], {
    cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 60_000,
    env: { ...process.env, HOME: account, SILO_PORT_REGISTRY_DIR: path.join(account, "registry"), PATH: `${bin}:${process.env.PATH}` },
  });
  let stderrSoFar = "";
  const finished = Promise.all([proc.exited, new Response(proc.stdout).text(), collect(proc.stderr, text => { stderrSoFar = text; })])
    .then(([exitCode, stdout, stderr]) => ({ exitCode, stdout, stderr }));
  const value = { proc, finished, stderrSoFar: () => stderrSoFar };
  startedPids.add(proc.pid);
  started.push(value);
  return value;
};

const settle = (started: Started, label: string): Promise<Finished> =>
  withTimeout({ result: started.finished, cancel: () => { if (started.proc.exitCode === null) started.proc.kill("SIGKILL"); } }, 30_000, label);

const runCli = (root: string, args: string[]): Promise<Finished> => settle(start(root, args), args.join(" "));

const waitFor = async (condition: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + 15_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await Bun.sleep(20);
  }
};

const runs = (): QueuedRun[] => SlotQueue.inspect(storePath);
const holderOf = (slot: string): QueuedRun | undefined => runs().find(q => q.run.phase === "held" && q.run.grants.some(g => g.slot === slot));
const waitersFor = (slot: string): QueuedRun[] => runs().filter(q => q.run.phase === "waiting" && q.run.requests.some(r => r.slot === slot));
const launched = (slot: string) => {
  const queued = holderOf(slot);
  return queued?.run.phase === "held" ? queued.run.launch : null;
};

// A command that holds its slot until the test creates `file`.
const holdUntil = (file: string): string[] => ["sh", "-c", `touch ${file}.started; while [ ! -f ${file} ]; do sleep 0.02; done`];

test("an uncapped slot is SLOT_UNAVAILABLE before any store effect", async () => {
  rmSync(hostFile, { force: true });
  const root = project("[slots.uncapped]\n");
  const result = await runCli(root, ["run", "--slot", "uncapped", "--json", "--", "true"]);
  expect(result.exitCode).toBe(2);
  const error = JSON.parse(result.stdout);
  expect(error).toMatchObject({ schemaVersion: 1, code: "SLOT_UNAVAILABLE", slot: "uncapped" });
  expect(error.message).toContain(hostFile);
  expect(existsSync(storePath)).toBe(false);
});

test("a granted run injects slot env, runs on-acquire first, and reports one JSON result", async () => {
  setCaps({ "json-shape": 2 });
  const root = project(`[slots.json-shape]
env = { UNIT = "u\${slot}", BASE = "\${ports.0}", LAST = "\${ports.2}" }
on-acquire = ["echo acquire-saw-$UNIT > acquired"]
ports = 3`);
  const result = await runCli(root, ["run", "--slot", "json-shape", "--json", "--", "sh", "-c", 'echo "cmd $UNIT $BASE $LAST $(cat acquired)"; exit 7']);
  expect(result.exitCode).toBe(7);
  const value = JSON.parse(result.stdout);
  expect(Object.keys(value).sort()).toEqual(["run", "schemaVersion"]);
  expect(Object.keys(value.run).sort()).toEqual(["command", "exitCode", "id", "released", "root", "slots", "waitedMs"]);
  const [grant] = value.run.slots;
  expect(value).toMatchObject({ schemaVersion: 1, run: { exitCode: 7, released: true, command: ["sh", "-c", expect.any(String)], slots: [{ slot: "json-shape", unit: 0 }] } });
  expect(grant.ports).toEqual([grant.ports[0], grant.ports[0] + 1, grant.ports[0] + 2]);
  // The command's stdout goes to stderr so stdout carries exactly one JSON value.
  expect(result.stderr).toContain(`cmd u0 ${grant.ports[0]} ${grant.ports[2]} acquire-saw-u0`);
  const ephemeral = kernelEphemeralRange();
  for (const port of grant.ports) expect(insideRange(port, ephemeral)).toBe(false);
  expect(runs()).toEqual([]);
  expect(existsSync(path.join(base, "docker-called"))).toBe(false);
});

test("with cap 1 the second run waits, then runs once the first exits", async () => {
  setCaps({ contended: 1 });
  const root = project("[slots.contended]\n");
  const first = start(root, ["run", "--slot", "contended", "--", ...holdUntil("release-first")]);
  await waitFor(() => existsSync(path.join(root, "release-first.started")), "first command");
  const second = start(root, ["run", "--slot", "contended", "--", "sh", "-c", "touch second-ran"]);
  await waitFor(() => waitersFor("contended").length === 1, "second run queued");
  expect(existsSync(path.join(root, "second-ran"))).toBe(false);
  writeFileSync(path.join(root, "release-first"), "");
  const [a, b] = await Promise.all([settle(first, "first"), settle(second, "second")]);
  expect([a.exitCode, b.exitCode]).toEqual([0, 0]);
  expect(b.stderr).toContain("waiting for contended (1/1 held; next: #0");
  expect(existsSync(path.join(root, "second-ran"))).toBe(true);
  expect(runs()).toEqual([]);
}, 60_000);

test("waiters are granted first in, first out", async () => {
  setCaps({ fifo: 1 });
  const root = project("[slots.fifo]\n");
  const holder = start(root, ["run", "--slot", "fifo", "--", ...holdUntil("release-holder")]);
  await waitFor(() => existsSync(path.join(root, "release-holder.started")), "holder command");
  const order = path.join(root, "order");
  const waiters: Started[] = [];
  for (const name of ["one", "two", "three"]) {
    waiters.push(start(root, ["run", "--slot", "fifo", "--", "sh", "-c", `echo ${name} >> ${order}`]));
    await waitFor(() => waitersFor("fifo").length === waiters.length, `${name} queued`);
  }
  writeFileSync(path.join(root, "release-holder"), "");
  const results = await Promise.all([settle(holder, "holder"), ...waiters.map((w, i) => settle(w, `waiter ${i}`))]);
  expect(results.map(r => r.exitCode)).toEqual([0, 0, 0, 0]);
  expect(readFileSync(order, "utf8")).toBe("one\ntwo\nthree\n");
}, 60_000);

test("a multi-slot run holds nothing while one of its slots is busy, and opposite orders both complete", async () => {
  setCaps({ "pair-a": 1, "pair-b": 1 });
  const root = project("[slots.pair-a]\n[slots.pair-b]\n");
  const holder = start(root, ["run", "--slot", "pair-b", "--", ...holdUntil("release-b")]);
  await waitFor(() => existsSync(path.join(root, "release-b.started")), "pair-b holder");
  const forward = start(root, ["run", "--slot", "pair-a", "--slot", "pair-b", "--", "sh", "-c", "touch forward-ran"]);
  await waitFor(() => waitersFor("pair-a").length === 1, "forward queued");
  const reverse = start(root, ["run", "--slot", "pair-b", "--slot", "pair-a", "--", "sh", "-c", "touch reverse-ran"]);
  await waitFor(() => waitersFor("pair-a").length === 2, "reverse queued");
  expect(holderOf("pair-a")).toBeUndefined();
  writeFileSync(path.join(root, "release-b"), "");
  const results = await Promise.all([settle(holder, "holder"), settle(forward, "forward"), settle(reverse, "reverse")]);
  expect(results.map(r => r.exitCode)).toEqual([0, 0, 0]);
  expect([existsSync(path.join(root, "forward-ran")), existsSync(path.join(root, "reverse-ran"))]).toEqual([true, true]);
  expect(runs()).toEqual([]);
}, 60_000);

test("SIGKILL of the holder's process group releases its unit to the waiter", async () => {
  setCaps({ "kill-group": 1 });
  const root = project("[slots.kill-group]\n");
  const holder = start(root, ["run", "--slot", "kill-group", "--", "sleep", "60"]);
  await waitFor(() => launched("kill-group") !== null, "holder launch");
  const waiter = start(root, ["run", "--slot", "kill-group", "--", "sh", "-c", "touch waiter-ran"]);
  await waitFor(() => waitersFor("kill-group").length === 1, "waiter queued");
  process.kill(-launched("kill-group")!.groupId, "SIGKILL");
  const [h, w] = await Promise.all([settle(holder, "holder"), settle(waiter, "waiter")]);
  expect(h.exitCode).not.toBe(0);
  expect(w.exitCode).toBe(0);
  expect(existsSync(path.join(root, "waiter-ran"))).toBe(true);
  expect(runs()).toEqual([]);
}, 60_000);

test("SIGKILL of the holding silo run and its group lets the next waiter prove absence and proceed", async () => {
  setCaps({ "kill-run": 1 });
  const root = project("[slots.kill-run]\n");
  const holder = start(root, ["run", "--slot", "kill-run", "--", "sleep", "60"]);
  await waitFor(() => launched("kill-run") !== null, "holder launch");
  const launch = launched("kill-run")!;
  holder.proc.kill("SIGKILL");
  process.kill(-launch.groupId, "SIGKILL");
  await settle(holder, "killed holder");
  // Janitor drains the group when its watched parent dies; wait for that.
  await waitFor(() => { try { process.kill(launch.supervisor.pid, 0); return false; } catch { return true; } }, "supervisor exit");
  expect(holderOf("kill-run")).toBeDefined();
  const next = await runCli(root, ["run", "--slot", "kill-run", "--", "sh", "-c", "touch next-ran"]);
  expect(next.exitCode).toBe(0);
  expect(next.stderr).toContain("released slot units of ended run");
  expect(existsSync(path.join(root, "next-ran"))).toBe(true);
  expect(runs()).toEqual([]);
}, 60_000);

test("a holder whose PID now names an unrelated process is released by the next run", async () => {
  setCaps({ reused: 1 });
  const root = project("[slots.reused]\n");
  const unrelated = Bun.spawn(["sleep", "60"], { stdout: "ignore", stderr: "ignore" });
  try {
    const queue = new SlotQueue(storePath);
    const id = randomUUID();
    queue.enqueue({ phase: "waiting", id, root: "/stale", command: ["gone"], requests: [{ slot: "reused" as never, ports: 0 }], waiter: { pid: unrelated.pid, identity: "501 1 Thu Jan  1 00:00:00 2026 silo run" }, enqueuedAt: "t" });
    expect(queue.attemptGrant(id, new Map([["reused" as never, 1]]), new Map(), "t").kind).toBe("granted");
    const next = await runCli(root, ["run", "--slot", "reused", "--", "true"]);
    expect(next.exitCode).toBe(0);
    expect(unrelated.exitCode).toBe(null);
    expect(runs()).toEqual([]);
  } finally { unrelated.kill("SIGKILL"); await unrelated.exited; }
}, 60_000);

test("a failing on-acquire stops the run before its command and releases the unit", async () => {
  setCaps({ "acquire-fails": 1 });
  const root = project(`[slots.acquire-fails]
on-acquire = ["true", "echo reset failed >&2; exit 9"]`);
  const result = await runCli(root, ["run", "--slot", "acquire-fails", "--json", "--", "sh", "-c", "touch command-ran"]);
  expect(result.exitCode).toBe(9);
  const error = JSON.parse(result.stdout);
  expect(error).toMatchObject({ schemaVersion: 1, code: "SLOT_ACQUIRE_FAILED", failedStep: 1, exitCode: 9 });
  expect(error.message).toContain("reset failed");
  expect(existsSync(path.join(root, "command-ran"))).toBe(false);
  expect(runs()).toEqual([]);
}, 60_000);

test("--wait bounds the wait with SLOT_WAIT_TIMEOUT and leaves the queue", async () => {
  setCaps({ bounded: 1 });
  const root = project("[slots.bounded]\n");
  const holder = start(root, ["run", "--slot", "bounded", "--", ...holdUntil("release-bounded")]);
  await waitFor(() => existsSync(path.join(root, "release-bounded.started")), "holder command");
  const timedOut = await runCli(root, ["run", "--slot", "bounded", "--wait", "300ms", "--json", "--", "true"]);
  expect(timedOut.exitCode).toBe(75);
  expect(JSON.parse(timedOut.stdout)).toMatchObject({ schemaVersion: 1, code: "SLOT_WAIT_TIMEOUT", slot: "bounded", holders: [expect.stringContaining("#0")] });
  expect(waitersFor("bounded")).toEqual([]);
  writeFileSync(path.join(root, "release-bounded"), "");
  expect((await settle(holder, "holder")).exitCode).toBe(0);
}, 60_000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`${signal} while waiting leaves the queue, and during the command stops the group and releases`, async () => {
    const name = `interrupt-${signal.toLowerCase()}`;
    const code = signal === "SIGINT" ? 130 : 143;
    setCaps({ [name]: 1 });
    const root = project(`[slots.${name}]\n`);
    const holder = start(root, ["run", "--slot", name, "--json", "--", "sleep", "60"]);
    await waitFor(() => launched(name) !== null, "holder launch");
    const group = launched(name)!.groupId;
    const waiter = start(root, ["run", "--slot", name, "--json", "--", "true"]);
    await waitFor(() => waitersFor(name).length === 1, "waiter queued");
    waiter.proc.kill(signal);
    const w = await settle(waiter, "interrupted waiter");
    expect(w.exitCode).toBe(code);
    expect(JSON.parse(w.stdout)).toMatchObject({ schemaVersion: 1, code: "INTERRUPTED", signal });
    expect(waitersFor(name)).toEqual([]);
    holder.proc.kill(signal);
    const h = await settle(holder, "interrupted holder");
    expect(h.exitCode).toBe(code);
    expect(JSON.parse(h.stdout).message).toContain("units released");
    expect(() => process.kill(-group, 0)).toThrow();
    expect(runs()).toEqual([]);
  }, 60_000);
}

test("status names holders and waiters without changing the queue", async () => {
  setCaps({ observed: 1 });
  const root = project("[slots.observed]\n");
  const holder = start(root, ["run", "--slot", "observed", "--", ...holdUntil("release-observed")]);
  await waitFor(() => existsSync(path.join(root, "release-observed.started")), "holder command");
  const waiter = start(root, ["run", "--slot", "observed", "--", "true"]);
  await waitFor(() => waitersFor("observed").length === 1, "waiter queued");
  const before = runs();
  const status = await runCli(root, ["status", "--json"]);
  expect(status.exitCode).toBe(0);
  const observed = JSON.parse(status.stdout).slots.list.find((s: { slot: string }) => s.slot === "observed");
  expect(observed).toMatchObject({ slot: "observed", cap: 1, held: 1, waiting: 1, holders: [{ unit: 0, root, state: "held", command: holdUntil("release-observed"), pid: holder.proc.pid }] });
  const text = await runCli(root, ["status"]);
  expect(text.stdout).toMatch(/observed\s+1\s+1\s+#0 \S+\s+pid \d+/);
  expect(runs()).toEqual(before);
  writeFileSync(path.join(root, "release-observed"), "");
  expect((await Promise.all([settle(holder, "holder"), settle(waiter, "waiter")])).map(r => r.exitCode)).toEqual([0, 0]);
}, 60_000);

test("lowering a cap applies to runs already queued", async () => {
  setCaps({ lowered: 2 });
  const root = project("[slots.lowered]\n");
  const first = start(root, ["run", "--slot", "lowered", "--", ...holdUntil("release-first")]);
  const second = start(root, ["run", "--slot", "lowered", "--", ...holdUntil("release-second")]);
  await waitFor(() => existsSync(path.join(root, "release-first.started")) && existsSync(path.join(root, "release-second.started")), "two holders");
  const third = start(root, ["run", "--slot", "lowered", "--", "sh", "-c", "touch third-ran"]);
  await waitFor(() => waitersFor("lowered").length === 1, "third queued");
  setCaps({ lowered: 1 });
  writeFileSync(path.join(root, "release-second"), "");
  expect((await settle(second, "second")).exitCode).toBe(0);
  // One unit is still held and the cap is now 1: the queued run re-reads the
  // cap, reports it, and keeps waiting.
  await waitFor(() => third.stderrSoFar().includes("waiting for lowered (1/1 held"), "third sees the lowered cap");
  expect(existsSync(path.join(root, "third-ran"))).toBe(false);
  expect(waitersFor("lowered").length).toBe(1);
  writeFileSync(path.join(root, "release-first"), "");
  const results = await Promise.all([settle(first, "first"), settle(third, "third")]);
  expect(results.map(r => r.exitCode)).toEqual([0, 0]);
  expect(existsSync(path.join(root, "third-ran"))).toBe(true);
}, 60_000);

test("units stay held while the group outlives its supervisor, and a later run releases them once it is gone", async () => {
  setCaps({ outlives: 1 });
  const root = project("[slots.outlives]\n");
  const holder = start(root, ["run", "--slot", "outlives", "--json", "--", "sh", "-c", "trap '' TERM; touch started; while :; do sleep 0.05; done"]);
  await waitFor(() => existsSync(path.join(root, "started")), "holder command");
  const launch = launched("outlives")!;
  const groupAlive = () => { try { process.kill(-launch.groupId, 0); return true; } catch { return false; } };
  try {
    // Without its supervisor nothing drains the group; the run must not release.
    process.kill(launch.supervisor.pid, "SIGKILL");
    const result = await settle(holder, "holder");
    expect(groupAlive()).toBe(true);
    expect(JSON.parse(result.stdout).run.released).toBe(false);
    expect(holderOf("outlives")).toBeDefined();
  } finally {
    // This group has no supervisor; nothing else would ever stop it.
    if (groupAlive()) process.kill(-launch.groupId, "SIGKILL");
  }
  await waitFor(() => !groupAlive(), "group exit");
  const next = await runCli(root, ["run", "--slot", "outlives", "--", "true"]);
  expect(next.exitCode).toBe(0);
  expect(next.stderr).toContain("released slot units of ended run");
  expect(runs()).toEqual([]);
}, 60_000);

test("a run releases provably dead rows of slots it does not request, including their port blocks", async () => {
  setCaps({ orphaned: 1, sweeper: 1 });
  const root = project("[slots.sweeper]\n");
  const ended = Bun.spawn(["true"]);
  await ended.exited;
  const queue = new SlotQueue(storePath);
  const id = randomUUID();
  queue.enqueue({ phase: "waiting", id, root: "/crashed", command: ["gone"], requests: [{ slot: "orphaned" as never, ports: 2 }], waiter: { pid: ended.pid, identity: "gone" }, enqueuedAt: "t" });
  expect(queue.attemptGrant(id, new Map([["orphaned" as never, 1]]), new Map([["orphaned" as never, [40200, 40201]]]), "t").kind).toBe("granted");
  const result = await runCli(root, ["run", "--slot", "sweeper", "--", "true"]);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain(`released slot units of ended run ${id}`);
  expect(runs()).toEqual([]);
}, 60_000);

test("legacy state refuses a run only when a requested slot claims ports", async () => {
  setCaps({ "no-ports": 1, "with-ports": 1 });
  const root = project("[slots.no-ports]\n[slots.with-ports]\nports = 1\n");
  const registry = path.join(account, ".silo/instances");
  mkdirSync(registry, { recursive: true });
  writeFileSync(path.join(registry, "legacy.json"), "{}");
  try {
    expect((await runCli(root, ["run", "--slot", "no-ports", "--", "true"])).exitCode).toBe(0);
    const refused = await runCli(root, ["run", "--slot", "with-ports", "--json", "--", "true"]);
    expect(refused.exitCode).toBe(1);
    expect(JSON.parse(refused.stdout).code).toBe("LEGACY_STATE");
  } finally { rmSync(path.join(registry, "legacy.json")); }
}, 60_000);

test("an invalid host file is reported in status's slots section without failing status", async () => {
  writeFileSync(hostFile, "[slots]\nbad = 0\n");
  try {
    const root = project("");
    const status = await runCli(root, ["status", "--json"]);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout).slots).toMatchObject({ list: [], problem: { code: "INVALID_HOST_CONFIG" } });
  } finally { setCaps({}); }
}, 60_000);
