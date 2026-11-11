import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProjectOperation, processAbsent } from "../core/lease_store";
import { withTimeout } from "../utils/timeout";
import { Database } from "bun:sqlite";
import { startOwnedCommand } from "../core/owned_command";

let base: string;
let account: string;
let bin: string;

beforeAll(async () => {
  base = mkdtempSync(path.join(os.tmpdir(), "silo-ci-interrupt-"));
  account = path.join(base, "account");
  bin = path.join(base, "bin");
  mkdirSync(account);
  mkdirSync(bin);
  writeFileSync(path.join(bin, "tilt"), "#!/bin/sh\nprintf ready > ready\nif test -f reconcile-probe; then touch cancel-probe; exit 0; fi\nif test -f quick-ci; then exit 0; fi\nexec sleep 60\n", { mode: 0o755 });
  writeFileSync(path.join(bin, "docker"), `#!/bin/sh
if test -f cancel-probe; then echo $$ > probe.pid; printf ready > probe-ready; exec sleep 60; fi
if test -f k3d-fixture; then exec bun ${JSON.stringify(path.resolve(import.meta.dir, "fixtures/docker.ts"))} "$@"; fi
if test -f setup-block; then echo $$ > setup.pid; printf ready > setup-ready; sleep 3; fi
case "$*" in
  'context inspect --format {{.Endpoints.docker.Host}}') echo unix:///private-fixture.sock ;;
  'info --format {{json .}}') echo '{"ID":"fixture-engine","OSType":"linux"}' ;;
  'network ls --no-trunc --format {{json .}}') echo '{"ID":"bridge-id","Name":"bridge"}' ;;
  'network inspect bridge-id') echo '[{"Id":"bridge-id","Name":"bridge"}]' ;;
  'container ls -a --no-trunc --format {{json .}}'|'volume ls --format {{json .}}') ;;
  'container ls -a --no-trunc --filter '*|'network ls --no-trunc --filter '*|'volume ls --filter '*) ;;
  *) echo "Unexpected Docker fixture request: $*" >&2; exit 1 ;;
esac
`, { mode: 0o755 });
  writeFileSync(path.join(bin, "k3d"), '#!/bin/sh\nif test "$2" = list; then echo "[]"; else echo $$ > tool.pid; printf ready > ready; exec sleep 60; fi\n', { mode: 0o755 });
  // Account lookup uses a private store; status import can pause at an explicit
  // fixture marker to expose the final-result signal window. Other behavior is
  // production code, with shell stand-ins at the Docker and Tilt boundaries.
  const privateAccount: Bun.BunPlugin = {
    name: "private-account",
    setup(build) {
      build.onLoad({ filter: /\/allocation_domain\.ts$/ }, () => ({
        contents: `export const accountHome = () => ${JSON.stringify(account)}; export const accountStorePath = () => ${JSON.stringify(path.join(account, ".silo/leases.sqlite"))};`,
        loader: "ts",
      }));
      build.onLoad({ filter: /\/commands\/status\.ts$/ }, async args => ({
        contents: `import * as fixtureFs from "node:fs"; if (fixtureFs.existsSync("delay-final-status")) { fixtureFs.writeFileSync("final-status-ready", "ready"); await Bun.sleep(3000); }\n${await Bun.file(args.path).text()}`,
        loader: "ts",
      }));
    },
  };
  const build = await Bun.build({ entrypoints: [path.resolve(import.meta.dir, "../cli.ts")], target: "bun", outdir: base, plugins: [privateAccount] });
  if (!build.success) throw new AggregateError(build.logs, "Private CLI build failed");
}, 60_000);

afterAll(() => { if (base) rmSync(base, { recursive: true }); });

const waitFor = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + 15_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Interrupted command did not reach the expected condition");
    await Bun.sleep(20);
  }
};

