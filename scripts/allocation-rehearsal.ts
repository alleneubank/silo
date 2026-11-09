/** Native public-CLI rehearsal. Run only in an explicitly disposable OS account. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { AllocationSchema, BackendReceiptSchema, ExecutorCompletionSchema, FileReceiptSchema, LaunchSchema } from "../src/core/lease_types";
import { accountHome as nativeAccountHome } from "../src/core/allocation_domain";
import { ProjectOperation } from "../src/core/lease_store";
import { HOOK_TIMEOUT_MS, K3D_CREATE_TIMEOUT_MS, K3D_DELETE_TIMEOUT_MS } from "../src/core/constants";

const { values } = parseArgs({ args: Bun.argv.slice(2), options: {
  root: { type: "string" }, silo: { type: "string" }, suite: { type: "string", default: "all" },
  "legacy09": { type: "string" }, "legacy05": { type: "string" },
}, strict: true });
assert(values.root && values.silo, "Usage: bun scripts/allocation-rehearsal.ts --root <owned scratch> --silo <built cli.js> [--suite live|legacy|backend|volumes|all] [--legacy09 <0.9.0 cli.js> --legacy05 <0.5.9 cli.js>]");
const accountHome = nativeAccountHome();
assert.equal(readFileSync(path.join(accountHome, ".silo-rehearsal-account"), "utf8").trim(), "disposable silo rehearsal account", "Refusing a real account: create the marker only inside a disposable OS account/filesystem view");
const cli = path.resolve(values.silo);
const root = mkdtempSync(path.join(path.resolve(values.root), "allocation-rehearsal-"));
const events = path.join(root, "events.jsonl");
const resourceFile = path.join(root, "resources");
const redactCapture = (value: string): string => value
  .replace(/K3S_TOKEN=[^"\\\s]+/g, "K3S_TOKEN=[REDACTED_EPHEMERAL_FIXTURE_TOKEN]")
  .replace(/((?:\\?")k3d\.cluster\.token(?:\\?")\s*:\s*(?:\\?"))[^"\\]*(\\?")/g, "$1[REDACTED_EPHEMERAL_FIXTURE_TOKEN]$2");
const recordResource = (line: string) => {
  const safe = redactCapture(line);
  appendFileSync(resourceFile, safe);
  appendFileSync(path.resolve("resources"), `rehearsal ${root}: ${safe}`);
};
const log = (event: unknown) => { const line = redactCapture(JSON.stringify(event)); console.log(line); appendFileSync(events, line + "\n"); };
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const safeEnv: NodeJS.ProcessEnv = { ...process.env, CI: "false", GITHUB_ENV: "", SILO_PROFILE: "" };
delete safeEnv.SILO_PORT_REGISTRY_DIR;
delete safeEnv.GITHUB_ACTIONS;
delete safeEnv.USER;
delete safeEnv.LOGNAME;
const processes = new Set<Bun.Subprocess>();
const projects: string[] = [];
const FixtureSnapshotSchema = z.array(z.object({ Mounts: z.array(z.object({ Destination: z.string() }).passthrough()).optional() }).passthrough());
const cleanupObjects: { kind: "container" | "network" | "volume"; id: string; name: string; created: z.infer<typeof FixtureSnapshotSchema> }[] = [];
let commandNumber = 0;
const ResultSchema = z.object({
  code: z.string().optional(), changed: z.boolean().optional(), legacy: z.boolean().optional(), found: z.array(z.object({ path: z.string() }).passthrough()).optional(),
  project: z.object({ projectId: z.string(), generation: z.number(), phase: z.string().nullable(), allocation: AllocationSchema.nullable(),
    claims: z.array(z.object({ domain: z.string(), resource: z.string(), prefix: z.boolean().optional() })),
    resources: z.array(BackendReceiptSchema.and(z.object({ deleted: z.boolean() }))), launches: z.array(LaunchSchema), completions: z.array(ExecutorCompletionSchema), files: z.array(FileReceiptSchema),
  }).passthrough().nullable().optional(),
});
// Outlasts the CLI's hook and k3d command bounds, so their timeouts report the
// CLI's own error before the harness stops the CLI. Tilt CI's two-hour bound
// (TILT_CI_TIMEOUT_MS) is deliberately not covered: a stuck Tilt CI is stopped
// by the harness first.
const COMMAND_TIMEOUT_MS = Math.max(HOOK_TIMEOUT_MS, K3D_CREATE_TIMEOUT_MS, K3D_DELETE_TIMEOUT_MS) + 120_000;
async function command(cwd: string, argv: string[], env = safeEnv) {
  const id = ++commandNumber;
  const proc = Bun.spawn(argv, { cwd, env, detached: true, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  processes.add(proc);
  recordResource(`process ${proc.pid} pgid=${proc.pid}: ${JSON.stringify(argv)}; teardown via returned subprocess handle or verified recorded group\n`);
  const timer = setTimeout(() => { proc.kill("SIGTERM"); }, COMMAND_TIMEOUT_MS);
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer); processes.delete(proc);
  writeFileSync(path.join(root, `${id}.stdout`), redactCapture(stdout)); writeFileSync(path.join(root, `${id}.stderr`), redactCapture(stderr));
  log({ command: id, cwd, argv, code });
  return { stdout, stderr, code };
}
async function silo(project: string, args: string[], expected: string | null = null, env = safeEnv) {
  const result = await command(project, [process.execPath, cli, ...args, "--json"], env);
  const parsed = ResultSchema.parse(JSON.parse(result.stdout));
  if (expected) { assert.notEqual(result.code, 0, result.stdout); assert.equal(parsed.code, expected, result.stdout); }
  else assert.equal(result.code, 0, result.stdout + result.stderr);
  return parsed;
}
const state = async (p: string) => { const result = await silo(p, ["status"]); assert(result.project?.allocation); return result.project; };
function project(label: string, extra = "") {
  const p = path.join(root, label); mkdirSync(p); projects.push(p);
  writeFileSync(path.join(p, "silo.toml"), `version=1\n${extra}\n[ports]\nAPP_PORT=48127\nTILT_PORT=48128\n[hosts]\nAPP_HOST="\u0024{name}.localhost"\nTILT_HOST="127.0.0.1"\n[tilt]\nwebMode="prod"\n[profiles.alternative.ports]\nAPP_PORT=48129\n`);
  writeFileSync(path.join(p, "Tiltfile"), "local_resource('proof', cmd='printf native-proof')\n"); return p;
}
const name = (p: string) => `proof-${path.basename(root).slice(-6).toLowerCase()}-${path.basename(p)}`;
async function until(description: string, condition: () => Promise<boolean>, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (!(await condition())) { assert(Date.now() < end, `Timed out: ${description}`); await Bun.sleep(50); }
}
async function body(port: number) {
  try { return await (await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) })).text(); } catch { return null; }
}
const snapshot = (directory: string): string => {
  if (!existsSync(directory)) return "absent";
  const walk = (p: string): unknown => statSync(p).isDirectory() ? readdirSync(p).sort().map(n => [n, walk(path.join(p, n))]) : digest(p);
  return JSON.stringify(walk(directory));
};
function start(p: string) {
  const proc = Bun.spawn([process.execPath, cli, "up"], { cwd: p, env: safeEnv, detached: true, stdout: Bun.file(path.join(p, "up.log")), stderr: Bun.file(path.join(p, "up.log")) });
  processes.add(proc); writeFileSync(path.join(p, "silo.pid"), String(proc.pid));
  recordResource(`silo up pid/pgid ${proc.pid} root ${p}; teardown via returned handle then silo down --clean\n`);
  return proc;
}
async function live() {
  const a = project("a"), b = project("b");
  const [ar, br] = await Promise.all([silo(a, ["env", name(a)]), silo(b, ["env", name(b)])]);
  const ap = ar.project?.allocation?.state.ports, bp = br.project?.allocation?.state.ports; assert(ap && bp);
  assert(!Object.values(ap).some(p => Object.values(bp).includes(p)));
  const beforeB = await state(b);
  await silo(a, ["down", "--clean"]); assert.deepEqual(await state(b), beforeB);
  await silo(a, ["env", name(a)]);
  const reserved = await state(a); assert(reserved.allocation);
  const port = reserved.allocation.state.ports.TILT_PORT!;
  const squatter = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("non-silo-squatter") });
  try {
    await silo(a, ["ci", "--timeout=10s"], "PORT_BIND_CONFLICT");
    assert.equal(await body(port), "non-silo-squatter");
    await silo(a, ["down", "--clean"], "CLEANUP_REQUIRED");
    assert.deepEqual((await state(a)).claims, reserved.claims);
  } finally { await squatter.stop(true); }
  await silo(a, ["down", "--clean"]);
  log({ scenario: "squatter preserved; no renumbering or release", pass: true });
  // Crash the built artifact after rename and before its receipt checkpoint.
  const preload = path.join(root, "crash-export.ts"), renamed = path.join(root, "renamed");
  writeFileSync(preload, `import fs from 'node:fs';import{Database}from'bun:sqlite';const query=Database.prototype.query;Database.prototype.query=function(...sql){const stmt=query.apply(this,sql);const run=stmt.run;stmt.run=function(...args){let receipt;try{receipt=typeof args[0]==='string'?JSON.parse(args[0]):null}catch{}if(receipt?.role==='env'&&receipt.published&&receipt.pending===null&&fs.existsSync(receipt.target.path)){fs.writeFileSync(${JSON.stringify(renamed)},'renamed');process.kill(process.pid,'SIGKILL')}return run.apply(this,args)};return stmt};`);
  const peerBeforeExportCrash = await state(b);
  const crash = await command(a, [process.execPath, "--preload", preload, cli, "env", name(a)]);
  assert.notEqual(crash.code, 0); assert(existsSync(renamed)); assert(existsSync(path.join(a, ".localnet.env")));
  assert.deepEqual(await state(b), peerBeforeExportCrash);
  await silo(a, ["down", "--clean"]);
  log({ scenario: "native crash after rename before receipt checkpoint recovers own inode; B untouched", pass: true });
  const gate = project("gate-crash");
  const canary = path.join(gate, "must-not-execute");
  writeFileSync(path.join(gate, "silo.toml"), readFileSync(path.join(gate, "silo.toml"), "utf8") + '\n[hooks]\npre-up=["touch must-not-execute"]\n');
  const gatePreload = path.join(root, "crash-grant.ts"), ungranted = path.join(gate, "ungranted.json");
  writeFileSync(gatePreload, `import fs from 'node:fs';import{Database}from'bun:sqlite';const query=Database.prototype.query;Database.prototype.query=function(...sql){const stmt=query.apply(this,sql),run=stmt.run;stmt.run=function(...args){let receipt;try{receipt=typeof args[0]==='string'?JSON.parse(args[0]):null}catch{}if(receipt?.phase==='granted'){fs.writeFileSync(${JSON.stringify(ungranted)},JSON.stringify(receipt));process.kill(process.pid,'SIGKILL')}return run.apply(this,args)};return stmt};`);
  const ungrantedCrash = await command(gate, [process.execPath, "--preload", gatePreload, cli, "up", name(gate)]);
  assert.notEqual(ungrantedCrash.code, 0); const proposed = LaunchSchema.parse(JSON.parse(readFileSync(ungranted, "utf8"))); assert(proposed.groupId);
  recordResource(`ungranted launch supervisor=${proposed.supervisorPid} group=${proposed.groupId}; Janitor owns drain after recorded CLI death; tool gate never granted\n`);
  await until("ungranted group drained", async () => { try { process.kill(-proposed.groupId!, 0); return false; } catch (error) { if (error instanceof Error && "code" in error && error.code === "ESRCH") return true; throw error; } });
  assert(!existsSync(canary)); await silo(gate, ["down", "--clean"]); assert(!existsSync(canary));
  log({ scenario: "native owner SIGKILL before durable grant executes no hook and drains actual child group", pass: true });
  const server = path.join(root, "server.ts");
  writeFileSync(server, `import {writeFileSync} from 'node:fs'; Bun.serve({hostname:'127.0.0.1',port:Number(process.env.APP_PORT),fetch:()=>new Response(process.env.WORKSPACE_NAME)});writeFileSync(Bun.argv[2],String(process.pid),{flag:'wx'});setTimeout(()=>process.exit(0),180000);`);
  for (const p of [a, b]) writeFileSync(path.join(p, "Tiltfile"), `local_resource('identity',serve_cmd=['bun',${JSON.stringify(server)},${JSON.stringify(path.join(p, "server.pid"))}])\n`);
  const freshA = await silo(a, ["env", name(a)]); const finalAP = freshA.project!.allocation!.state.ports;
  const pa = start(a), pb = start(b);
  try {
    await until("both real Tilt services", async () => await body(finalAP.APP_PORT!) === name(a) && await body(bp.APP_PORT!) === name(b));
    const stableB = await state(b); const stableA = await state(a);
    const crashedLaunch = stableA.launches.find(launch => launch.kind === "tilt-up" && launch.phase === "granted");
    assert(crashedLaunch);
    await silo(a, ["up"]); await silo(a, ["up", "--force"], "ALREADY_RUNNING");
    await silo(a, ["env", "--profile", "alternative", "--force"], "ALREADY_RUNNING");
    assert.deepEqual((await state(a)).claims, stableA.claims);
    pa.kill("SIGKILL"); await pa.exited; processes.delete(pa);
    await until("owner crash drains A", async () => await body(finalAP.APP_PORT!) === null);
    assert.equal(await body(bp.APP_PORT!), name(b)); assert.deepEqual(await state(b), stableB);
    // Listener shutdown alone does not prove tool exit or durable completion.
    // Read-only status observes that fact; it does not reconcile the launch.
    let crashedA = await state(a);
    await until("crashed A's exact launch has a durable completion", async () => {
      crashedA = await state(a);
      assert.equal(crashedA.projectId, stableA.projectId); assert.equal(crashedA.generation, stableA.generation);
      assert.deepEqual(crashedA.claims, stableA.claims);
      return crashedA.completions.some(completion => completion.launchId === crashedLaunch.id);
    });
    assert.deepEqual(crashedA.claims, stableA.claims); assert(crashedA.completions.length > 0);
    const completion = crashedA.completions.find(completion => completion.launchId === crashedLaunch.id); assert(completion);
    assert.deepEqual([completion.projectId, completion.generation, completion.leaderPid, completion.groupId, completion.started],
      [stableA.projectId, stableA.generation, crashedLaunch.leaderPid, crashedLaunch.groupId, true]);
    log({ scenario: "owner-crash durable completion observed", launchId: crashedLaunch.id, completion, pass: true });
    assert.equal(await body(bp.APP_PORT!), name(b)); assert.deepEqual(await state(b), stableB);
    await silo(a, ["down", "--clean"]); assert.equal(await body(bp.APP_PORT!), name(b));
    log({ scenario: "live force refusal, owner crash, completion recovery, B untouched", pass: true, b: stableB.projectId });
  } finally {
    for (const proc of [pa, pb]) if (proc.exitCode === null) { proc.kill("SIGTERM"); await proc.exited; processes.delete(proc); }
  }
  await silo(b, ["down", "--clean"]);
  await silo(a, ["env", name(a)]); await silo(a, ["env", "--profile", "alternative", "--force"]);
  assert.equal((await state(a)).allocation?.state.profile, "alternative"); await silo(a, ["down", "--clean"]);
  const teardown = project("failed-teardown");
  await silo(teardown, ["ci", name(teardown), "--timeout=30s"]);
  const beforeTeardown = await state(teardown);
  const tiltfile = readFileSync(path.join(teardown, "Tiltfile"), "utf8"); writeFileSync(path.join(teardown, "Tiltfile"), "fail('intentional fixture teardown failure')\n");
  await silo(teardown, ["down", "--clean"]);
  assert.deepEqual((await silo(teardown, ["status"])).project?.claims, []);
  assert(!existsSync(path.join(teardown, ".silo.lock")));
  writeFileSync(path.join(teardown, "Tiltfile"), tiltfile);
  log({ scenario: "cleanup consumes receipts without evaluating a failing Tiltfile", originalClaims: beforeTeardown.claims, pass: true });
  const files = project("files", 'output="nested/Shared.env"');
  const nested = project("files/nested", 'output="shared.env"');
  await silo(files, ["env", name(files)]);
  const fileBytes = readFileSync(path.join(nested, "Shared.env"));
  await silo(nested, ["env", name(nested)], "PATH_CONFLICT"); assert.deepEqual(readFileSync(path.join(nested, "Shared.env")), fileBytes);
  await silo(files, ["down", "--clean"]);
  for (const [label, alias] of [["CaseRoot", "caseroot"], ["Caf\u00e9", "Cafe\u0301"]]) {
    const original = project(label!); const alternate = path.join(root, alias!);
    await silo(original, ["env", `alias-${path.basename(root).toLowerCase()}-${projects.length}`]);
    if (existsSync(alternate)) {
      assert.equal((await state(alternate)).projectId, (await state(original)).projectId);
      log({ scenario: "native filesystem root alias shares project", original, alternate, pass: true });
    } else log({ scenario: "native filesystem keeps these spellings distinct", original, alternate });
    await silo(original, ["down", "--clean"]);
  }
}
async function legacy() {
  assert(values.legacy09 && values.legacy05, "Legacy suite requires both pinned published artifacts");
  const old = project("old"), peer = project("legacy-peer");
  const home = path.join(root, "invoking-home"), override = path.join(root, "old-registry"); mkdirSync(home);
  const accountRegistry = path.join(accountHome, ".silo/instances");
  const store = path.join(accountHome, ".silo/leases.sqlite");
  const homes = [accountRegistry, path.join(home, ".silo/instances"), override];
  for (const registry of homes) {
    assert(!existsSync(registry) || readdirSync(registry).length === 0, `Preexisting legacy state: ${registry}`);
    const env = { ...safeEnv, HOME: home, SILO_PORT_REGISTRY_DIR: registry };
    const result = await command(old, [process.execPath, path.resolve(values.legacy09), "env", name(old)], env); assert.equal(result.code, 0, result.stdout + result.stderr);
    const before = [snapshot(old), snapshot(peer), snapshot(home), snapshot(registry), existsSync(store) ? digest(store) : "absent"];
    for (const p of [old, peer]) for (const command of ["env", "up", "ci", "down", "status"]) {
      const refused = await silo(p, [command], "LEGACY_STATE", { ...safeEnv, HOME: home, ...(registry === override ? { SILO_PORT_REGISTRY_DIR: override } : {}) });
      assert.equal(refused.changed, false); assert(refused.found?.some(f => path.dirname(f.path) === registry));
    }
    assert.deepEqual([snapshot(old), snapshot(peer), snapshot(home), snapshot(registry), existsSync(store) ? digest(store) : "absent"], before);
    const stopped = await command(old, [process.execPath, path.resolve(values.legacy09), "down", "--clean"], env); assert.equal(stopped.code, 0, stopped.stdout + stopped.stderr);
    assert.equal(readdirSync(registry).filter(f => f.endsWith(".json")).length, 0);
    log({ scenario: "legacy lock-only refuses all five commands in old and unrelated roots without writes", registry, pass: true });
  }
  writeFileSync(path.join(old, ".silo.lock"), "{malformed pre-registry lock");
  const beforeLock = snapshot(old); await silo(old, ["env"], "LEGACY_STATE"); assert.equal(snapshot(old), beforeLock); rmSync(path.join(old, ".silo.lock"));
  // Test-only preload pauses the genuine old artifact immediately before registration.
  const preload = path.join(root, "pause-old.ts"), reached = path.join(root, "old-paused"), release = path.join(root, "old-release");
  writeFileSync(preload, `import {promises as fs,writeFileSync,existsSync} from 'node:fs'; const write=fs.writeFile.bind(fs); fs.writeFile=async function(file,...args){if(String(file).endsWith('.tmp')&&String(file).includes(${JSON.stringify(override)})){writeFileSync(${JSON.stringify(reached)},'paused');while(!existsSync(${JSON.stringify(release)}))await Bun.sleep(25);}return write(file,...args)};`);
  const paused = Bun.spawn([process.execPath, "--preload", preload, path.resolve(values.legacy09), "env", name(old)], { cwd: old, env: { ...safeEnv, HOME: home, SILO_PORT_REGISTRY_DIR: override }, detached: true, stdout: Bun.file(path.join(root, "paused-old.log")), stderr: Bun.file(path.join(root, "paused-old.log")) });
  processes.add(paused); recordResource(`paused old env pid/pgid ${paused.pid}; release ${release}, await exit then own old down\n`);
  await until("old artifact paused before registry publication", async () => existsSync(reached));
  assert(!readdirSync(override).some(f => f.endsWith(".json")));
  // The approved precondition waits for this operation; it never races a clean scan.
  writeFileSync(release, "drain"); assert.equal(await paused.exited, 0); processes.delete(paused);
  await silo(peer, ["env"], "LEGACY_STATE", { ...safeEnv, SILO_PORT_REGISTRY_DIR: override });
  const oldDown = await command(old, [process.execPath, path.resolve(values.legacy09), "down", "--clean"], { ...safeEnv, HOME: home, SILO_PORT_REGISTRY_DIR: override }); assert.equal(oldDown.code, 0);
  await silo(peer, ["env", name(peer)]);
  const peerClaim = await state(peer);
  // Unsupported post-cutover behavior is observed as a limit, never an isolation pass.
  for (const artifact of [values.legacy09, values.legacy05]) {
    const late = project(`late-${artifact === values.legacy09 ? "09" : "05"}`);
    if (artifact === values.legacy05) writeFileSync(path.join(late, "silo.toml"), 'version=1\n[ports]\nAPP_PORT=48127\nTILT_PORT=48128\n');
    const storeBefore = digest(store);
    const result = await command(late, [process.execPath, path.resolve(artifact), "env", name(late)], { ...safeEnv, HOME: home, SILO_PORT_REGISTRY_DIR: override });
    assert.equal(result.code, 0, result.stdout + result.stderr); assert.equal(digest(store), storeBefore);
    const oldPorts = z.object({ instance: z.object({ ports: z.record(z.number()) }) }).parse(JSON.parse(readFileSync(path.join(late, ".silo.lock"), "utf8"))).instance.ports;
    log({ scenario: "unsupported old client after cutover", artifact, digest: digest(artifact), code: result.code, oldPorts, newClaimPorts: peerClaim.allocation?.state.ports, storeUnchanged: true });
    if (readdirSync(override).some(f => f.endsWith(".json"))) await silo(peer, ["status"], "LEGACY_STATE", { ...safeEnv, SILO_PORT_REGISTRY_DIR: override });
    const down = await command(late, [process.execPath, path.resolve(artifact), "down", "--clean"], { ...safeEnv, HOME: home, SILO_PORT_REGISTRY_DIR: override }); assert.equal(down.code, 0, down.stdout + down.stderr);
    assert.deepEqual((await state(peer)).claims, peerClaim.claims);
  }
  await silo(peer, ["down", "--clean"]);
  const brokenDown = project("old-failed-teardown");
  const oldEnv = { ...safeEnv, HOME: home, SILO_PORT_REGISTRY_DIR: override };
  assert.equal((await command(brokenDown, [process.execPath, path.resolve(values.legacy09), "env", name(brokenDown)], oldEnv)).code, 0);
  writeFileSync(path.join(brokenDown, "Tiltfile"), "fail('intentional fixture teardown failure')\n");
  const ignored = await command(brokenDown, [process.execPath, path.resolve(values.legacy09), "down", "--clean"], oldEnv);
  assert.equal(ignored.code, 0); assert(!existsSync(path.join(brokenDown, ".silo.lock")));
  log({ scenario: "0.9.0 red control: failed Tilt teardown still reports success and removes snapshots", observed: true });
  log({ scenario: "paused old operation drained before cutover; reverse lock-only reservation refused until owner down", pass: true });
}
async function docker(argv: string[]) { const r = await command(root, ["docker", ...argv]); assert.equal(r.code, 0, r.stderr); return r.stdout.trim(); }
async function fixtureSnapshot(kind: string, id: string) {
  return FixtureSnapshotSchema.parse(JSON.parse(await docker([kind, "inspect", id]))).map(row => row.Mounts === undefined ? row : {
    ...row, Mounts: [...row.Mounts].sort((a, b) => a.Destination < b.Destination ? -1 : a.Destination > b.Destination ? 1 : 0),
  });
}
async function backend() {
  const p = project("backend");
  const cfg = readFileSync(path.join(p, "silo.toml"), "utf8");
  const clusterConfig = cfg.replace("TILT_PORT=48128", "TILT_PORT=48128\nK3D_REGISTRY_PORT=48130\nHTTP_PORT=48131") + '\n[k3d]\nenabled=true\nkubeconfigPath=".localnet/kubeconfig"\nargs=["--port=${HTTP_PORT}:80@loadbalancer"]\n[k3d.registry]\nenabled=true\n';
  writeFileSync(path.join(p, "silo.toml"), clusterConfig);
  const allocated = await silo(p, ["env", name(p)]); const initial = allocated.project; assert(initial?.allocation);
  const cluster = initial.allocation.state.identity.k3dClusterName!;
  await silo(p, ["down", "--clean"]);
  for (const [kind, objectName] of [["network", `k3d-${cluster}`], ["volume", `k3d-${cluster}-images`]] as const) {
    const id = await docker([kind, "create", "--label", `io.silo.rehearsal=${path.basename(root)}`, objectName]);
    const created = await fixtureSnapshot(kind, id); cleanupObjects.push({ kind, id, name: objectName, created });
    recordResource(`${kind} ${id} name=${objectName}; teardown docker ${kind} rm ${id} after exact inspect identity comparison\n`);
    await silo(p, ["env", name(p)], "NAME_CONFLICT"); assert.deepEqual(await fixtureSnapshot(kind, id), created);
    await docker([kind, "rm", id]); cleanupObjects.pop();
  }
  for (const file of [".localnet.env", ".localnet/kubeconfig"]) {
    mkdirSync(path.dirname(path.join(p, file)), { recursive: true }); writeFileSync(path.join(p, file), "foreign fixture sentinel\n");
    await silo(p, ["env", name(p)], "PATH_CONFLICT"); assert.equal(readFileSync(path.join(p, file), "utf8"), "foreign fixture sentinel\n"); rmSync(path.join(p, file));
  }
  await silo(p, ["env", name(p)]); await silo(p, ["ci", "--timeout=120s"]);
  const made = await state(p); assert(made.resources.some(r => r.name === `${cluster}-registry.localhost`));
  assert(made.resources.some(r => r.kind === "volume"));
  assert(made.resources.some(r => r.kind === "container" && r.anonymousVolumes.length > 0));
  const images = new Map<string, string>();
  const attachedVolumes = new Set<string>();
  for (const receipt of made.resources.filter(r => r.kind === "container")) {
    images.set(receipt.name, await docker(["container", "inspect", receipt.id, "--format", "{{.Config.Image}}"]));
    const mounts = z.array(z.object({ Type: z.string(), Name: z.string().optional() })).parse(JSON.parse(await docker(["container", "inspect", receipt.id, "--format", "{{json .Mounts}}"] )));
    for (const mount of mounts) if (mount.Type === "volume" && mount.Name) attachedVolumes.add(mount.Name);
  }
  log({ scenario: "owned container volume handles before deletion", names: [...attachedVolumes] });
  log({ scenario: "real k3d cluster/registry/network/volume and kubeconfig receipts", resources: made.resources, pass: true });
  await silo(p, ["down", "--clean"], "CLEANUP_REQUIRED"); assert(existsSync(path.join(p, ".silo.lock")));
  await silo(p, ["down", "--delete-cluster"]);
  const retainedCache = await state(p);
  await silo(p, ["down", "--clean"], "CLEANUP_REQUIRED");
  assert.deepEqual((await state(p)).claims, retainedCache.claims);
  for (const cache of made.resources.filter(r => r.kind === "volume")) {
    const current = z.array(z.object({ Name: z.string(), CreatedAt: z.string() })).length(1).parse(JSON.parse(await docker(["volume", "inspect", cache.name])))[0]!;
    assert.equal(current.Name, cache.name); assert.equal(current.CreatedAt, cache.createdAt);
    recordResource(`named k3d cache ${cache.name} retained by Silo; author fixture-only teardown exact recorded creation identity then docker volume rm\n`);
    await docker(["volume", "rm", cache.name]);
  }
  await silo(p, ["down"]);
  const stopped = await state(p);
  const kubeconfig = stopped.allocation!.state.identity.kubeconfigPath!;
  const kubeconfigClaim = stopped.files.find(f => f.role === "kubeconfig")!.target.key;
  assert(stopped.claims.some(c => c.domain === "file-target" && c.resource === kubeconfigClaim));
  const kubeconfigBefore = readFileSync(kubeconfig);
  const disabledConfig = cfg.replace("[profiles.alternative.ports]", "[k3d]\nenabled=false\n[profiles.alternative.ports]");
  writeFileSync(path.join(p, "silo.toml"), disabledConfig);
  await silo(p, ["env", name(p), "--force"], "CLEANUP_REQUIRED");
  const refused = await state(p);
  assert.equal(refused.generation, stopped.generation);
  assert.deepEqual(refused.claims, stopped.claims);
  assert.deepEqual(readFileSync(kubeconfig), kubeconfigBefore);
  await silo(p, ["down", "--clean"]);
  assert(!existsSync(kubeconfig));
  assert.equal((await silo(p, ["status"])).project?.allocation, null);
  await silo(p, ["env", name(p), "--force"]);
  const disabled = await state(p);
  assert.equal(disabled.allocation!.state.identity.kubeconfigPath, undefined);
  assert(!disabled.claims.some(c => c.domain === "file-target" && c.resource === kubeconfigClaim));
  await silo(p, ["down", "--clean"]);
  const final = (await silo(p, ["status"])).project;
  assert.equal(final?.allocation, null); assert.deepEqual(final?.claims, []);
  log({ scenario: "k3d enabled-to-disabled refuses role removal until recorded kubeconfig cleanup", kubeconfig, snapshotSha256: createHash("sha256").update(kubeconfigBefore).digest("hex"), generation: stopped.generation, refusedGeneration: refused.generation, finalClaims: final?.claims, pass: true });
  writeFileSync(path.join(p, "silo.toml"), clusterConfig);
  for (const receipt of made.resources) {
    const result = await command(root, ["docker", receipt.kind, "inspect", receipt.kind === "volume" ? receipt.name : receipt.id]); assert.notEqual(result.code, 0);
  }
  for (const volume of attachedVolumes) assert.notEqual((await command(root, ["docker", "volume", "inspect", volume])).code, 0);
  for (const [objectName, role] of [[`k3d-${cluster}-server-0`, "server"], [`${cluster}-registry.localhost`, "registry"]]) {
    const image = images.get(objectName!); assert(image);
    const id = await docker(["container", "create", "--name", objectName!, "--label", `io.silo.rehearsal=${path.basename(root)}`, "--label", "app=k3d", "--label", `k3d.cluster=${cluster}`, "--label", `k3d.role=${role}`, image]);
    const created = await fixtureSnapshot("container", id); cleanupObjects.push({ kind: "container", id, name: objectName!, created });
    recordResource(`synthetic stopped k3d ${role} container ${id} name=${objectName}; teardown docker container rm ${id} after exact inspect comparison\n`);
    await silo(p, ["env", name(p)], "NAME_CONFLICT"); assert.deepEqual(await fixtureSnapshot("container", id), created);
    await docker(["container", "rm", "--volumes", id]); cleanupObjects.pop();
  }
  writeFileSync(path.join(p, ".silo.lock"), JSON.stringify({ version: 2, projectId: "unreceipted-fixture", generation: 1 }));
  await silo(p, ["env", name(p)], "PATH_CONFLICT"); assert.equal(JSON.parse(readFileSync(path.join(p, ".silo.lock"), "utf8")).projectId, "unreceipted-fixture"); rmSync(path.join(p, ".silo.lock"));
  const scoped = await silo(p, ["env", name(p)]); assert(scoped.project);
  const image = images.get(`k3d-${cluster}-server-0`); assert(image);
  const outside = `unclaimed-${path.basename(root).toLowerCase()}`;
  const outsideId = await docker(["container", "create", "--name", outside, "--label", `io.silo.project=${scoped.project.projectId}`, "--label", `io.silo.generation=${scoped.project.generation}`, image]);
  const outsideCreated = await fixtureSnapshot("container", outsideId); cleanupObjects.push({ kind: "container", id: outsideId, name: outside, created: outsideCreated });
  recordResource(`outside-claim synthetic container ${outsideId}; teardown exact ID after inspection\n`);
  await silo(p, ["down", "--clean"], "NAME_CONFLICT"); assert.deepEqual(await fixtureSnapshot("container", outsideId), outsideCreated);
  assert.deepEqual((await state(p)).claims, scoped.project.claims);
  await docker(["container", "rm", "--volumes", outsideId]); cleanupObjects.pop(); await silo(p, ["down", "--clean"]);
  await silo(p, ["env", name(p)], "ENGINE_UNAVAILABLE", { ...safeEnv, DOCKER_HOST: `unix://${root}/absent-docker.sock` });
  log({ scenario: "leftovers refused unchanged, retention holds claims, explicit exact deletion, unreachable engine refuses", pass: true });
}

function composeProject(label: string, mounts = "") {
  const p = project(label);
  writeFileSync(path.join(p, "Tiltfile"), "docker_compose('compose.yaml', project_name=os.getenv('COMPOSE_PROJECT_NAME'))\n");
  writeFileSync(path.join(p, "compose.yaml"), `services:
  redis:
    image: redis:7-alpine
${mounts}    labels:
      io.silo.project: "\u0024{SILO_PROJECT_ID}"
      io.silo.generation: "\u0024{SILO_GENERATION}"
networks:
  default:
    labels:
      io.silo.project: "\u0024{SILO_PROJECT_ID}"
      io.silo.generation: "\u0024{SILO_GENERATION}"
`);
  return p;
}
const MountsSchema = z.array(z.object({ Type: z.string(), Name: z.string().optional(), Destination: z.string() }));
async function redisMount(p: string) {
  const made = await state(p);
  const redis = made.resources.find(r => r.kind === "container" && r.source === "compose"); assert(redis?.kind === "container");
  const mounts = MountsSchema.parse(JSON.parse(await docker(["container", "inspect", redis.id, "--format", "{{json .Mounts}}"] )));
  const data = mounts.find(m => m.Type === "volume" && m.Destination === "/data"); assert(data?.Name);
  return { made, redis, mounts, data: { ...data, Name: data.Name } };
}
async function anonymousVolumes() {
  const p = composeProject("anonymous-volumes");
  await silo(p, ["ci", name(p), "--timeout", "60s"]);
  const { redis, mounts, data } = await redisMount(p);
  const created = await fixtureSnapshot("volume", data.Name);
  cleanupObjects.push({ kind: "volume", id: data.Name, name: data.Name, created });
  recordResource(`volume ${data.Name} from container ${redis.id}; teardown public down --clean or exact snapshot-verified docker volume rm\n`);
  log({ scenario: "image-declared anonymous mount before teardown", parent: redis, mounts, volume: created });
  await silo(p, ["down", "--clean"]);
  const volumes = (await docker(["volume", "ls", "--format", "{{.Name}}"])).split("\n");
  assert(!volumes.includes(data.Name), "clean leaked the Redis image-declared anonymous /data volume");
  cleanupObjects.pop();
  assert.equal((await silo(p, ["status"])).project?.generation, 0);
  assert.equal((await silo(p, ["down", "--clean"])).changed, false);
  log({ scenario: "public clean removes the exact image-declared anonymous volume", parentId: redis.id, volume: data.Name, pass: true });

  const donorId = await docker(["container", "create", "redis:7-alpine"]);
  recordResource(`donor container ${donorId}; teardown snapshot-verified docker container rm --volumes ${donorId}\n`);
  const donor = await fixtureSnapshot("container", donorId);
  cleanupObjects.push({ kind: "container", id: donorId, name: donorId, created: donor });
  const donorMounts = MountsSchema.parse(JSON.parse(await docker(["container", "inspect", donorId, "--format", "{{json .Mounts}}"] )));
  const borrowed = donorMounts.find(m => m.Type === "volume" && m.Destination === "/data"); assert(borrowed?.Name);
  const named = await docker(["volume", "create", `silo-sentinel-${path.basename(root).toLowerCase()}`]);
  recordResource(`named sentinel volume ${named}; teardown snapshot-verified docker volume rm ${named}\n`);
  const namedBefore = await fixtureSnapshot("volume", named);
  cleanupObjects.push({ kind: "volume", id: named, name: named, created: namedBefore });
  const borrowedBefore = await fixtureSnapshot("volume", borrowed.Name);
  const retry = composeProject("anonymous-retry", `    volumes:\n      - type: volume\n        source: borrowed\n        target: /borrowed\n      - type: volume\n        source: sentinel\n        target: /named\n`);
  appendFileSync(path.join(retry, "compose.yaml"), `volumes:\n  borrowed:\n    external: true\n    name: ${borrowed.Name}\n  sentinel:\n    external: true\n    name: ${named}\n`);
  await silo(retry, ["ci", name(retry), "--timeout", "60s"]);
  const owned = await redisMount(retry);
  const ownedVolumeBefore = await fixtureSnapshot("volume", owned.data.Name);
  assert.deepEqual(owned.redis.anonymousVolumes.map(v => v.name), [owned.data.Name], "supplied volumes grant no deletion authority");
  const userId = await docker(["container", "create", "--volume", `${owned.data.Name}:/borrowed`, "redis:7-alpine"]);
  recordResource(`borrower container ${userId}; teardown snapshot-verified docker container rm --volumes ${userId}\n`);
  const userCreated = await fixtureSnapshot("container", userId);
  cleanupObjects.push({ kind: "container", id: userId, name: userId, created: userCreated });
  await silo(retry, ["down"]);
  assert.deepEqual(await fixtureSnapshot("volume", borrowed.Name), borrowedBefore);
  assert.deepEqual(await fixtureSnapshot("volume", named), namedBefore);
  const stopped = await state(retry);
  assert(stopped.resources.some(r => r.kind === "container" && r.id === owned.redis.id && r.anonymousVolumes.some(v => v.name === owned.data.Name)));
  await silo(retry, ["env", "--force", "--profile", "alternative"], "CLEANUP_REQUIRED");
  assert.deepEqual((await state(retry)).claims, stopped.claims);
  await silo(retry, ["down", "--clean"], "CLEANUP_REQUIRED");
  assert.deepEqual((await state(retry)).claims, stopped.claims);
  assert.deepEqual(await fixtureSnapshot("container", userId), userCreated);
  assert((await docker(["volume", "ls", "--format", "{{.Name}}"])).split("\n").includes(owned.data.Name));
  await docker(["container", "rm", "--volumes", userId]); cleanupObjects.pop();
  // The borrower's explicit source is named from Docker's perspective. Once
  // the original parent is gone, Silo has audit data but no deletion authority.
  await silo(retry, ["down", "--clean"], "CLEANUP_REQUIRED");
  assert.deepEqual((await state(retry)).claims, stopped.claims);
  const leaked = await fixtureSnapshot("volume", owned.data.Name);
  assert.deepEqual(leaked, ownedVolumeBefore);
  recordResource(`leaked fixture volume ${owned.data.Name}; author teardown exact snapshot-verified docker volume rm; never product cleanup\n`);
  await docker(["volume", "rm", owned.data.Name]);
  await silo(retry, ["down", "--clean"]);
  assert(!(await docker(["volume", "ls", "--format", "{{.Name}}"])).split("\n").includes(owned.data.Name));
  assert.equal((await silo(retry, ["status"])).project?.generation, 0);
  assert.deepEqual(await fixtureSnapshot("volume", borrowed.Name), borrowedBefore);
  assert.deepEqual(await fixtureSnapshot("volume", named), namedBefore);
  assert.deepEqual(await fixtureSnapshot("container", donorId), donor);
  log({ scenario: "shared anonymous mount is leaked, reported and never deleted by name; clean/force retain claims until the fixture owner resolves it; explicit named and borrowed mounts survive", parent: owned.redis, borrowed: borrowed.Name, named, pass: true });

  const identity = composeProject("anonymous-identity");
  await silo(identity, ["ci", name(identity), "--timeout", "60s"]);
  const original = await redisMount(identity);
  // Remove the parent externally without its mounts: this models a crash/tool
  // teardown that has destroyed Silo's only safe volume-deletion handle.
  await docker(["container", "rm", "--force", original.redis.id]);
  const beforeReplacement = await state(identity);
  const originalVolume = original.redis.anonymousVolumes.find(v => v.name === original.data.Name); assert(originalVolume);
  await docker(["volume", "rm", originalVolume.name]);
  await until("Docker volume creation-time resolution", async () => Date.now() >= Date.parse(originalVolume.createdAt) + 1000);
  await docker(["volume", "create", "--label", "com.docker.volume.anonymous=", originalVolume.name]);
  const replacement = await fixtureSnapshot("volume", originalVolume.name);
  recordResource(`replacement fixture volume ${originalVolume.name}; teardown snapshot-verified docker volume rm ${originalVolume.name}\n`);
  cleanupObjects.push({ kind: "volume", id: originalVolume.name, name: originalVolume.name, created: replacement });
  await silo(identity, ["down", "--clean"], "CLEANUP_REQUIRED");
  assert.deepEqual((await state(identity)).claims, beforeReplacement.claims);
  assert.deepEqual(await fixtureSnapshot("volume", originalVolume.name), replacement);
  await docker(["volume", "rm", originalVolume.name]); cleanupObjects.pop();
  await silo(identity, ["down", "--clean"]);
  assert.equal((await silo(identity, ["status"])).project?.generation, 0);
  log({ scenario: "replacement anonymous name is reported as a leak without deletion or claim release; owner-resolved absence allows retirement", original: originalVolume, replacement, pass: true });
}

async function seededAnonymousParent(label: string, timestampCollision = false) {
  const p = project(label);
  const allocated = await silo(p, ["env", name(p)]); assert(allocated.project?.allocation);
  const projectId = allocated.project.projectId;
  const generation = allocated.project.generation;
  const containerName = `${allocated.project.allocation.state.identity.composeName}-audit`;
  const owner = await ProjectOperation.open(p);
  try {
    recordResource(`container intent ${containerName}; teardown exact returned ID with --volumes\n`);
    const id = await docker(["container", "create", "--name", containerName, "--label", `io.silo.project=${projectId}`, "--label", `io.silo.generation=${generation}`, "redis:7-alpine"]);
    recordResource(`container ${id}; teardown exact recorded ID with --volumes\n`);
    const created = z.array(z.object({ Id: z.string(), Name: z.string(), Created: z.string(), Config: z.object({ Labels: z.record(z.string()) }), Mounts: MountsSchema })).length(1).parse(JSON.parse(await docker(["container", "inspect", id])))[0]!;
    const mount = created.Mounts.find(m => m.Type === "volume" && m.Destination === "/data"); assert(mount?.Name);
    const data = z.array(z.object({ Name: z.string(), CreatedAt: z.string() })).length(1).parse(JSON.parse(await docker(["volume", "inspect", mount.Name])))[0]!;
    const originalVolume = { name: data.Name, createdAt: data.CreatedAt, destination: "/data" };
    let volume = originalVolume;
    recordResource(`anonymous volume ${volume.name} under ${id}; fixture-only teardown exact inspect then docker volume rm, if parent no longer exists\n`);
    await docker(["container", "rm", id]);
    let replacement: Awaited<ReturnType<typeof fixtureSnapshot>> | undefined;
    if (timestampCollision) {
      await docker(["volume", "rm", volume.name]);
      await docker(["volume", "create", "--label", "com.docker.volume.anonymous=", volume.name]);
      replacement = await fixtureSnapshot("volume", volume.name);
      const collision = z.array(z.object({ CreatedAt: z.string() })).length(1).parse(replacement)[0]!;
      volume = { ...originalVolume, createdAt: collision.CreatedAt };
    }
    // Construct a timestamp collision at the historical receipt boundary while
    // retaining the genuine original parent identity and real replacement.
    // The two actual volume creation times need not fall in one physical second.
    const parent = BackendReceiptSchema.parse({ kind: "container", source: "compose", name: created.Name.replace(/^\//, ""), id: created.Id, createdAt: created.Created, labels: created.Config.Labels, anonymousVolumes: [volume] });
    assert(parent.kind === "container");
    owner.recordResources([parent]);
    const made = ProjectOperation.inspect(p); assert(made?.allocation);
    return { p, parent, volume, originalVolume, made, replacement };
  } finally { owner.finish(); }
}

async function sameSecondReplacement() {
  const { p, volume, originalVolume, made, replacement } = await seededAnonymousParent("same-second-replacement", true);
  assert(replacement);
  cleanupObjects.push({ kind: "volume", id: volume.name, name: volume.name, created: replacement });
  const created = z.array(z.object({ CreatedAt: z.string() })).length(1).parse(replacement)[0]!;
  assert.equal(created.CreatedAt, volume.createdAt, "The historical audit timestamp must collide with the replacement timestamp");
  try {
    await silo(p, ["down", "--clean"], "CLEANUP_REQUIRED");
    assert.deepEqual(await fixtureSnapshot("volume", volume.name), replacement);
    assert.deepEqual((await state(p)).claims, made.claims);
    await silo(p, ["env", "--force", "--profile", "alternative"], "ALREADY_RUNNING");
    assert.deepEqual((await state(p)).claims, made.claims);
    log({ scenario: "same-second replacement is preserved; clean and forced replacement keep claims", original: originalVolume, historicalAudit: volume, replacement, pass: true });
  } finally {
    const remaining = (await docker(["volume", "ls", "--format", "{{.Name}}"])).split("\n");
    if (remaining.includes(volume.name)) {
      assert.deepEqual(await fixtureSnapshot("volume", volume.name), replacement);
      await docker(["volume", "rm", volume.name]);
    }
    cleanupObjects.pop();
  }
}

async function pausedReplacement() {
  const { p, volume, made } = await seededAnonymousParent("paused-replacement");
  const bin = path.join(p, "bin"); mkdirSync(bin);
  const paused = path.join(p, "paused"), release = path.join(p, "release");
  const realDocker = Bun.which("docker"); assert(realDocker);
  writeFileSync(path.join(bin, "docker"), `#!/bin/sh\nset -eu\nif [ "\u0024{1-}" = volume ] && [ "\u0024{2-}" = rm ] && [ "\u0024{3-}" = "\u0024VOLUME_PROBE_TARGET" ]; then\n  printf paused > "\u0024VOLUME_PROBE_PAUSED"\n  count=0\n  while [ ! -f "\u0024VOLUME_PROBE_RELEASE" ]; do\n    count=\u0024((count + 1))\n    [ "\u0024count" -lt 1500 ] || exit 78\n    sleep 0.02\n  done\nfi\nexec "\u0024VOLUME_PROBE_DOCKER" "\u0024@"\n`);
  chmodSync(path.join(bin, "docker"), 0o755);
  const pending = command(p, [process.execPath, cli, "down", "--clean", "--json"], {
    ...safeEnv, PATH: `${bin}:${safeEnv.PATH}`, VOLUME_PROBE_TARGET: volume.name,
    VOLUME_PROBE_PAUSED: paused, VOLUME_PROBE_RELEASE: release, VOLUME_PROBE_DOCKER: realDocker,
  });
  let finished = false;
  const completed = pending.then(result => { finished = true; return result; });
  await until("paused unsafe delete or completed safe cleanup", async () => existsSync(paused) || finished);
  await docker(["volume", "rm", volume.name]);
  await docker(["volume", "create", "--label", "com.docker.volume.anonymous=", volume.name]);
  const replacement = await fixtureSnapshot("volume", volume.name);
  cleanupObjects.push({ kind: "volume", id: volume.name, name: volume.name, created: replacement });
  writeFileSync(release, "release\n");
  try {
    const result = await completed;
    assert.notEqual(result.code, 0, "A leaked/replaced name must not be deleted and retired");
    assert.equal(ResultSchema.parse(JSON.parse(result.stdout)).code, "CLEANUP_REQUIRED");
    await silo(p, ["down", "--clean"], "CLEANUP_REQUIRED");
    assert.deepEqual(await fixtureSnapshot("volume", volume.name), replacement);
    assert.deepEqual((await state(p)).claims, made.claims);
    log({ scenario: "replacement at the unsafe deletion boundary is preserved; no name-delete authority exists", unsafeDeleteReached: existsSync(paused), original: volume, replacement, pass: true });
  } finally {
    if ((await docker(["volume", "ls", "--format", "{{.Name}}"])).split("\n").includes(volume.name)) {
      assert.deepEqual(await fixtureSnapshot("volume", volume.name), replacement);
      await docker(["volume", "rm", volume.name]);
    }
    cleanupObjects.pop();
  }
}

async function parentVolumes() {
  const p = composeProject("parent-volume-cleanup");
  await silo(p, ["ci", name(p), "--timeout", "60s"]);
  const { redis, data } = await redisMount(p);
  const tiltfile = path.join(p, "Tiltfile"); const source = readFileSync(tiltfile, "utf8");
  writeFileSync(tiltfile, "fail('intentional teardown failure after exact parent removal')\n");
  try {
    await silo(p, ["down", "--clean"]);
    assert.notEqual((await command(root, ["docker", "container", "inspect", redis.id])).code, 0, "The recorded parent must be removed without evaluating Tiltfile");
    assert(!(await docker(["volume", "ls", "--format", "{{.Name}}"])).split("\n").includes(data.Name), "Anonymous data must be removed with its recorded parent without evaluating the Tiltfile");
    log({ scenario: "exact parent removal removes its anonymous volume without delegated Tilt teardown", parent: redis, data, pass: true });
  } finally { writeFileSync(tiltfile, source); }
}

async function inheritedVolumes() {
  const p = project("inherited-volumes", '[hooks]\npost-up=["sh create-inherited.sh"]\n');
  const allocated = await silo(p, ["env", name(p)]); assert(allocated.project?.allocation);
  const named = `silo-inherited-${path.basename(root).toLowerCase()}`;
  recordResource(`named volume intent ${named}; teardown exact snapshot-verified author docker volume rm\n`);
  await docker(["volume", "create", named]);
  const namedBefore = await fixtureSnapshot("volume", named);
  cleanupObjects.push({ kind: "volume", id: named, name: named, created: namedBefore });
  const donor = await docker(["container", "create", "--volume", `${named}:/named`, "redis:7-alpine"]);
  recordResource(`inherited donor container ${donor}; teardown exact recorded ID with --volumes\n`);
  const donorBefore = await fixtureSnapshot("container", donor);
  cleanupObjects.push({ kind: "container", id: donor, name: donor, created: donorBefore });
  const mounts = MountsSchema.parse(JSON.parse(await docker(["container", "inspect", donor, "--format", "{{json .Mounts}}"] )));
  const anonymous = mounts.find(m => m.Destination === "/data"); assert(anonymous?.Name);
  recordResource(`inherited anonymous volume ${anonymous.Name} from donor ${donor}; cleanup only with last exact recorded fixture parent\n`);
  const anonymousBefore = await fixtureSnapshot("volume", anonymous.Name);
  const borrowerName = `${allocated.project.allocation.state.identity.containerPrefix}inherited`;
  recordResource(`inherited borrower intent ${borrowerName}; teardown exact returned ID with --volumes only while donor exists\n`);
  writeFileSync(path.join(p, "create-inherited.sh"), `#!/bin/sh\nset -eu\ndocker container create --name "\u0024{CONTAINER_PREFIX}inherited" --label "io.silo.project=\u0024SILO_PROJECT_ID" --label "io.silo.generation=\u0024SILO_GENERATION" --volumes-from ${donor} redis:7-alpine > borrower.id\n`);
  await silo(p, ["ci", "--timeout", "60s"], "CLEANUP_REQUIRED");
  const borrower = readFileSync(path.join(p, "borrower.id"), "utf8").trim();
  recordResource(`inherited borrower ${borrower}; teardown exact recorded ID with --volumes while donor exists\n`);
  const borrowerBefore = await fixtureSnapshot("container", borrower);
  cleanupObjects.push({ kind: "container", id: borrower, name: borrowerName, created: borrowerBefore });
  const before = await state(p);
  await silo(p, ["down", "--clean"], "CLEANUP_REQUIRED");
  assert.deepEqual((await state(p)).claims, before.claims);
  assert.deepEqual(await fixtureSnapshot("container", borrower), borrowerBefore);
  assert.deepEqual(await fixtureSnapshot("container", donor), donorBefore);
  assert.deepEqual(await fixtureSnapshot("volume", anonymous.Name), anonymousBefore);
  assert.deepEqual(await fixtureSnapshot("volume", named), namedBefore);
  await docker(["container", "rm", "--volumes", borrower]); cleanupObjects.pop();
  assert.deepEqual(await fixtureSnapshot("volume", anonymous.Name), anonymousBefore, "The live donor reference must protect its anonymous volume");

  const lastUser = await docker(["container", "create", "--volumes-from", donor, "redis:7-alpine"]);
  recordResource(`last inherited user ${lastUser}; teardown exact recorded ID with --volumes; this fixture owns donor and both volumes\n`);
  const lastBefore = await fixtureSnapshot("container", lastUser);
  cleanupObjects.push({ kind: "container", id: lastUser, name: lastUser, created: lastBefore });
  assert.deepEqual(await fixtureSnapshot("container", donor), donorBefore);
  await docker(["container", "rm", donor]);
  cleanupObjects.splice(cleanupObjects.findIndex(o => o.kind === "container" && o.id === donor), 1);
  assert.deepEqual(await fixtureSnapshot("volume", anonymous.Name), anonymousBefore);
  await docker(["container", "rm", "--volumes", lastUser]); cleanupObjects.pop();
  assert(!(await docker(["volume", "ls", "--format", "{{.Name}}"])).split("\n").includes(anonymous.Name), "Docker removes an inherited anonymous volume when its last user is removed with --volumes");
  assert.deepEqual(await fixtureSnapshot("volume", named), namedBefore, "An inherited named volume must remain");
  await silo(p, ["down", "--clean"]);
  log({ scenario: "inherited provenance refuses without deletion; Docker preserves shared live references and named data, but removes last-user inherited anonymous data", donor, borrower, lastUser, anonymous: anonymous.Name, named, pass: true });
}

async function retryCrash(mode: "retry-crash" | "external-absence" | "lost-completion" = "retry-crash") {
  const p = project(mode, '[k3d]\nenabled=true\nkubeconfigPath=".localnet/kubeconfig"\n');
  const allocated = await silo(p, ["env", name(p)]); assert(allocated.project?.allocation);
  const projectId = allocated.project.projectId, generation = allocated.project.generation;
  const networkName = `k3d-${allocated.project.allocation.state.identity.k3dClusterName}`;
  recordResource(`network intent ${networkName}; teardown exact receipted ID after endpoint removal\n`);
  const id = await docker(["network", "create", "--label", `io.silo.project=${projectId}`, "--label", `io.silo.generation=${generation}`, networkName]);
  const created = z.array(z.object({ Id: z.string(), Name: z.string(), Created: z.string(), Labels: z.record(z.string()) })).length(1).parse(JSON.parse(await docker(["network", "inspect", id])))[0]!;
  recordResource(`network ${id} name=${networkName}; teardown exact recorded docker network rm ID\n`);
  const owner = await ProjectOperation.open(p);
  try { owner.recordResources([BackendReceiptSchema.parse({ kind: "network", source: "k3d", id, name: created.Name, createdAt: created.Created, labels: created.Labels })]); }
  finally { owner.finish(); }
  const blocker = await docker(["container", "create", "--network", networkName, "redis:7-alpine"]);
  recordResource(`network blocker ${blocker}; teardown exact returned container ID with --force --volumes\n`);
  await docker(["container", "start", blocker]);
  const blockerBefore = await fixtureSnapshot("container", blocker);
  cleanupObjects.push({ kind: "container", id: blocker, name: blocker, created: blockerBefore });
  await silo(p, ["down", "--delete-cluster", "--clean"], "COMMAND_FAILED");
  const failed = await state(p);
  const first = failed.launches.find(l => l.kind === "owned-network-delete" && l.phase === "exited" && l.exitCode !== 0); assert(first);
  assert.deepEqual(await fixtureSnapshot("container", blocker), blockerBefore);
  await docker(["container", "rm", "--force", "--volumes", blocker]); cleanupObjects.pop();

  if (mode === "external-absence") {
    assert(first.deletionTarget?.id === id);
    await docker(["network", "rm", id]);
    await silo(p, ["down", "--delete-cluster", "--clean"]);
    const recovered = (await silo(p, ["status"])).project;
    assert.equal(recovered?.generation, 0); assert.deepEqual(recovered?.claims, []);
    log({ scenario: "failed exact-ID deletion reconciles after externally proven target absence", network: id, failedLaunch: first.id, pass: true });
    return;
  }

  const bin = path.join(p, "bin"); mkdirSync(bin);
  const paused = path.join(p, "paused"), release = path.join(p, "release");
  const realDocker = Bun.which("docker"); assert(realDocker);
  writeFileSync(path.join(bin, "docker"), `#!/bin/sh\nset -eu\nif [ "\u0024{1-}" = network ] && [ "\u0024{2-}" = rm ] && [ "\u0024{3-}" = "\u0024RETRY_PROBE_TARGET" ]; then\n  if [ "\u0024{RETRY_PROBE_LOSE_FACT-0}" = 1 ]; then "\u0024RETRY_PROBE_DOCKER" "\u0024@"; fi\n  printf paused > "\u0024RETRY_PROBE_PAUSED"\n  count=0\n  while [ ! -f "\u0024RETRY_PROBE_RELEASE" ]; do\n    count=\u0024((count + 1))\n    [ "\u0024count" -lt 1500 ] || exit 78\n    sleep 0.02\n  done\n  if [ "\u0024{RETRY_PROBE_LOSE_FACT-0}" = 1 ]; then exit 0; fi\nfi\nexec "\u0024RETRY_PROBE_DOCKER" "\u0024@"\n`);
  chmodSync(path.join(bin, "docker"), 0o755);
  const proc = Bun.spawn([process.execPath, cli, "down", "--delete-cluster", "--clean", "--json"], {
    cwd: p, detached: true, env: { ...safeEnv, PATH: `${bin}:${safeEnv.PATH}`, RETRY_PROBE_TARGET: id, RETRY_PROBE_PAUSED: paused, RETRY_PROBE_RELEASE: release, RETRY_PROBE_DOCKER: realDocker, RETRY_PROBE_LOSE_FACT: mode === "lost-completion" ? "1" : "0" },
    stdin: "ignore", stdout: Bun.file(path.join(p, "interrupted.stdout")), stderr: Bun.file(path.join(p, "interrupted.stderr")),
  });
  processes.add(proc);
  writeFileSync(path.join(p, "retry.pid"), String(proc.pid));
  recordResource(`retry CLI pid/pgid ${proc.pid}; teardown exact returned handle; native Janitor owns each child executor group\n`);
  const deadline = setTimeout(() => { if (proc.exitCode === null) proc.kill("SIGKILL"); }, 45_000);
  try {
    await until("retry paused before the real Docker deletion", async () => existsSync(paused));
    const granted = (await state(p)).launches.find(l => l.kind === "owned-network-delete" && l.phase === "granted"); assert(granted?.phase === "granted");
    if (mode === "lost-completion") {
      assert(granted.deletionTarget?.id === id && granted.groupId === granted.leaderPid);
      assert(!(await docker(["network", "ls", "--no-trunc", "--format", "{{.ID}}"])).split("\n").includes(id));
      const executor = await command(root, ["ps", "-o", "uid=,pgid=,command=", "-p", String(granted.groupId)]);
      assert.equal(executor.code, 0);
      const fields = executor.stdout.trim().split(/\s+/);
      assert.equal(Number(fields[0]), process.geteuid?.()); assert.equal(Number(fields[1]), granted.groupId);
      assert(executor.stdout.includes(granted.id));
      recordResource(`crash exact recorded executor group ${granted.groupId} launch=${granted.id}, after real target deletion before completion fact; verified UID/group/command before SIGKILL\n`);
      process.kill(-granted.groupId, "SIGKILL");
      await proc.exited; processes.delete(proc);
      const lost = await state(p);
      assert(lost.launches.some(l => l.id === granted.id && l.phase === "granted"));
      assert(!lost.completions.some(c => c.launchId === granted.id));
      await silo(p, ["down", "--delete-cluster"]);
      const resolved = await state(p);
      const proof = resolved.launches.find(l => l.id === granted.id);
      assert(proof?.phase === "resolved" && proof.resolution === "target-absent" && proof.exitCode === null);
      assert(resolved.launches.some(l => l.id === first.id && l.reconciled));
      await silo(p, ["down", "--clean"]);
      log({ scenario: "lost exact-delete completion resolves through target absence without inventing exit success", network: id, lost, proof, pass: true });
      return;
    }
    const identity = await command(root, ["ps", "-o", "user=,pgid=,command=", "-p", String(proc.pid)]);
    assert.equal(identity.code, 0); assert.equal(Number(identity.stdout.trim().split(/\s+/)[1]), proc.pid);
    proc.kill("SIGSTOP");
    await until("CLI stopped at the completion-import boundary", async () => {
      const result = await command(root, ["ps", "-o", "stat=", "-p", String(proc.pid)]);
      return result.code === 0 && result.stdout.trim().startsWith("T");
    });
    writeFileSync(release, "release\n");
    await until("retry's exact durable successful completion", async () => {
      const saved = await state(p);
      return saved.completions.some(c => c.launchId === granted.id && c.started && c.exitCode === 0);
    });
    const interrupted = await state(p);
    assert(interrupted.launches.some(l => l.id === first.id && l.phase === "exited" && !l.reconciled));
    assert(interrupted.launches.some(l => l.id === granted.id && l.phase === "granted"));
    assert(!(await docker(["network", "ls", "--no-trunc", "--format", "{{.ID}}"])).split("\n").includes(id));
    proc.kill("SIGKILL"); await proc.exited; processes.delete(proc);
    await silo(p, ["down", "--delete-cluster", "--clean"]);
    const recovered = (await silo(p, ["status"])).project;
    assert.equal(recovered?.generation, 0); assert.deepEqual(recovered?.claims, []);
    log({ scenario: "real failed network delete, durable successful retry, CLI killed before completion import, public recovery retires", network: id, failedLaunch: first.id, successfulLaunch: granted.id, interrupted, pass: true });
  } finally {
    clearTimeout(deadline);
    writeFileSync(release, "release\n");
    if (proc.exitCode === null) { proc.kill("SIGKILL"); await proc.exited; }
    processes.delete(proc);
  }
}

async function composeReplacement(live = false) {
  const p = composeProject(live ? "live-compose-replacement" : "compose-replacement");
  let producer: Bun.Subprocess | undefined;
  let made: Awaited<ReturnType<typeof state>>;
  let parent: { id: string; name: string };
  let originalData: { Name: string };
  if (live) {
    await silo(p, ["env", name(p)]);
    producer = start(p);
    made = await state(p);
    const parentName = `${made.allocation!.state.identity.composeName}-redis-1`;
    await until("live Tilt created the Compose parent", async () => (await docker(["container", "ls", "--format", "{{.Names}}"])).split("\n").includes(parentName));
    const id = await docker(["container", "inspect", parentName, "--format", "{{.Id}}"]);
    parent = { id, name: parentName };
    const mounts = MountsSchema.parse(JSON.parse(await docker(["container", "inspect", id, "--format", "{{json .Mounts}}"] )));
    const data = mounts.find(m => m.Type === "volume" && m.Destination === "/data"); assert(data?.Name);
    originalData = { Name: data.Name };
    recordResource(`live Compose fixture parent ${id} anonymous ${data.Name}; teardown only exact parent --volumes\n`);
  } else {
    await silo(p, ["ci", name(p), "--timeout", "60s"]);
    const observed = await redisMount(p);
    made = observed.made; parent = observed.redis; originalData = observed.data;
  }
  const bin = path.join(p, "bin"); mkdirSync(bin);
  const paused = path.join(p, "parent-removed"), release = path.join(p, "resume-cleanup");
  const realDocker = Bun.which("docker"); assert(realDocker);
  writeFileSync(path.join(bin, "docker"), `#!/bin/sh\nset -eu\nif [ "\u0024{1-}" = container ] && [ "\u0024{2-}" = rm ]; then\n  for arg in "\u0024@"; do\n    if [ "\u0024arg" = "\u0024COMPOSE_PROBE_PARENT" ]; then\n      "\u0024COMPOSE_PROBE_DOCKER" "\u0024@"\n      printf paused > "\u0024COMPOSE_PROBE_PAUSED"\n      count=0\n      while [ ! -f "\u0024COMPOSE_PROBE_RELEASE" ]; do\n        count=\u0024((count + 1))\n        [ "\u0024count" -lt 2000 ] || exit 78\n        sleep 0.02\n      done\n      exit 0\n    fi\n  done\nfi\nexec "\u0024COMPOSE_PROBE_DOCKER" "\u0024@"\n`);
  chmodSync(path.join(bin, "docker"), 0o755);
  const pending = command(p, [process.execPath, cli, "down", "--clean", "--json"], {
    ...safeEnv, PATH: `${bin}:${safeEnv.PATH}`, COMPOSE_PROBE_PARENT: parent.id,
    COMPOSE_PROBE_PAUSED: paused, COMPOSE_PROBE_RELEASE: release, COMPOSE_PROBE_DOCKER: realDocker,
  });
  let replacementId: string | undefined;
  let volume: string | undefined;
  let replacementVolume: Awaited<ReturnType<typeof fixtureSnapshot>> | undefined;
  try {
    await until("exact parent removed before remaining teardown", async () => existsSync(paused));
    const sealed = await state(p);
    log({ scenario: "producer state at parent-removal barrier", liveProducer: live, launches: sealed.launches.filter(l => l.effect === "workload" || l.effect === "hook") });
    assert(!(await docker(["container", "ls", "-a", "--no-trunc", "--format", "{{.ID}}"])).split("\n").includes(parent.id));
    assert(!(await docker(["volume", "ls", "--format", "{{.Name}}"])).split("\n").includes(originalData.Name));
    const recreated = await command(p, ["docker", "compose", "--project-name", made.allocation!.state.identity.composeName, "-f", "compose.yaml", "up", "-d"], {
      ...safeEnv, SILO_PROJECT_ID: made.projectId, SILO_GENERATION: String(made.generation),
    });
    assert.equal(recreated.code, 0, recreated.stdout + recreated.stderr);
    replacementId = (await docker(["container", "inspect", parent.name, "--format", "{{.Id}}"])).trim();
    assert.notEqual(replacementId, parent.id);
    recordResource(`replacement Q container ${replacementId} created by real Compose under project ${made.allocation!.state.identity.composeName}; fixture-owner teardown exact ID --force --volumes\n`);
    const mounts = MountsSchema.parse(JSON.parse(await docker(["container", "inspect", replacementId, "--format", "{{json .Mounts}}"] )));
    const data = mounts.find(m => m.Type === "volume" && m.Destination === "/data"); assert(data?.Name);
    volume = data.Name; assert.notEqual(volume, originalData.Name);
    replacementVolume = await fixtureSnapshot("volume", volume);
    recordResource(`replacement Q anonymous volume W ${volume}; teardown with Q; if baseline removes Q without volumes, fixture owner verifies exact snapshot before independent removal\n`);
    await docker(["container", "exec", replacementId, "sh", "-c", "printf replacement-data > /data/identity"]);
    const replacement = await fixtureSnapshot("container", replacementId);
    writeFileSync(release, "resume\n");
    const result = await pending;
    const containers = (await docker(["container", "ls", "-a", "--no-trunc", "--format", "{{.ID}}"])).split("\n");
    const volumes = (await docker(["volume", "ls", "--format", "{{.Name}}"])).split("\n");
    const after = await silo(p, ["status"]);
    log({ scenario: "real Compose replacement after exact parent removal", oldParent: parent.id, oldData: originalData.Name,
      replacementId, volume, pauseReached: true, resumedCode: result.code, resumed: JSON.parse(result.stdout),
      replacementPreserved: containers.includes(replacementId), volumePreserved: volumes.includes(volume),
      claimsBefore: made.claims, claimsAfter: after.project?.claims });
    assert(containers.includes(replacementId), "cleanup deleted the unreceipted real Compose replacement Q");
    assert(volumes.includes(volume), "cleanup deleted replacement Q's anonymous volume W");
    assert.deepEqual(await fixtureSnapshot("container", replacementId), replacement);
    assert.deepEqual(await fixtureSnapshot("volume", volume), replacementVolume);
    assert.equal(await docker(["container", "exec", replacementId, "cat", "/data/identity"]), "replacement-data");
    assert.deepEqual(after.project?.claims, made.claims, "replacement Q/W must keep all original claims");
    assert.notEqual(result.code, 0, "cleanup must refuse while an unreceipted replacement remains");
    const retry = await command(p, [process.execPath, cli, "down", "--clean", "--json"]);
    assert.notEqual(retry.code, 0, "retry cannot capture replacement Q from the already-sealed launch");
    const retried = await state(p);
    assert(!retried.resources.some(r => r.id === replacementId));
    assert.deepEqual(retried.claims, made.claims);
    assert.deepEqual(await fixtureSnapshot("container", replacementId), replacement);
    assert.deepEqual(await fixtureSnapshot("volume", volume), replacementVolume);
    log({ scenario: "recorded-ID teardown and retry preserve recreated Compose container/data and claims", liveProducer: live, replacementId, volume, pass: true });
  } finally {
    writeFileSync(release, "resume\n");
    await pending;
    if (replacementId && (await docker(["container", "ls", "-a", "--no-trunc", "--format", "{{.ID}}"])).split("\n").includes(replacementId)) {
      await docker(["container", "rm", "--force", "--volumes", replacementId]);
    }
    if (volume && (await docker(["volume", "ls", "--format", "{{.Name}}"])).split("\n").includes(volume)) {
      assert.deepEqual(await fixtureSnapshot("volume", volume), replacementVolume);
      await docker(["volume", "rm", volume]);
    }
    if (producer) {
      if (producer.exitCode === null) producer.kill("SIGTERM");
      await producer.exited; processes.delete(producer);
    }
  }
}

async function lifecycle() {
  const compose = composeProject("compose-restart");
  await silo(compose, ["ci", name(compose), "--timeout", "60s"]);
  const first = await state(compose);
  await silo(compose, ["down"]);
  await silo(compose, ["ci", "--timeout", "60s"]);
  const second = await state(compose);
  assert(first.resources.every(r => !r.deleted));
  assert(second.resources.some(r => r.deleted));
  assert(second.resources.some(r => !r.deleted));
  assert.equal(second.generation, first.generation);
  assert.deepEqual(second.claims, first.claims);
  for (const receipt of first.resources.filter(r => r.kind !== "volume")) {
    assert(second.resources.some(r => r.kind === receipt.kind && r.id === receipt.id), "prior receipts remain audit history");
    assert(second.resources.some(r => r.kind === receipt.kind && r.name === receipt.name && r.id !== receipt.id), "same-generation restart records a new immutable ID");
  }
  await silo(compose, ["down", "--clean"]);
  assert.deepEqual((await silo(compose, ["status"])).project?.claims, []);
  log({ scenario: "Compose ci/down/ci/clean reuses generation and preserves old/new receipt IDs", pass: true });

  const cluster = composeProject("cluster-restart");
  appendFileSync(path.join(cluster, "silo.toml"), '\n[k3d]\nenabled=true\nkubeconfigPath=".localnet/kubeconfig"\n[k3d.registry]\nenabled=false\n[hooks]\npre-up=["sh create-compose.sh"]\n');
  writeFileSync(path.join(cluster, "create-compose.sh"), '#!/bin/sh\nset -eu\ndocker compose --project-name "$COMPOSE_PROJECT_NAME" -f compose.yaml up -d\n');
  await silo(cluster, ["ci", name(cluster), "--timeout", "60s"]);
  const clusterFirst = await state(cluster);
  await silo(cluster, ["down", "--delete-cluster"]);
  await silo(cluster, ["ci", "--timeout", "60s"]);
  const clusterSecond = await state(cluster);
  assert.equal(clusterSecond.generation, clusterFirst.generation);
  assert.deepEqual(clusterSecond.claims, clusterFirst.claims);
  for (const receipt of clusterFirst.resources.filter(r => r.kind !== "volume")) {
    assert(clusterSecond.resources.some(r => r.kind === receipt.kind && r.name === receipt.name && r.id !== receipt.id));
  }
  await silo(cluster, ["down", "--delete-cluster", "--clean"], "CLEANUP_REQUIRED");
  for (const cache of clusterFirst.resources.filter(r => r.kind === "volume")) {
    const current = z.array(z.object({ Name: z.string(), CreatedAt: z.string() })).length(1).parse(JSON.parse(await docker(["volume", "inspect", cache.name])))[0]!;
    assert.equal(current.Name, cache.name); assert.equal(current.CreatedAt, cache.createdAt);
    recordResource(`retained restart fixture cache ${cache.name}; independent owner cleanup after exact creation check\n`);
    await docker(["volume", "rm", cache.name]);
  }
  await silo(cluster, ["down", "--clean"]);
  log({ scenario: "k3d ci/delete-cluster/ci records pre-up creations before backend preflight, fresh IDs and retained named cache", pass: true });

  const failed = composeProject("failed-compose-ci");
  appendFileSync(path.join(failed, "Tiltfile"), "local_resource('fails-after-redis',cmd='exit 17',resource_deps=['redis'])\n");
  await silo(failed, ["ci", name(failed), "--timeout", "60s"], "COMMAND_FAILED");
  const failedState = await state(failed);
  assert(failedState.resources.some(r => r.kind === "container" && r.source === "compose"));
  assert(failedState.launches.some(l => l.effect === "workload" && l.phase === "exited" && l.exitCode !== 0 && l.reconciled));
  await silo(failed, ["down", "--clean"]);
  assert.deepEqual((await silo(failed, ["status"])).project?.claims, []);
  log({ scenario: "failed Tilt CI records its completed producer and cleans exact Compose IDs", pass: true });

  await composeReplacement(true);
}

async function unreceiptedCompose() {
  const p = composeProject("unreceipted-compose");
  await silo(p, ["env", name(p)]);
  const allocated = await state(p);
  const composeName = allocated.allocation!.state.identity.composeName;
  const env = { ...safeEnv, SILO_PROJECT_ID: allocated.projectId, SILO_GENERATION: String(allocated.generation) };
  const created = await command(p, ["docker", "compose", "--project-name", composeName, "-f", "compose.yaml", "up", "-d"], env);
  assert.equal(created.code, 0, created.stderr);
  const found = await command(p, ["docker", "compose", "--project-name", composeName, "-f", "compose.yaml", "ps", "-q"], env);
  assert.equal(found.code, 0, found.stderr);
  const id = found.stdout.trim(); assert.match(id, /^[a-f0-9]{64}$/);
  const networks = z.record(z.object({ NetworkID: z.string() })).parse(JSON.parse(await docker(["container", "inspect", id, "--format", "{{json .NetworkSettings.Networks}}"] )));
  const network = Object.values(networks)[0]!.NetworkID; assert.match(network, /^[a-f0-9]{64}$/);
  recordResource(`unreceipted Compose fixture container ${id}, network ${network}; fixture-owner cleanup exact container ID --force --volumes then network ID\n`);
  try {
    const before = await fixtureSnapshot("container", id);
    await silo(p, ["down", "--clean"], "CLEANUP_REQUIRED");
    assert.deepEqual(await fixtureSnapshot("container", id), before);
    const after = await state(p);
    assert.deepEqual(after.claims, allocated.claims);
    assert.deepEqual(after.resources, []);
    log({ scenario: "cleanup cannot adopt an unreceipted matching Compose object", id, network, claims: after.claims, pass: true });
  } finally {
    await docker(["container", "rm", "--force", "--volumes", id]);
    await docker(["network", "rm", network]);
  }
  await silo(p, ["down", "--clean"]);
}

async function producers() {
  const capped = composeProject("launch-cap");
  await silo(capped, ["ci", name(capped), "--timeout", "60s"]);
  const before = await state(capped);
  assert(before.resources.filter(r => !r.deleted && r.kind !== "volume").length >= 2);
  const owner = await ProjectOperation.open(capped);
  try {
    while (owner.launches().length < 1023) {
      const intent = owner.planLaunch({ kind: "completed-fixture-intent", command: ["true"], effect: "none" });
      owner.markLaunchTerminal(intent.id);
    }
    assert.equal(owner.launches().length, 1023);
  } finally { owner.finish(); }
  await silo(capped, ["down", "--clean"]);
  assert.deepEqual((await silo(capped, ["status"])).project?.claims, []);
  for (const receipt of before.resources.filter(r => r.kind !== "volume")) assert.notEqual((await command(capped, ["docker", receipt.kind, "inspect", receipt.id])).code, 0);
  log({ scenario: "1023 launch records with live Compose receipts still permit public cleanup and retirement", pass: true });

  const cluster = project("failed-k3d-create");
  const clusterConfig = '\n[k3d]\nenabled=true\nkubeconfigPath=".localnet/kubeconfig"\n[k3d.registry]\nenabled=false\n';
  appendFileSync(path.join(cluster, "silo.toml"), clusterConfig.replace("enabled=false", "enabled=true"));
  writeFileSync(path.join(cluster, "silo.toml"), readFileSync(path.join(cluster, "silo.toml"), "utf8").replace("[ports]\n", '[ports]\nK3D_REGISTRY_PORT="random"\n'));
  await silo(cluster, ["env", name(cluster)]);
  const reserved = await state(cluster); assert(reserved.allocation);
  const port = reserved.allocation.state.ports.K3D_API_PORT!;
  // A host listener does not stop OrbStack, which publishes from its VM, from publishing the API port for k3d's load
  // balancer. The engine's own port allocator refuses a second publication however ports reach the host.
  const squatterId = await docker(["run", "-d", "--label", `io.silo.rehearsal=${path.basename(root)}`, "--publish", `127.0.0.1:${port}:6379`, "redis:7-alpine"]);
  const squatter = await fixtureSnapshot("container", squatterId);
  cleanupObjects.push({ kind: "container", id: squatterId, name: "k3d API port squatter", created: squatter });
  recordResource(`k3d API port squatter container ${squatterId} port=${port}; fixture-only teardown exact recorded ID after identity check\n`);
  const PublishedSchema = z.array(z.object({ NetworkSettings: z.object({ Ports: z.record(z.array(z.object({ HostIp: z.string(), HostPort: z.string() })).nullable()) }) })).length(1);
  assert.deepEqual(PublishedSchema.parse(squatter)[0]!.NetworkSettings.Ports["6379/tcp"], [{ HostIp: "127.0.0.1", HostPort: String(port) }],
    "Fixture precondition not established: the engine does not hold the k3d API port");
  const clusterCi = await command(cluster, [process.execPath, cli, "ci", "--timeout", "30s", "--json"]);
  const partial = await state(cluster);
  const creates = partial.launches.filter(l => l.kind === "k3d-cluster-create");
  assert(creates.some(l => l.phase === "exited" && l.exitCode !== null && l.exitCode !== 0),
    `Fixture precondition not established: the API-port squatter did not make k3d-cluster-create fail: ${JSON.stringify(creates)}`);
  assert(creates.every(l => l.reconciled));
  assert.notEqual(clusterCi.code, 0);
  assert(partial.resources.some(r => r.kind === "container" && r.source === "k3d" && !r.deleted));
  assert(partial.resources.some(r => r.kind === "container" && r.labels["k3d.role"] === "registry" && !r.deleted));
  assert.deepEqual(partial.claims, reserved.claims);
  assert.deepEqual(await fixtureSnapshot("container", squatterId), squatter);
  await docker(["container", "rm", "--force", "--volumes", squatterId]); cleanupObjects.pop();
  await silo(cluster, ["down", "--delete-cluster"]);
  for (const receipt of partial.resources.filter(r => r.kind === "container")) {
    assert.notEqual((await command(cluster, ["docker", "container", "inspect", receipt.id])).code, 0);
    for (const mount of receipt.anonymousVolumes) assert.notEqual((await command(cluster, ["docker", "volume", "inspect", mount.name])).code, 0);
  }
  await silo(cluster, ["down", "--clean"], "CLEANUP_REQUIRED");
  for (const cache of partial.resources.filter(r => r.kind === "volume")) {
    const current = z.array(z.object({ Name: z.string(), CreatedAt: z.string(), Labels: z.record(z.string()) })).length(1).parse(JSON.parse(await docker(["volume", "inspect", cache.name])))[0]!;
    assert.equal(current.Name, cache.name); assert.equal(current.CreatedAt, cache.createdAt);
    assert.equal(current.Labels["io.silo.project"], partial.projectId); assert.equal(current.Labels["io.silo.generation"], String(partial.generation));
    recordResource(`failed-create cache ${cache.name}; independent fixture-owner teardown after exact creation and labels check\n`);
    await docker(["volume", "rm", cache.name]);
  }
  await silo(cluster, ["down", "--clean"]);
  log({ scenario: "port-squatter k3d failure captures labelled outputs, exact cleanup retains cache, owner resolution permits retirement", pass: true });

  const network = project("failed-network-create");
  appendFileSync(path.join(network, "silo.toml"), clusterConfig);
  await silo(network, ["env", name(network)]);
  const blocker = await docker(["network", "create", "--label", `io.silo.rehearsal=${path.basename(root)}`, `${name(network)}-ipam-blocker`]);
  const blockerSnapshot = await fixtureSnapshot("network", blocker);
  cleanupObjects.push({ kind: "network", id: blocker, name: `${name(network)}-ipam-blocker`, created: blockerSnapshot });
  recordResource(`IPAM blocker network ${blocker}; fixture-only teardown exact recorded ID after identity check\n`);
  const subnet = await docker(["network", "inspect", blocker, "--format", "{{(index .IPAM.Config 0).Subnet}}"]);
  const bin = path.join(network, "bin"); mkdirSync(bin);
  const wrapper = path.join(bin, "docker");
  const realDocker = Bun.which("docker"); assert(realDocker);
  writeFileSync(wrapper, '#!/bin/sh\nset -eu\nif [ "${1-}" = network ] && [ "${2-}" = create ]; then shift 2; exec "$REHEARSAL_DOCKER" network create --subnet "$REHEARSAL_SUBNET" "$@"; fi\nexec "$REHEARSAL_DOCKER" "$@"\n');
  chmodSync(wrapper, 0o755);
  const failed = await command(network, [process.execPath, cli, "ci", "--timeout", "30s", "--json"], { ...safeEnv, PATH: `${bin}:${safeEnv.PATH}`, REHEARSAL_DOCKER: realDocker, REHEARSAL_SUBNET: subnet });
  assert.notEqual(failed.code, 0); assert(/overlap/i.test(failed.stdout + failed.stderr));
  const knownFailure = await state(network);
  assert(knownFailure.launches.some(l => l.kind === "k3d-network-create" && l.phase === "exited" && l.exitCode !== null && l.exitCode !== 0 && l.reconciled));
  assert.deepEqual(knownFailure.resources, []);
  await silo(network, ["down", "--delete-cluster", "--clean"]);
  assert.deepEqual(await fixtureSnapshot("network", blocker), blockerSnapshot);
  await docker(["network", "rm", blocker]); cleanupObjects.pop();
  log({ scenario: "real overlapping-IPAM network create failure records absence and retires without touching the blocker", pass: true });
}

/** k3d registries carry no Silo labels: only the cluster create that requested one may vouch for it. */
async function registryProvenance(variants: readonly ("ci" | "timeout")[]) {
  const squat = (hold: string) => `#!/bin/sh\nset -eu\nregistry="\${K3D_REGISTRY_NAME%%:*}"\nid=$(docker run -d --name "$registry" --publish "127.0.0.1:$K3D_REGISTRY_PORT:5000" --label "k3d.cluster=$K3D_CLUSTER_NAME" --label "rehearsal.fixture=${path.basename(root)}" redis:7-alpine sleep 900)\nprintf '%s\\n' "$id" > squatter.id\n${hold}`;
  const registryProject = (label: string, hold: string) => {
    const p = project(label, '[hooks]\npre-up=["sh squat.sh"]\n');
    appendFileSync(path.join(p, "silo.toml"), '\n[k3d]\nenabled=true\nkubeconfigPath=".localnet/kubeconfig"\n[k3d.registry]\nenabled=true\n');
    writeFileSync(path.join(p, "silo.toml"), readFileSync(path.join(p, "silo.toml"), "utf8").replace("[ports]\n", '[ports]\nK3D_REGISTRY_PORT="random"\n'));
    writeFileSync(path.join(p, "squat.sh"), squat(hold));
    return p;
  };
  const adoptSquatter = async (p: string) => {
    const id = readFileSync(path.join(p, "squatter.id"), "utf8").trim();
    const created = await fixtureSnapshot("container", id);
    cleanupObjects.push({ kind: "container", id, name: "registry squatter", created });
    recordResource(`hook-started registry squatter container ${id}; fixture-only teardown exact recorded ID after identity check\n`);
    return { id, created };
  };
  const observe = async (p: string, step: string, id: string, result: { code: number; stdout: string }) => {
    const parsed = ResultSchema.parse(JSON.parse(result.stdout));
    const current = await state(p);
    log({ observation: step, exit: result.code, code: parsed.code ?? null, squatterReceipted: current.resources.some(r => r.id === id && !r.deleted) });
    return { parsed, current };
  };
  const releaseSquatter = async (p: string, squatter: { id: string; created: z.infer<typeof FixtureSnapshotSchema> }) => {
    assert.deepEqual(await fixtureSnapshot("container", squatter.id), squatter.created);
    await docker(["container", "rm", "--force", "--volumes", squatter.id]); cleanupObjects.pop();
    await silo(p, ["down", "--delete-cluster", "--clean"]);
    assert.deepEqual((await silo(p, ["status"])).project?.claims, []);
  };

  if (variants.includes("ci")) {
    const hooked = registryProject("registry-hook-squatter", "");
    await silo(hooked, ["env", name(hooked)]);
    const reserved = await state(hooked);
    const ci = await command(hooked, [process.execPath, cli, "ci", "--timeout", "30s", "--json"]);
    const squatter = await adoptSquatter(hooked);
    const afterCi = await observe(hooked, "pre-up hook squatter then ci", squatter.id, ci);
    assert.notEqual(ci.code, 0); assert.equal(afterCi.parsed.code, "NAME_CONFLICT", ci.stdout);
    assert(!afterCi.current.resources.some(r => r.id === squatter.id));
    assert.deepEqual(afterCi.current.claims, reserved.claims);
    assert.deepEqual(await fixtureSnapshot("container", squatter.id), squatter.created);
    const down = await command(hooked, [process.execPath, cli, "down", "--delete-cluster", "--json"]);
    const afterDown = await observe(hooked, "down --delete-cluster after refused hook capture", squatter.id, down);
    assert.notEqual(down.code, 0); assert.equal(afterDown.parsed.code, "NAME_CONFLICT", down.stdout);
    assert.deepEqual(await fixtureSnapshot("container", squatter.id), squatter.created);
    await releaseSquatter(hooked, squatter);
    log({ scenario: "pre-up hook cannot vouch for a same-name registry: ci refuses NAME_CONFLICT and the squatter is preserved", pass: true });
  }
  if (!variants.includes("timeout")) return;

  const timed = registryProject("registry-hook-timeout", "exec sleep 900\n");
  await silo(timed, ["env", name(timed)]);
  const timedOut = await command(timed, [process.execPath, cli, "ci", "--timeout", "30s", "--json"]);
  const pending = await adoptSquatter(timed);
  const afterTimeout = await observe(timed, "pre-up hook timeout", pending.id, timedOut);
  assert.notEqual(timedOut.code, 0);
  assert(afterTimeout.current.launches.some(l => l.kind === "hook-pre-up" && !l.reconciled));
  const pendingDown = await command(timed, [process.execPath, cli, "down", "--delete-cluster", "--json"]);
  const afterPendingDown = await observe(timed, "down --delete-cluster with timed-out hook pending", pending.id, pendingDown);
  assert.notEqual(pendingDown.code, 0); assert.equal(afterPendingDown.parsed.code, "NAME_CONFLICT", pendingDown.stdout);
  assert(!afterPendingDown.current.resources.some(r => r.id === pending.id));
  assert.deepEqual(await fixtureSnapshot("container", pending.id), pending.created);
  await releaseSquatter(timed, pending);
  log({ scenario: "timed-out pre-up hook pending at down cannot vouch for a same-name registry; squatter preserved", pass: true });
}

