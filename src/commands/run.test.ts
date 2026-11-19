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
let caller: string;
let fakeJanitorBin: string;

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
  // Stands in for a terminal or task runner: it leads its own process group,
  // survives a signal to that group, and exits with its child's status.
  caller = path.join(base, "caller.ts");
  writeFileSync(caller, `for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {});
const [pidFile, ...argv] = process.argv.slice(2);
const child = Bun.spawn(argv, { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
await Bun.write(pidFile, String(child.pid));
process.exit(await child.exited);
`);
  // A supervisor that exits 0 on SIGTERM without draining its group: the one
  // way a Janitor that ends on its own can leave members behind.
  fakeJanitorBin = path.join(base, "fake-janitor");
  mkdirSync(fakeJanitorBin);
  const fake = path.join(fakeJanitorBin, "fake-janitor.ts");
  writeFileSync(fake, `const argv = process.argv.slice(2);
const child = Bun.spawn(argv.slice(argv.indexOf("--") + 1), { detached: true, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
process.on("SIGTERM", () => process.exit(0));
process.exit(await child.exited);
`);
  writeFileSync(path.join(fakeJanitorBin, "janitor"), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fake)} "$@"\n`, { mode: 0o755 });
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
// they recorded or the test tracked, so a failing test leaks no process.
const startedPids = new Set<number>();
const started: Started[] = [];
const trackedGroups = new Set<number>();

afterEach(async () => {
  const leftover = started.splice(0).filter(s => s.proc.exitCode === null && s.proc.signalCode === null);
  const groups = existsSync(storePath) ? runs().flatMap(q => q.run.phase === "held" && q.run.launch && startedPids.has(q.run.waiter.pid) ? [q.run.launch.groupId] : []) : [];
  for (const s of leftover) s.proc.kill("SIGKILL");
  for (const group of [...groups, ...trackedGroups]) { try { process.kill(-group, "SIGKILL"); } catch { /* already gone */ } }
  await Promise.all(leftover.map(s => s.proc.exited));
  startedPids.clear();
  trackedGroups.clear();
});

const start = (root: string, args: string[], pathPrefix = bin): Started => startArgv(root, [process.execPath, cli, ...args], false, pathPrefix);

/** `detached` starts the process as the leader of a new process group. */
const startArgv = (root: string, argv: string[], detached: boolean, pathPrefix = bin): Started => {
  const proc = Bun.spawn(argv, {
    cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 60_000, detached,
    env: { ...process.env, HOME: account, SILO_PORT_REGISTRY_DIR: path.join(account, "registry"), PATH: `${pathPrefix === bin ? bin : `${pathPrefix}:${bin}`}:${process.env.PATH}` },
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

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** The process group a command recorded in `file`, tracked for cleanup. */
const recordedGroup = async (root: string, file: string): Promise<number> => {
  const target = path.join(root, file);
  await waitFor(() => existsSync(target) && readFileSync(target, "utf8").trim().length > 0, `${file} written`);
  const group = Number(readFileSync(target, "utf8").trim());
  trackedGroups.add(group);
  return group;
};
const recordGroup = (file: string): string => `ps -o pgid= -p $$ > ${file}`;

/** A directory with no silo.toml. */
const bareDirectory = (): string => {
  const root = path.join(base, `bare-${randomUUID().slice(0, 8)}`);
  mkdirSync(root);
  return root;
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
  expect(error.message).toContain(`under [slots.uncapped] in ${path.join(root, "silo.toml")}`);
  expect(existsSync(storePath)).toBe(false);
});

test("a run without slots needs no silo.toml, host caps or store, and keeps its exit code before the deadline", async () => {
  // Runs before any slot test creates the store.
  expect(existsSync(storePath)).toBe(false);
  rmSync(hostFile, { force: true });
  const root = bareDirectory();
  const result = await runCli(root, ["run", "--timeout", "60s", "--json", "--", "sh", "-c", "echo plain; exit 7"]);
  expect(result.exitCode).toBe(7);
  expect(JSON.parse(result.stdout)).toMatchObject({ schemaVersion: 1, run: { root, slots: [], exitCode: 7, timedOut: false, released: true } });
  expect(result.stderr).toContain("plain");
  expect(existsSync(storePath)).toBe(false);
  expect(existsSync(path.join(base, "docker-called"))).toBe(false);
});

test("a run without slots ignores a malformed silo.toml it never reads", async () => {
  const root = bareDirectory();
  writeFileSync(path.join(root, "silo.toml"), "this is = = not toml [\n");
  const result = await runCli(root, ["run", "--json", "--", "sh", "-c", "exit 4"]);
  expect(result.exitCode).toBe(4);
  expect(JSON.parse(result.stdout)).toMatchObject({ run: { exitCode: 4, timedOut: false } });
});

test("--timeout, --kill-after and --wait refuse values outside their bounds before running", async () => {
  const root = bareDirectory();
  for (const args of [["--timeout", "500ms"], ["--timeout", "169h"], ["--timeout", "soon"], ["--kill-after", "11m"], ["--kill-after", "0"], ["--wait", "1s"]]) {
    const result = await runCli(root, ["run", ...args, "--json", "--", "sh", "-c", "touch ran"]);
    expect([args, result.exitCode]).toEqual([args, 1]);
    expect(JSON.parse(result.stdout)).toMatchObject({ code: "INVALID_ARGUMENT", message: expect.stringContaining(args[0]!) });
  }
  expect(existsSync(path.join(root, "ran"))).toBe(false);
});

test("--timeout ends the command's children and grandchildren and exits 124", async () => {
  const root = bareDirectory();
  const tree = `${recordGroup("group")}; sh -c 'sleep 600 & echo $! > grandchild; wait' & echo $! > child; sleep 600 & echo $! > sibling; wait`;
  const running = start(root, ["run", "--timeout", "1s", "--json", "--", "sh", "-c", tree]);
  const group = await recordedGroup(root, "group");
  await waitFor(() => ["child", "grandchild", "sibling"].every(file => existsSync(path.join(root, file))), "tree started");
  const pids = ["child", "grandchild", "sibling"].map(file => Number(readFileSync(path.join(root, file), "utf8")));
  expect(pids.every(alive)).toBe(true);
  const result = await settle(running, "timed-out run");
  expect(result.exitCode).toBe(124);
  expect(JSON.parse(result.stdout)).toMatchObject({ schemaVersion: 1, run: { exitCode: 124, timedOut: true } });
  expect(result.stderr).toContain("--timeout 1s reached");
  expect(pids.filter(alive)).toEqual([]);
  expect(alive(-group)).toBe(false);
}, 60_000);

test("a command that ignores SIGTERM at the deadline is SIGKILLed after the --kill-after grace", async () => {
  const root = bareDirectory();
  const stubborn = `${recordGroup("group")}; trap 'echo term >> got-term' TERM; while :; do sleep 0.05; done`;
  const startedAt = Date.now();
  const running = start(root, ["run", "--timeout", "1s", "--kill-after", "1s", "--", "sh", "-c", stubborn]);
  const group = await recordedGroup(root, "group");
  const result = await settle(running, "stubborn run");
  const elapsed = Date.now() - startedAt;
  expect(result.exitCode).toBe(124);
  expect(existsSync(path.join(root, "got-term"))).toBe(true);
  // The deadline plus the grace, well short of the default 5 s grace.
  expect(elapsed).toBeGreaterThanOrEqual(2000);
  expect(elapsed).toBeLessThan(4500);
  expect(alive(-group)).toBe(false);
}, 60_000);

test("--timeout also ends a descendant that left the group with setsid", async () => {
  const root = bareDirectory();
  const escaping = `${recordGroup("group")}; perl -e 'use POSIX; POSIX::setsid(); exec "sleep", "600"' & echo $! > escaped; wait`;
  const running = start(root, ["run", "--timeout", "1s", "--", "sh", "-c", escaping]);
  const group = await recordedGroup(root, "group");
  const escaped = await recordedGroup(root, "escaped");
  // It leads its own session and group, outside the command's group.
  await waitFor(() => Bun.spawnSync(["ps", "-o", "pgid=", "-p", String(escaped)]).stdout.toString().trim() === String(escaped), "setsid");
  expect((await settle(running, "run with an escaped descendant")).exitCode).toBe(124);
  expect([alive(escaped), alive(-group)]).toEqual([false, false]);
}, 60_000);

test("a command whose own process exits before the deadline is not timed out while a straggler drains", async () => {
  const root = bareDirectory();
  const straggler = `${recordGroup("group")}; sh -c 'trap "" TERM; exec sleep 600' & exit 0`;
  const result = await runCli(root, ["run", "--timeout", "1s", "--kill-after", "3s", "--json", "--", "sh", "-c", straggler]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ run: { exitCode: 0, timedOut: false } });
  expect(result.stderr).not.toContain("reached");
}, 60_000);

test("SIGINT after the deadline fired keeps the timeout's 124", async () => {
  const root = bareDirectory();
  const stubborn = `${recordGroup("group")}; trap 'echo term >> got-term' TERM; while :; do sleep 0.05; done`;
  const running = start(root, ["run", "--timeout", "1s", "--kill-after", "3s", "--json", "--", "sh", "-c", stubborn]);
  const group = await recordedGroup(root, "group");
  await waitFor(() => existsSync(path.join(root, "got-term")), "deadline stop began");
  running.proc.kill("SIGINT");
  const result = await settle(running, "interrupted after the deadline");
  expect(result.exitCode).toBe(124);
  expect(JSON.parse(result.stdout)).toMatchObject({ run: { exitCode: 124, timedOut: true } });
  expect(alive(-group)).toBe(false);
}, 60_000);

test("--kill-after sets the grace of an interrupt's stop", async () => {
  const root = bareDirectory();
  const stubborn = `${recordGroup("group")}; trap 'echo term >> got-term' TERM; touch started; while :; do sleep 0.05; done`;
  const running = start(root, ["run", "--kill-after", "1s", "--", "sh", "-c", stubborn]);
  const group = await recordedGroup(root, "group");
  await waitFor(() => existsSync(path.join(root, "started")), "command started");
  const interruptedAt = Date.now();
  running.proc.kill("SIGINT");
  expect((await settle(running, "interrupted stubborn run")).exitCode).toBe(130);
  const elapsed = Date.now() - interruptedAt;
  expect(existsSync(path.join(root, "got-term"))).toBe(true);
  // One second of grace, well short of the default five.
  expect(elapsed).toBeGreaterThanOrEqual(1000);
  expect(elapsed).toBeLessThan(4000);
  expect(alive(-group)).toBe(false);
}, 60_000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`${signal} to the caller's process group reaches silo, which stops the command before its deadline`, async () => {
    const root = bareDirectory();
    const pidFile = path.join(root, "silo-pid");
    const running = startArgv(root, [process.execPath, caller, pidFile, process.execPath, cli, "run", "--timeout", "60s", "--json", "--", "sh", "-c", `${recordGroup("group")}; sleep 600 & wait`], true);
    trackedGroups.add(running.proc.pid);
    const group = await recordedGroup(root, "group");
    const siloPid = Number(readFileSync(pidFile, "utf8"));
    // silo stays in its caller's group; only the command has its own.
    const siloGroup = Number((await Bun.$`ps -o pgid= -p ${siloPid}`.text()).trim());
    expect(siloGroup).toBe(running.proc.pid);
    expect(group).not.toBe(siloGroup);
    process.kill(-running.proc.pid, signal);
    const result = await settle(running, "interrupted caller");
    expect(result.exitCode).toBe(signal === "SIGINT" ? 130 : 143);
    expect(JSON.parse(result.stdout)).toMatchObject({ schemaVersion: 1, code: "INTERRUPTED", signal });
    expect(alive(-group)).toBe(false);
  }, 60_000);
}

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
  expect(Object.keys(value.run).sort()).toEqual(["command", "exitCode", "id", "released", "root", "slots", "timedOut", "waitedMs"]);
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
  // Queued is not yet waiting: the run reports its wait once a grant attempt has failed.
  await waitFor(() => second.stderrSoFar().includes("waiting for contended (1/1 held; next: #0"), "second run waiting");
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

