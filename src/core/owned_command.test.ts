import { afterAll, beforeAll, expect, test } from "bun:test";
import { closeSync, constants, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { Launch } from "./lease_types";
import { withTimeout } from "../utils/timeout";

let base: string;
const fixture = path.join(import.meta.dir, "fixtures", "owned_cli.ts");

beforeAll(async () => {
  base = mkdtempSync(path.join(os.tmpdir(), "silo-entrypoints-"));
  const preflight = Bun.spawnSync(["janitor", "version"], { cwd: base, stdout: "pipe", stderr: "pipe", timeout: 2000 });
  if (preflight.exitCode !== 0) throw new Error(`Native launch tests require Janitor on PATH: ${preflight.stderr}`);
  for (const [name, flags] of [["bundled.js", ["--target=bun"]], ["standalone", ["--compile"]]] as const) {
    const build = Bun.spawn(["nice", "-n", "15", process.execPath, "build", fixture, ...flags, "--outfile", path.join(base, name)], {
      stdout: "pipe", stderr: "pipe", timeout: 60_000,
    });
    const [exitCode, stdout, stderr] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (exitCode !== 0) throw new Error(`Fixture build failed: ${stdout}\n${stderr}`);
  }
}, 90_000);

afterAll(() => { if (base) rmSync(base, { recursive: true }); });

const entrypoint = (distribution: "source" | "bundled.js" | "standalone"): string[] => {
  if (distribution === "source") return [process.execPath, fixture];
  if (distribution === "standalone") return [path.join(base, distribution)];
  return [process.execPath, path.join(base, distribution)];
};

const bundledExecutor = (root: string, timeout: number) => {
  mkdirSync(root);
  const id = randomUUID();
  const proc = Bun.spawn([...entrypoint("bundled.js"), "__silo_execute", id, root, randomUUID(), "1", "parent"], {
    cwd: root, detached: true, stdin: "pipe", stdout: "pipe", stderr: "pipe", timeout,
  });
  writeFileSync(path.join(root, "executor.pid"), String(proc.pid));
  return { id, proc, reader: proc.stdout.getReader(), stderr: new Response(proc.stderr).text() };
};

for (const distribution of ["source", "bundled.js", "standalone"] as const) {
  test(`${distribution} executes an owned command through the CLI gate after its durable grant`, async () => {
    const root = path.join(base, distribution + "-project");
    const proc = Bun.spawn([...entrypoint(distribution), "--exercise-owned-command", root], { stdout: "pipe", stderr: "pipe", timeout: 20_000 });
    const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(JSON.parse(stdout)).toEqual({ exitCode: 143, stdout: "tool-output" });
    expect(existsSync(path.join(root, "launched.txt"))).toBe(true);
    expect(readFileSync(path.join(root, "launched.txt"), "utf8")).toBe("granted");
    const inspection = JSON.parse(readFileSync(path.join(root, "inspection.json"), "utf8"));
    expect(inspection.launches).toMatchObject([{ phase: "exited", started: true, exitCode: 143, reconciled: true }]);
    // An explicitly injected store journals the result through its parent.
    expect(inspection.completions).toEqual([]);
  }, 30_000);
}

for (const delay of [2.2, 11]) {
  test(`a launch with every ps delayed ${delay}s still executes inside its startup budget`, async () => {
    const root = path.join(base, `slow-ps-${delay}`);
    const bin = path.join(base, `slow-ps-bin-${delay}`);
    mkdirSync(bin);
    writeFileSync(path.join(bin, "ps"), `#!/bin/sh\nsleep ${delay}\nexec /bin/ps "$@"\n`, { mode: 0o755 });
    const proc = Bun.spawn([...entrypoint("source"), "--exercise-owned-command", root], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      stdout: "pipe", stderr: "pipe", timeout: 60_000,
    });
    const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(JSON.parse(stdout)).toEqual({ exitCode: 143, stdout: "tool-output" });
    expect(readFileSync(path.join(root, "launched.txt"), "utf8")).toBe("granted");
  }, 75_000);
}

test("startup expiry refuses before a durable grant or command effect", async () => {
  const root = path.join(base, "startup-expiry");
  const bin = path.join(base, "expiry-bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "ps"), '#!/bin/sh\nsleep 2.2\nexec /bin/ps "$@"\n', { mode: 0o755 });
  const proc = Bun.spawn([...entrypoint("source"), "--exercise-owned-command", root, "500"], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdout: "pipe", stderr: "pipe", timeout: 20_000,
  });
  const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  expect(exitCode).toBe(1);
  expect(stderr).toContain("Timed out");
  expect(existsSync(path.join(root, "launched.txt"))).toBe(false);
  const inspection = JSON.parse(readFileSync(path.join(root, "inspection.json"), "utf8"));
  expect(inspection.launches).toMatchObject([{ phase: "planned", leaderPid: null, groupId: null }]);
}, 30_000);