log({ environment: { platform: process.platform, arch: process.arch, bun: Bun.version, root, accountHome, artifact: cli, sha256: digest(cli) } });
let failure: unknown;
try {
  if (values.suite === "all" || values.suite === "legacy") await legacy();
  if (values.suite === "all" || values.suite === "live") await live();
  if (values.suite === "all" || values.suite === "backend") await backend();
  if (values.suite === "all" || values.suite === "volumes") await anonymousVolumes();
  if (values.suite === "all" || values.suite === "volumes" || values.suite === "same-second") await sameSecondReplacement();
  if (values.suite === "all" || values.suite === "volumes" || values.suite === "paused-delete") await pausedReplacement();
  if (values.suite === "all" || values.suite === "volumes" || values.suite === "parent-volumes") await parentVolumes();
  if (values.suite === "all" || values.suite === "volumes" || values.suite === "inherited-volumes") await inheritedVolumes();
  if (values.suite === "all" || values.suite === "volumes" || values.suite === "retry-crash") await retryCrash();
  if (values.suite === "all" || values.suite === "lifecycle" || values.suite === "absent-delete") await retryCrash("external-absence");
  if (values.suite === "all" || values.suite === "lifecycle" || values.suite === "lost-delete") await retryCrash("lost-completion");
  if (values.suite === "all" || values.suite === "volumes" || values.suite === "compose-replacement") await composeReplacement();
  if (values.suite === "all" || values.suite === "volumes" || values.suite === "compose-replacement") await unreceiptedCompose();
  if (values.suite === "all" || values.suite === "lifecycle") await lifecycle();
  if (values.suite === "live-compose-replacement") await composeReplacement(true);
  if (values.suite === "all" || values.suite === "producers") await producers();
  if (values.suite === "all" || values.suite === "producers" || values.suite === "registry-provenance") await registryProvenance(["ci", "timeout"]);
  if (values.suite === "registry-hook-timeout") await registryProvenance(["timeout"]);
  log({ result: "pass", suite: values.suite });
} catch (error) { failure = error; log({ result: "fail", error: String(error), stack: error instanceof Error ? error.stack : null }); }
finally {
  for (const proc of processes) if (proc.exitCode === null) { proc.kill("SIGTERM"); await proc.exited; }
  for (const object of [...cleanupObjects].reverse()) {
    const current = await fixtureSnapshot(object.kind, object.id);
    assert.deepEqual(current, object.created, "Refusing replacement fixture cleanup"); await docker([object.kind, "rm", ...(object.kind === "container" ? ["--force", "--volumes"] : []), object.id]);
  }
  for (const p of projects) {
    try { await silo(p, ["down", "--delete-cluster", "--clean"]); }
    catch (error) { log({ cleanup: p, retained: String(error) }); failure ??= error; }
  }
  log({ resources: resourceFile, evidence: root, retainedEvidence: true });
}
if (failure) process.exitCode = 1;