test("large JSON results survive a reader that starts late", async () => {
  const root = path.join(base, "large-output");
  mkdirSync(root);
  const source = 'version = 1\n[ports]\nTILT_PORT = "random"\n#' + "x".repeat(940_000) + "\n";
  writeFileSync(path.join(root, "silo.toml"), source);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: account, SILO_PORT_REGISTRY_DIR: path.join(account, "registry") };
  const command = [process.execPath, path.join(base, "cli.js")];
  for (const args of [["env", "large-output", "--json"], ["status", "--json"]]) {
    const proc = Bun.spawn([...command, ...args], { cwd: root, env, detached: true, stdout: "pipe", stderr: "pipe", timeout: 45_000 });
    writeFileSync(path.join(root, `${args[0]}.pid`), String(proc.pid));
    const errors = new Response(proc.stderr).text();
    try {
      await Bun.sleep(2000);
      const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), errors]);
      expect({ exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({ exitCode: 0, stderr: "" });
      const result = JSON.parse(stdout);
      expect(result.schemaVersion).toBe(1);
      expect(result.project.allocation.configSource).toBe(source);
    } finally {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGTERM");
      await proc.exited;
      await errors;
    }
  }
  const down = Bun.spawn([...command, "down", "--clean", "--json"], { cwd: root, env, stdout: "pipe", stderr: "pipe", timeout: 30_000 });
  const [exitCode, stdout] = await Promise.all([down.exited, new Response(down.stdout).text()]);
  expect(exitCode).toBe(0);
  expect(JSON.parse(stdout).project.claims).toEqual([]);
}, 120_000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`ci --json emits one complete result on ${signal} and status observes its dead launch without mutating ownership`, async () => {
    const root = path.join(base, signal);
    mkdirSync(root);
    writeFileSync(path.join(root, "silo.toml"), 'version = 1\n[ports]\nTILT_PORT = "random"\n');
    const storePath = path.join(account, ".silo/leases.sqlite");
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: account, SILO_PORT_REGISTRY_DIR: path.join(account, "registry") };
    const command = [process.execPath, path.join(base, "cli.js")];
    const proc = Bun.spawn([...command, "ci", signal.toLowerCase(), "--json"], { cwd: root, env, detached: true, stdout: "pipe", stderr: "pipe", timeout: 30_000 });
    writeFileSync(path.join(root, "cli.pid"), String(proc.pid));
    const output = new Response(proc.stdout).text();
    const errors = new Response(proc.stderr).text();
    try {
      await waitFor(() => existsSync(path.join(root, "ready")) || proc.exitCode !== null);
      if (proc.exitCode !== null) throw new Error(`CLI exited before Tilt: ${await output}\n${await errors}`);
      const launch = ProjectOperation.inspect(root, storePath)!.launches[0]!;
      expect(launch.phase).toBe("granted");
      proc.kill(signal);
      const [exitCode, stdout] = await withTimeout({ result: Promise.all([proc.exited, output]), cancel: () => { if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGTERM"); } }, 15_000, "interrupted CLI output");
      expect(exitCode).toBe(signal === "SIGINT" ? 130 : 143);
      await waitFor(() => processAbsent(launch.supervisorPid!) && processAbsent(-launch.groupId!));
      const before = ProjectOperation.inspect(root, storePath)!;
      const bytes = readFileSync(storePath);
      const status = Bun.spawn([...command, "status", "--json"], { cwd: root, env, stdout: "pipe", stderr: "pipe", timeout: 15_000 });
      const [statusExit, statusOutput, statusErrors] = await Promise.all([status.exited, new Response(status.stdout).text(), new Response(status.stderr).text()]);
      expect({ statusExit, statusErrors }).toEqual({ statusExit: 0, statusErrors: "" });
      const result = JSON.parse(statusOutput);
      expect(result.project).toEqual(before);
      expect(result.project.claims.length).toBeGreaterThan(0);
      expect(result.launchStatus).toMatchObject([{ launchId: launch.id, state: "completed", groupsAbsent: true, completion: { started: true, exitCode: 143 } }]);
      expect(result.cleanupRequired).toBe(true);
      expect(readFileSync(storePath)).toEqual(bytes);
      expect(JSON.parse(stdout)).toMatchObject({ schemaVersion: 1, code: "INTERRUPTED", signal });
      if (signal === "SIGINT") {
        const db = new Database(storePath);
        const completion = before.completions.find(c => c.launchId === launch.id)!;
        const key = [before.projectId, before.generation, launch.id] as const;
        try {
          db.query("DELETE FROM completions WHERE project_id = ? AND generation = ? AND launch_id = ?").run(...key);
          const missing = Bun.spawn([...command, "status", "--json"], { cwd: root, env, stdout: "pipe", stderr: "pipe", timeout: 15_000 });
          const missingResult = JSON.parse(await new Response(missing.stdout).text());
          expect(await missing.exited).toBe(0);
          expect(missingResult.launchStatus).toMatchObject([{ state: "terminated", groupsAbsent: true, completion: null }]);
          expect(missingResult.cleanupRequired).toBe(true);
          expect(missingResult.project.launches).toEqual(before.launches);
          db.query("INSERT INTO completions (project_id, generation, launch_id, receipt) VALUES (?, ?, ?, ?)").run(...key, JSON.stringify({ ...completion, projectId: "another-project" }));
          const foreign = Bun.spawn([...command, "status", "--json"], { cwd: root, env, stdout: "pipe", stderr: "pipe", timeout: 15_000 });
          const foreignResult = JSON.parse(await new Response(foreign.stdout).text());
          expect(await foreign.exited).toBe(1);
          expect(foreignResult).toMatchObject({ schemaVersion: 1, code: "COMPLETION_PROVENANCE_MISMATCH" });
          expect(foreignResult.message).toContain("Completion provenance differs from the grant");
        } finally {
          db.query("INSERT OR REPLACE INTO completions (project_id, generation, launch_id, receipt) VALUES (?, ?, ?, ?)").run(...key, JSON.stringify(completion));
          db.close();
        }
      }
      const retry = Bun.spawn([...command, "ci", "--json"], { cwd: root, env, stdout: "pipe", stderr: "pipe", timeout: 15_000 });
      const [retryExit, retryOutput, retryErrors] = await Promise.all([retry.exited, new Response(retry.stdout).text(), new Response(retry.stderr).text()]);
      expect(retryExit, `Retry exited ${retryExit}\nstdout: ${retryOutput}\nstderr: ${retryErrors}`).toBe(1);
      expect(JSON.parse(retryOutput)).toMatchObject({ code: "BUSY" });
      const recover = Bun.spawn([...command, "down", "--clean", "--json"], { cwd: root, env, stdout: "pipe", stderr: "pipe", timeout: 30_000 });
      const [recoverExit, recoverOutput, recoverErrors] = await Promise.all([recover.exited, new Response(recover.stdout).text(), new Response(recover.stderr).text()]);
      if (recoverExit !== 0) throw new Error(`Recovery failed: ${recoverOutput}\n${recoverErrors}`);
      expect(recoverExit).toBe(0);
      expect(JSON.parse(recoverOutput).project).toMatchObject({ phase: "unallocated", claims: [], operation: null });
    } finally {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGTERM");
      await proc.exited;
      await errors;
      const launches = ProjectOperation.inspect(root, storePath)?.launches ?? [];
      await waitFor(() => launches.every(l => l.supervisorPid === null || (processAbsent(l.supervisorPid) && processAbsent(-l.groupId!))));
    }
  }, 45_000);
}