test("a run stopped by --timeout releases its unit to the next waiter", async () => {
  setCaps({ "timed-out": 1 });
  const root = project("[slots.timed-out]\n");
  const holder = start(root, ["run", "--slot", "timed-out", "--timeout", "2s", "--json", "--", "sleep", "600"]);
  await waitFor(() => launched("timed-out") !== null, "holder launch");
  const waiter = start(root, ["run", "--slot", "timed-out", "--", "sh", "-c", "touch waiter-ran"]);
  await waitFor(() => waitersFor("timed-out").length === 1, "waiter queued");
  const [h, w] = await Promise.all([settle(holder, "holder"), settle(waiter, "waiter")]);
  expect(h.exitCode).toBe(124);
  expect(JSON.parse(h.stdout)).toMatchObject({ run: { exitCode: 124, timedOut: true, released: true } });
  expect(w.exitCode).toBe(0);
  expect(existsSync(path.join(root, "waiter-ran"))).toBe(true);
  expect(runs()).toEqual([]);
}, 60_000);

test("a deadline during on-acquire stops the step, never starts the command, and releases", async () => {
  setCaps({ "acquire-deadline": 1 });
  const root = project(`[slots.acquire-deadline]
on-acquire = ["touch acquiring; sleep 600"]`);
  const result = await runCli(root, ["run", "--slot", "acquire-deadline", "--timeout", "1s", "--json", "--", "sh", "-c", "touch command-ran"]);
  expect(result.exitCode).toBe(124);
  expect(JSON.parse(result.stdout)).toMatchObject({ run: { exitCode: 124, timedOut: true, released: true } });
  expect([existsSync(path.join(root, "acquiring")), existsSync(path.join(root, "command-ran"))]).toEqual([true, false]);
  expect(runs()).toEqual([]);
}, 60_000);