test("a non-leader executor refuses before publishing its handshake", async () => {
  const root = path.join(base, "non-leader");
  mkdirSync(root);
  const proc = Bun.spawn([...entrypoint("source"), "__silo_execute", randomUUID(), root, randomUUID(), "1", "parent"], {
    cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 10_000,
  });
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  expect(exitCode).toBe(1);
  expect(stdout).toBe("");
  expect(stderr).toContain("Executor is not its process-group leader");
});

for (const distribution of ["source", "standalone"] as const) {
  for (const refusal of ["malformed JSON", "invalid schema", "foreign launch", "foreign leader", "foreign group", "EOF", "oversized grant"] as const) {
    test(`${distribution} executor refuses ${refusal} without executing the command`, async () => {
      const root = path.join(base, `${distribution}-${refusal.replaceAll(" ", "-")}`);
      mkdirSync(root);
      const id = randomUUID();
      const proc = Bun.spawn([...entrypoint(distribution), "__silo_execute", id, root, randomUUID(), "1", "parent"], {
        cwd: root, detached: true, stdin: "pipe", stdout: "pipe", stderr: "pipe", timeout: 20_000,
      });
      writeFileSync(path.join(root, "executor.pid"), String(proc.pid));
      const reader = proc.stdout.getReader();
      try {
        const handshake = await withTimeout({ result: reader.read(), cancel: () => reader.cancel() }, 5000, "test executor handshake");
        expect(new TextDecoder().decode(handshake.value)).toBe(`SILO_GATE ${id} ${proc.pid} ${proc.pid}\n`);
        expect(existsSync(path.join(root, "must-not-exist"))).toBe(false);
        const grant: Extract<Launch, { phase: "granted" }> = {
          id, phase: "granted", kind: "refusal-proof", effect: "none",
          command: ["/bin/sh", "-c", "printf executed > must-not-exist"],
          supervisorPid: process.pid, supervisorIdentity: "test-parent", leaderPid: proc.pid, groupId: proc.pid,
          exitCode: null, reconciled: false, terminal: false,
        };
        let payload: string;
        switch (refusal) {
          case "malformed JSON": payload = "{\n"; break;
          case "invalid schema": payload = "{}\n"; break;
          case "foreign launch": payload = JSON.stringify({ ...grant, id: randomUUID() }); break;
          case "foreign leader": payload = JSON.stringify({ ...grant, leaderPid: proc.pid + 1 }); break;
          case "foreign group": payload = JSON.stringify({ ...grant, groupId: proc.pid + 1 }); break;
          case "EOF": payload = ""; break;
          case "oversized grant": payload = "x".repeat(1024 * 1024 + 1); break;
        }
        proc.stdin.write(payload);
        proc.stdin.end();
        const [exitCode, trailing, stderr] = await Promise.all([proc.exited, reader.read(), new Response(proc.stderr).text()]);
        expect(exitCode).toBe(refusal === "EOF" ? 77 : 1);
        expect(trailing.done).toBe(true);
        if (refusal.startsWith("foreign")) expect(stderr).toContain("another launch's grant");
        if (refusal === "oversized grant") expect(stderr).toContain("grant exceeds 1 MiB");
        expect(existsSync(path.join(root, "must-not-exist"))).toBe(false);
      } finally {
        if (proc.exitCode === null && proc.signalCode === null) {
          proc.stdin.end();
          proc.kill("SIGTERM");
          await proc.exited;
        }
      }
    }, 25_000);
  }
}