for (const stage of ["setup", "final-status"] as const) {
  test(`ci interruption during ${stage} emits one JSON object with the matching operation lifetime`, async () => {
    const root = path.join(base, stage);
    mkdirSync(root);
    writeFileSync(path.join(root, "silo.toml"), 'version = 1\n[ports]\nTILT_PORT = "random"\n');
    const marker = stage === "setup" ? "setup-block" : "delay-final-status";
    writeFileSync(path.join(root, marker), "");
    writeFileSync(path.join(root, "quick-ci"), "");
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: account, SILO_PORT_REGISTRY_DIR: path.join(account, "registry") };
    const command = [process.execPath, path.join(base, "cli.js")];
    const proc = Bun.spawn([...command, "ci", stage, "--json"], { cwd: root, env, detached: true, stdout: "pipe", stderr: "pipe", timeout: 30_000 });
    writeFileSync(path.join(root, "cli.pid"), String(proc.pid));
    const output = new Response(proc.stdout).text();
    const errors = new Response(proc.stderr).text();
    try {
      const ready = stage === "setup" ? "setup-ready" : "final-status-ready";
      await waitFor(() => existsSync(path.join(root, ready)) || proc.exitCode !== null);
      if (proc.exitCode !== null) throw new Error(`CLI exited before ${stage}: ${await output}\n${await errors}`);
      proc.kill("SIGTERM");
      const [exitCode, stdout] = await Promise.all([proc.exited, output]);
      expect(exitCode).toBe(143);
      expect(JSON.parse(stdout)).toMatchObject({ schemaVersion: 1, code: "INTERRUPTED", signal: "SIGTERM" });
      unlinkSync(path.join(root, marker));
      const status = Bun.spawn([...command, "status", "--json"], { cwd: root, env, stdout: "pipe", stderr: "pipe", timeout: 15_000 });
      const [statusExit, statusOutput] = await Promise.all([status.exited, new Response(status.stdout).text()]);
      expect(statusExit).toBe(0);
      const result = JSON.parse(statusOutput);
      expect(result.operationOwnerAbsent).toBe(stage === "setup");
      expect(result.cleanupRequired).toBe(stage === "setup");
      if (stage === "final-status") expect(result.project.operation).toBe(null);
      const retry = Bun.spawn([...command, "ci", "--json"], { cwd: root, env, stdout: "pipe", stderr: "pipe", timeout: 30_000 });
      const [retryExit, retryOutput, retryErrors] = await Promise.all([retry.exited, new Response(retry.stdout).text(), new Response(retry.stderr).text()]);
      const retryDiagnostic = `Retry exited ${retryExit}\nstdout: ${retryOutput}\nstderr: ${retryErrors}`;
      if (stage === "setup") {
        expect(retryExit, retryDiagnostic).toBe(1);
        expect(JSON.parse(retryOutput)).toMatchObject({ code: "BUSY" });
      } else {
        expect(retryExit, retryDiagnostic).toBe(0);
        expect(JSON.parse(retryOutput).project.operation).toBe(null);
      }
      const down = Bun.spawn([...command, "down", "--clean", "--json"], { cwd: root, env, stdout: "pipe", stderr: "pipe", timeout: 30_000 });
      const [downExit, downOutput] = await Promise.all([down.exited, new Response(down.stdout).text()]);
      if (downExit !== 0) throw new Error(downOutput);
      expect(JSON.parse(downOutput).project.operation).toBe(null);
    } finally {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGTERM");
      await proc.exited;
      await errors;
      if (stage === "setup" && existsSync(path.join(root, "setup.pid"))) {
        await waitFor(() => processAbsent(Number(readFileSync(path.join(root, "setup.pid"), "utf8"))));
      }
    }
  }, 45_000);
}

