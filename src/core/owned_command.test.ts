import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
        const handshake = await withTimeout(reader.read(), 5000, "test executor handshake");
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