test("an on-acquire failure before the deadline stays SLOT_ACQUIRE_FAILED while a straggler drains", async () => {
  setCaps({ "acquire-straggler": 1 });
  const root = project(`[slots.acquire-straggler]
on-acquire = ["sh -c 'trap \\"\\" TERM; exec sleep 600' & exit 9"]`);
  const result = await runCli(root, ["run", "--slot", "acquire-straggler", "--timeout", "1s", "--kill-after", "3s", "--json", "--", "true"]);
  expect(result.exitCode).toBe(9);
  expect(JSON.parse(result.stdout)).toMatchObject({ code: "SLOT_ACQUIRE_FAILED", exitCode: 9 });
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

test("with no host file the project's default cap applies, and status names the project as its source", async () => {
  rmSync(hostFile, { force: true });
  const root = project("[slots.defaulted]\ncap = 1\n");
  const holder = start(root, ["run", "--slot", "defaulted", "--", ...holdUntil("release-defaulted")]);
  await waitFor(() => existsSync(path.join(root, "release-defaulted.started")), "holder command");
  const waiter = start(root, ["run", "--slot", "defaulted", "--", "true"]);
  await waitFor(() => waiter.stderrSoFar().includes("waiting for defaulted (1/1 held"), "waiter bounded by the project default");
  const status = await runCli(root, ["status", "--json"]);
  const listed = JSON.parse(status.stdout).slots.list.find((s: { slot: string }) => s.slot === "defaulted");
  expect(listed).toMatchObject({ cap: 1, capSource: "project", hostFile: null, projectCaps: [{ root, cap: 1 }], held: 1, waiting: 1 });
  expect((await runCli(root, ["status"])).stdout).toMatch(/defaulted\s+1\s+project\s+1\s+#0/);
  writeFileSync(path.join(root, "release-defaulted"), "");
  expect((await Promise.all([settle(holder, "holder"), settle(waiter, "waiter")])).map(r => r.exitCode)).toEqual([0, 0]);
}, 60_000);

test("a host entry overrides the project default either way, and 0 turns the slot off", async () => {
  const root = project("[slots.overridden]\ncap = 1\n");
  setCaps({ overridden: 0 });
  const refused = await runCli(root, ["run", "--slot", "overridden", "--json", "--", "true"]);
  expect(refused.exitCode).toBe(2);
  expect(JSON.parse(refused.stdout)).toMatchObject({ code: "SLOT_UNAVAILABLE", message: `SLOT_UNAVAILABLE: slot 'overridden' is turned off on this host (overridden = 0 in ${hostFile})` });
  setCaps({ overridden: 2 });
  const status = JSON.parse((await runCli(root, ["status", "--json"])).stdout).slots.list.find((s: { slot: string }) => s.slot === "overridden");
  expect(status).toMatchObject({ cap: 2, capSource: "host", hostFile, projectCaps: [{ root, cap: 1 }] });
  const first = start(root, ["run", "--slot", "overridden", "--", ...holdUntil("release-1")]);
  const second = start(root, ["run", "--slot", "overridden", "--", ...holdUntil("release-2")]);
  await waitFor(() => existsSync(path.join(root, "release-1.started")) && existsSync(path.join(root, "release-2.started")), "two holders above the project default");
  writeFileSync(path.join(root, "release-1"), "");
  writeFileSync(path.join(root, "release-2"), "");
  expect((await Promise.all([settle(first, "first"), settle(second, "second")])).map(r => r.exitCode)).toEqual([0, 0]);
  setCaps({});
}, 60_000);

test("a per-OS default that omits this OS leaves the slot uncapped here", async () => {
  rmSync(hostFile, { force: true });
  const other = process.platform === "darwin" ? "linux" : "macos";
  const root = project(`[slots.elsewhere]\ncap = { ${other} = 1 }\n`);
  const result = await runCli(root, ["run", "--slot", "elsewhere", "--json", "--", "true"]);
  expect(result.exitCode).toBe(2);
  expect(JSON.parse(result.stdout).message).toContain(`slot 'elsewhere' has no cap on this host (${process.platform === "darwin" ? "macos" : "linux"})`);
});

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
  expect(observed).toMatchObject({ slot: "observed", cap: 1, capSource: "host", hostFile, held: 1, waiting: 1, holders: [{ unit: 0, root, state: "held", command: holdUntil("release-observed"), pid: holder.proc.pid }] });
  const text = await runCli(root, ["status"]);
  expect(text.stdout).toMatch(/observed\s+1\s+host\s+1\s+#0 \S+\s+pid \d+/);
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

type Holder = { root: string; started: Started; group: number; supervisor: number; leader: number };

/** A slot run whose command records its group and starts `script`; its Janitor is tracked for cleanup. */
const holdWith = async (name: string, script: string, extra: string[] = []): Promise<Holder> => {
  setCaps({ [name]: 1 });
  const root = project(`[slots.${name}]\n`);
  const started = start(root, ["run", "--slot", name, ...extra, "--json", "--", "sh", "-c", `${recordGroup("group")}; ${script}`]);
  const group = await recordedGroup(root, "group");
  await waitFor(() => launched(name) !== null, "holder launch");
  const launch = launched(name)!;
  // Janitor leads its own session; tracking it lets cleanup reach a stopped one.
  trackedGroups.add(launch.supervisor.pid);
  return { root, started, group, supervisor: launch.supervisor.pid, leader: launch.leaderPid };
};

const incomplete = (result: Finished) => {
  expect(result.exitCode).toBe(1);
  return JSON.parse(result.stdout) as { code: string; reason: string; cause: string; message: string };
};

test("Janitor SIGKILLed mid-run: silo stops the group itself, reports RUN_STOP_INCOMPLETE, and keeps the units until a later run", async () => {
  const name = "janitor-killed";
  const escaping = "perl -e 'use POSIX; POSIX::setsid(); exec \"sleep\", \"600\"' & echo $! > escaped; trap '' TERM; while :; do sleep 0.05; done";
  const holder = await holdWith(name, escaping, ["--timeout", "60s", "--kill-after", "1s"]);
  const escaped = await recordedGroup(holder.root, "escaped");
  await waitFor(() => Bun.spawnSync(["ps", "-o", "pgid=", "-p", String(escaped)]).stdout.toString().trim() === String(escaped), "setsid");
  process.kill(holder.supervisor, "SIGKILL");
  const error = incomplete(await settle(holder.started, "holder without its supervisor"));
  expect(error).toMatchObject({ code: "RUN_STOP_INCOMPLETE", cause: "exited", reason: "supervisor-lost" });
  expect(error.message).toContain("units stay held");
  // The group ignored SIGTERM and was SIGKILLed directly; the setsid descendant is the documented gap.
  expect(alive(-holder.group)).toBe(false);
  expect(alive(escaped)).toBe(true);
  expect(holderOf(name)).toBeDefined();
  const next = await runCli(holder.root, ["run", "--slot", name, "--", "true"]);
  expect(next.exitCode).toBe(0);
  expect(next.stderr).toContain("released slot units of ended run");
}, 60_000);

test("a stalled Janitor after the command exited: the deadline's wait is bounded and reports RUN_STOP_INCOMPLETE", async () => {
  const startedAt = Date.now();
  const holder = await holdWith("janitor-stalled-exit", "sleep 1", ["--timeout", "3s", "--kill-after", "1s"]);
  process.kill(holder.supervisor, "SIGSTOP");
  const error = incomplete(await settle(holder.started, "holder with a stalled supervisor"));
  expect(error).toMatchObject({ code: "RUN_STOP_INCOMPLETE", cause: "exited", reason: "supervisor-lost" });
  // Deadline, one drain window (1 s grace + 5 s), then the kill: no unbounded wait.
  expect(Date.now() - startedAt).toBeLessThan(20_000);
  expect(alive(holder.supervisor)).toBe(false);
}, 60_000);

test("SIGINT with a stalled Janitor stops the group directly and reports RUN_STOP_INCOMPLETE, never a clean stop", async () => {
  const holder = await holdWith("janitor-stalled-interrupt", "sleep 600 & wait", ["--kill-after", "1s"]);
  process.kill(holder.supervisor, "SIGSTOP");
  holder.started.proc.kill("SIGINT");
  const error = incomplete(await settle(holder.started, "interrupted holder with a stalled supervisor"));
  expect(error).toMatchObject({ code: "RUN_STOP_INCOMPLETE", cause: "interrupted", reason: "supervisor-lost" });
  expect(holder.started.stderrSoFar()).toContain(`sending SIGTERM to process group ${holder.group} directly`);
  expect(alive(-holder.group)).toBe(false);
}, 60_000);

/** The Janitor a slot-less silo run started: its child running `janitor`. */
const janitorOf = (silo: number): number => {
  const rows = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid=,command="]).stdout.toString().split("\n");
  const row = rows.map(line => line.trim().split(/\s+/)).find(([, ppid, command]) => Number(ppid) === silo && command?.endsWith("janitor"));
  if (!row) throw new Error(`no janitor child of ${silo}`);
  return Number(row[0]);
};

test("without --timeout, a stalled Janitor after a slot run's command exited still ends the run, bounded", async () => {
  const startedAt = Date.now();
  const holder = await holdWith("janitor-stalled-no-deadline", "sleep 1", ["--kill-after", "1s"]);
  process.kill(holder.supervisor, "SIGSTOP");
  const error = incomplete(await settle(holder.started, "holder with a stalled supervisor and no deadline"));
  expect(error).toMatchObject({ code: "RUN_STOP_INCOMPLETE", cause: "exited", reason: "supervisor-lost" });
  expect(Date.now() - startedAt).toBeLessThan(20_000);
  expect(alive(holder.supervisor)).toBe(false);
}, 60_000);

test("without --timeout or slots, a stalled Janitor after the command exited still ends the run, bounded", async () => {
  const root = bareDirectory();
  const startedAt = Date.now();
  const running = start(root, ["run", "--kill-after", "1s", "--json", "--", "sh", "-c", `${recordGroup("group")}; sleep 1`]);
  await recordedGroup(root, "group");
  const supervisor = janitorOf(running.proc.pid);
  trackedGroups.add(supervisor);
  process.kill(supervisor, "SIGSTOP");
  const error = incomplete(await settle(running, "slot-less run with a stalled supervisor"));
  expect(error).toMatchObject({ code: "RUN_STOP_INCOMPLETE", cause: "exited", reason: "supervisor-lost" });
  // The unreaped executor is found by its changed identity within one identity poll.
  expect(Date.now() - startedAt).toBeLessThan(25_000);
  expect(alive(supervisor)).toBe(false);
}, 60_000);

test("repeated SIGINT to the caller's group cannot fake the executor's exit while Janitor is stalled", async () => {
  const name = "interrupt-storm";
  setCaps({ [name]: 1 });
  const root = project(`[slots.${name}]\n`);
  const pidFile = path.join(root, "silo-pid");
  const running = startArgv(root, [process.execPath, caller, pidFile, process.execPath, cli, "run", "--slot", name, "--kill-after", "1s", "--json", "--", "sh", "-c", `${recordGroup("group")}; sleep 300 & wait`], true);
  trackedGroups.add(running.proc.pid);
  const group = await recordedGroup(root, "group");
  await waitFor(() => launched(name) !== null, "holder launch");
  const supervisor = launched(name)!.supervisor.pid;
  trackedGroups.add(supervisor);
  process.kill(supervisor, "SIGSTOP");
  // The caller ignores SIGINT; silo's own probes must not die with each one.
  const storm = setInterval(() => { try { process.kill(-running.proc.pid, "SIGINT"); } catch { /* caller gone */ } }, 2);
  try {
    const error = incomplete(await settle(running, "caller under an interrupt storm"));
    expect(error).toMatchObject({ code: "RUN_STOP_INCOMPLETE", cause: "interrupted", reason: "supervisor-lost" });
  } finally { clearInterval(storm); }
  expect(alive(-group)).toBe(false);
}, 60_000);

test("a supervisor that exits on its own while group members remain is not proof of a stop", async () => {
  const root = bareDirectory();
  const running = start(root, ["run", "--json", "--", "sh", "-c", `${recordGroup("group")}; sleep 300 & wait`], fakeJanitorBin);
  const group = await recordedGroup(root, "group");
  running.proc.kill("SIGINT");
  const error = incomplete(await settle(running, "run under a supervisor that does not drain"));
  expect(error).toMatchObject({ code: "RUN_STOP_INCOMPLETE", cause: "interrupted", reason: "group-outlived-supervisor" });
  expect(alive(-group)).toBe(true);
}, 60_000);

test("with Janitor and the executor both gone, silo sends the group no signal and reports RUN_STOP_INCOMPLETE", async () => {
  const holder = await holdWith("leader-gone", "sleep 600 & wait", ["--timeout", "60s"]);
  // Stopped, Janitor cannot reap or drain; the executor then dies and the group keeps its members.
  process.kill(holder.supervisor, "SIGSTOP");
  process.kill(holder.leader, "SIGKILL");
  process.kill(holder.supervisor, "SIGKILL");
  const error = incomplete(await settle(holder.started, "holder without supervisor or executor"));
  expect(error).toMatchObject({ code: "RUN_STOP_INCOMPLETE", cause: "exited", reason: "leader-exited" });
  // The group's leader is gone, so its ID proves nothing: silo must not have signalled it.
  expect(alive(-holder.group)).toBe(true);
  expect(holder.started.stderrSoFar()).not.toContain("directly");
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

test("an unparseable silo.toml is reported in status's slots section without failing status", async () => {
  const root = project("[slots.broken\n");
  const status = await runCli(root, ["status", "--json"]);
  expect(status.exitCode).toBe(0);
  expect(JSON.parse(status.stdout).slots).toMatchObject({ list: [], problem: { code: "INVALID_CONFIG" } });
}, 60_000);

test("an invalid host file is reported in status's slots section without failing status", async () => {
  writeFileSync(hostFile, "[slots]\nbad = 65\n");
  try {
    const root = project("");
    const status = await runCli(root, ["status", "--json"]);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout).slots).toMatchObject({ list: [], problem: { code: "INVALID_HOST_CONFIG" } });
  } finally { setCaps({}); }
}, 60_000);