for (const phase of ["hook", "k3d-create", "tilt", "tilt-reconcile"] as const) {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    test(`up ${phase} stops its owned group on first ${signal}, reports interruption and recovers through down`, async () => {
      const root = path.join(base, `up-${phase}-${signal}`);
      mkdirSync(root);
      const extra = phase === "hook" ? '[hooks]\npre-up = ["echo $$ > tool.pid; printf ready > ready; exec sleep 60"]\n' :
        phase === "k3d-create" ? '[k3d]\nenabled = true\n' : '';
      if (phase === "k3d-create") writeFileSync(path.join(root, "k3d-fixture"), "");
      if (phase === "tilt-reconcile") writeFileSync(path.join(root, "reconcile-probe"), "");
      writeFileSync(path.join(root, "silo.toml"), `version = 1\n${extra}[ports]\nTILT_PORT = "random"\n`);
      const storePath = path.join(account, ".silo/leases.sqlite");
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: account, DOCKER_HOST: "unix:///private-fixture.sock" };
      const command = [process.execPath, path.join(base, "cli.js")];
      const proc = Bun.spawn([...command, "up", `${phase}-${signal.toLowerCase()}`, "--json"], { cwd: root, env, detached: true, stdout: "pipe", stderr: "pipe", timeout: 25_000 });
      writeFileSync(path.join(root, "cli.pid"), String(proc.pid));
      const output = new Response(proc.stdout).text();
      const errors = new Response(proc.stderr).text();
      try {
        await waitFor(() => existsSync(path.join(root, phase === "tilt-reconcile" ? "probe-ready" : "ready")) || proc.exitCode !== null);
        if (proc.exitCode !== null) throw new Error(`Exited before ${phase}: ${await output}\n${await errors}`);
        const before = ProjectOperation.inspect(root, storePath)!;
        const launch = before.launches.find(l => l.kind === (phase === "hook" ? "hook-pre-up" : phase === "k3d-create" ? "k3d-cluster-create" : "tilt-up"))!;
        expect(launch.phase).toBe(phase === "tilt-reconcile" ? "exited" : "granted");
        const start = Date.now();
        process.kill(-proc.pid, signal);
        const [exitCode, stdout] = await withTimeout({ result: Promise.all([proc.exited, output]), cancel: () => { if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL"); } }, 12_000, "up interrupt deadline");
        expect(Date.now() - start).toBeLessThan(11_000);
        expect(exitCode).toBe(signal === "SIGINT" ? 130 : 143);
        expect(JSON.parse(stdout)).toMatchObject({ schemaVersion: 1, code: "INTERRUPTED", signal });
        expect(JSON.parse(stdout).message).toContain("silo down");
        await waitFor(() => processAbsent(launch.supervisorPid!) && processAbsent(-launch.groupId!));
        const after = ProjectOperation.inspect(root, storePath)!;
        expect(after.claims).toEqual(before.claims);
        const status = Bun.spawn([...command, "status", "--json"], { cwd: root, env, stdout: "pipe", stderr: "pipe", timeout: 10_000 });
        const [statusCode, statusOutput] = await Promise.all([status.exited, new Response(status.stdout).text()]);
        expect(statusCode).toBe(0);
        const { phase: recordedPhase, problem } = JSON.parse(statusOutput).project;
        expect({ phase: recordedPhase, problem }).toEqual({ phase: "cleanup-required", problem: JSON.parse(stdout).message });
        if (phase === "tilt-reconcile") unlinkSync(path.join(root, "cancel-probe"));
        const recover = Bun.spawn([...command, "down", "--delete-cluster", "--clean", "--json"], { cwd: root, env, stdout: "pipe", stderr: "pipe", timeout: 25_000 });
        const [recovered, recoveredOutput, recoveredErrors] = await Promise.all([recover.exited, new Response(recover.stdout).text(), new Response(recover.stderr).text()]);
        expect(recovered, `${recoveredOutput}\n${recoveredErrors}`).toBe(0);
        expect(JSON.parse(recoveredOutput).project).toMatchObject({ phase: "unallocated", claims: [] });
      } finally {
        if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
        await proc.exited;
        await errors;
        await waitFor(() => (ProjectOperation.inspect(root, storePath)?.launches ?? []).every(l => l.supervisorPid === null || (processAbsent(l.supervisorPid) && processAbsent(-l.groupId!))));
      }
    }, 45_000);
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`down cancelled probe reports ${signal} as INTERRUPTED and retains claims until retry`, async () => {
    const root = path.join(base, `down-probe-${signal}`);
    mkdirSync(root);
    writeFileSync(path.join(root, "silo.toml"), 'version = 1\n[ports]\nTILT_PORT = "random"\n');
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: account, DOCKER_HOST: "unix:///private-fixture.sock" };
    const command = [process.execPath, path.join(base, "cli.js")];
    const invoke = async (args: string[]) => {
      const proc = Bun.spawn([...command, ...args, "--json"], { cwd: root, env, stdout: "pipe", stderr: "pipe", timeout: 20_000 });
      const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      expect(exitCode, stdout + stderr).toBe(0);
      return JSON.parse(stdout);
    };
    await invoke(["env", `probe-${signal.toLowerCase()}`]);
    // A completed hook requires backend reconciliation during down, even
    // though this fixture created no Docker objects.
    const owner = await ProjectOperation.open(root, { storePath: path.join(account, ".silo/leases.sqlite"), executorEntrypoint: path.join(base, "cli.js") });
    try {
      const running = await startOwnedCommand(owner, [process.execPath, "-e", ""], { kind: "hook-pre-up", effect: "hook", timeoutMs: 5000 });
      owner.recordCommandResult((await running.exited).launch);
    } finally { owner.finish(); }
    const before = await invoke(["status"]);
    writeFileSync(path.join(root, "cancel-probe"), "");
    const proc = Bun.spawn([...command, "down", "--delete-cluster", "--clean", "--json"], { cwd: root, env, detached: true, stdout: "pipe", stderr: "pipe", timeout: 20_000 });
    writeFileSync(path.join(root, "cli.pid"), String(proc.pid));
    const output = new Response(proc.stdout).text();
    const errors = new Response(proc.stderr).text();
    try {
      await waitFor(() => existsSync(path.join(root, "probe-ready")) || proc.exitCode !== null);
      if (proc.exitCode !== null) throw new Error(`Exited before probe: ${await output}\n${await errors}`);
      process.kill(-proc.pid, signal);
      const [exitCode, stdout] = await Promise.all([proc.exited, output]);
      expect(exitCode).toBe(signal === "SIGINT" ? 130 : 143);
      expect(JSON.parse(stdout)).toMatchObject({ code: "INTERRUPTED", signal });
      expect(stdout).not.toContain("ENGINE_UNAVAILABLE");
      const status = await invoke(["status"]);
      expect(status.project.claims).toEqual(before.project.claims);
      expect(status.project.phase).toBe("cleanup-required");
      expect(status.project.problem).toContain("interrupted");
      expect(status.project.problem).not.toContain("ENGINE_UNAVAILABLE");
      unlinkSync(path.join(root, "cancel-probe"));
      const recovered = await invoke(["down", "--delete-cluster", "--clean"]);
      expect(recovered.project).toMatchObject({ phase: "unallocated", claims: [] });
      await waitFor(() => processAbsent(Number(readFileSync(path.join(root, "probe.pid"), "utf8"))));
    } finally {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
      await proc.exited;
      await errors;
    }
  }, 45_000);
}