for (const refusal of ["held-open grant timeout", "cancellation before grant"] as const) {
  test(`bundled executor exits after ${refusal} while its grant writer stays open`, async () => {
    const root = path.join(base, refusal.replaceAll(" ", "-"));
    const { id, proc, reader, stderr } = bundledExecutor(root, 55_000);
    try {
      const handshake = await withTimeout({ result: reader.read(), cancel: () => reader.cancel() }, 5000, "test executor handshake");
      expect(new TextDecoder().decode(handshake.value)).toBe(`SILO_GATE ${id} ${proc.pid} ${proc.pid}\n`);
      const start = Date.now();
      if (refusal === "cancellation before grant") proc.kill("SIGTERM");
      const [exitCode, trailing, diagnostic] = await withTimeout({
        result: Promise.all([proc.exited, reader.read(), stderr]),
        cancel: () => { if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL"); },
      }, refusal === "held-open grant timeout" ? 48_000 : 2000, "executor refusal exit with stdin held open");
      expect(trailing.done).toBe(true);
      expect(exitCode).toBe(refusal === "held-open grant timeout" ? 1 : 77);
      if (refusal === "held-open grant timeout") {
        expect(diagnostic).toContain("Timed out after 45000ms: executor grant");
        expect(Date.now() - start).toBeGreaterThanOrEqual(45_000);
      } else expect(diagnostic).toBe("");
      expect(existsSync(path.join(root, "must-not-exist"))).toBe(false);
    } finally {
      proc.stdin.end();
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
      await proc.exited;
      await reader.cancel();
      reader.releaseLock();
    }
  }, 60_000);
}

for (let attempt = 0; attempt < 16; attempt++) test(`bundled executor refuses a signal pending when a valid grant arrives (${attempt})`, async () => {
  const root = path.join(base, `pending-signal-${attempt}`);
  const { id, proc, reader, stderr } = bundledExecutor(root, 10_000);
  try {
    const handshake = await withTimeout({ result: reader.read(), cancel: () => reader.cancel() }, 5000, "test executor handshake");
    expect(new TextDecoder().decode(handshake.value)).toBe(`SILO_GATE ${id} ${proc.pid} ${proc.pid}\n`);
    proc.kill("SIGSTOP");
    const deadline = Date.now() + 5000;
    while (true) {
      const state = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(proc.pid)], { timeout: 1000 });
      if (state.exitCode === 0 && state.stdout.toString().trim().startsWith("T")) break;
      expect(Date.now()).toBeLessThan(deadline);
      await Bun.sleep(10);
    }
    proc.kill("SIGTERM");
    const grant: Extract<Launch, { phase: "granted" }> = {
      id, phase: "granted", kind: "pending-signal", effect: "none",
      command: ["/bin/sh", "-c", "printf executed > must-not-exist"],
      supervisorPid: process.pid, supervisorIdentity: "test-parent", leaderPid: proc.pid, groupId: proc.pid,
      exitCode: null, reconciled: false, terminal: false,
    };
    proc.stdin.write(JSON.stringify(grant));
    await proc.stdin.end();
    proc.kill("SIGCONT");
    const [exitCode, trailing, diagnostic] = await withTimeout({
      result: Promise.all([proc.exited, reader.read(), stderr]),
      cancel: () => { if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL"); },
    }, 2000, "pending signal refusal");
    expect({ exitCode, diagnostic, eof: trailing.done, executed: existsSync(path.join(root, "must-not-exist")) })
      .toEqual({ exitCode: 77, diagnostic: "", eof: true, executed: false });
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    await proc.exited;
    await reader.cancel();
    reader.releaseLock();
  }
}, 20_000);

test("a finished non-capture command releases a blocked output pipe within its stop window", async () => {
  const root = path.join(base, "blocked-output");
  const fifo = path.join(base, "unread-output.fifo");
  expect(Bun.spawnSync(["mkfifo", fifo], { timeout: 1000 }).exitCode).toBe(0);
  const reader = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
  const writer = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
  const proc = Bun.spawn([...entrypoint("bundled.js"), "--exercise-blocked-output", root], {
    detached: true, stdin: "ignore", stdout: "pipe", stderr: writer, timeout: 20_000,
  });
  closeSync(writer);
  writeFileSync(path.join(base, "blocked-output.pid"), String(proc.pid));
  const stdout = new Response(proc.stdout).text();
  try {
    const exitCode = await withTimeout({
      result: proc.exited,
      cancel: () => { if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL"); },
    }, 15_000, "non-capture command stop window");
    expect(exitCode).toBe(0);
    expect(JSON.parse(await stdout)).toEqual({ exitCode: 0, stdout: "" });
    expect(readSync(reader, Buffer.alloc(65536), 0, 65536, null)).toBeGreaterThan(0);
    expect(readFileSync(path.join(root, "launched.txt"), "utf8")).toBe("granted");
    const inspection = JSON.parse(readFileSync(path.join(root, "inspection.json"), "utf8"));
    expect(inspection.launches).toMatchObject([{ phase: "exited", started: true, exitCode: 0, reconciled: true }]);
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    await proc.exited;
    closeSync(reader);
  }
}, 25_000);