test("up interrupted before final status emission cannot select a success result", async () => {
  const root = path.join(base, "up-final-status");
  mkdirSync(root);
  writeFileSync(path.join(root, "silo.toml"), 'version = 1\n[ports]\nTILT_PORT = "random"\n');
  writeFileSync(path.join(root, "quick-ci"), "");
  writeFileSync(path.join(root, "delay-final-status"), "");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: account };
  const proc = Bun.spawn([process.execPath, path.join(base, "cli.js"), "up", "up-final-status", "--json"], { cwd: root, env, detached: true, stdout: "pipe", stderr: "pipe", timeout: 15_000 });
  writeFileSync(path.join(root, "cli.pid"), String(proc.pid));
  const output = new Response(proc.stdout).text();
  const errors = new Response(proc.stderr).text();
  try {
    await waitFor(() => existsSync(path.join(root, "final-status-ready")) || proc.exitCode !== null);
    if (proc.exitCode !== null) throw new Error(`Exited before status: ${await output}\n${await errors}`);
    proc.kill("SIGTERM");
    const [exitCode, stdout] = await Promise.all([proc.exited, output]);
    expect(exitCode).toBe(143);
    expect(JSON.parse(stdout)).toMatchObject({ code: "INTERRUPTED", signal: "SIGTERM" });
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    await proc.exited;
    await errors;
  }
}, 20_000);
