/** Native public-CLI rehearsal. Run only in an explicitly disposable OS account. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { AllocationSchema, BackendReceiptSchema, ExecutorCompletionSchema, LaunchSchema } from "../src/core/lease_types";
import { accountHome as nativeAccountHome } from "../src/core/allocation_domain";

const { values } = parseArgs({ args: Bun.argv.slice(2), options: {
  root: { type: "string" }, silo: { type: "string" }, suite: { type: "string", default: "all" },
  "legacy09": { type: "string" }, "legacy05": { type: "string" },
}, strict: true });
assert(values.root && values.silo, "Usage: bun scripts/allocation-rehearsal.ts --root <owned scratch> --silo <built cli.js> [--suite live|legacy|backend|all] [--legacy09 <0.9.0 cli.js> --legacy05 <0.5.9 cli.js>]");
const accountHome = nativeAccountHome();
assert.equal(readFileSync(path.join(accountHome, ".silo-rehearsal-account"), "utf8").trim(), "disposable silo rehearsal account", "Refusing a real account: create the marker only inside a disposable OS account/filesystem view");
const cli = path.resolve(values.silo);
const root = mkdtempSync(path.join(path.resolve(values.root), "allocation-rehearsal-"));
const events = path.join(root, "events.jsonl");
const resourceFile = path.join(root, "resources");
const log = (event: unknown) => { const line = JSON.stringify(event); console.log(line); appendFileSync(events, line + "\n"); };
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
    resources: z.array(BackendReceiptSchema), launches: z.array(LaunchSchema), completions: z.array(ExecutorCompletionSchema),
  }).passthrough().nullable().optional(),
});
async function command(cwd: string, argv: string[], env = safeEnv, timeout = 180_000) {
  const id = ++commandNumber;
  const proc = Bun.spawn(argv, { cwd, env, detached: true, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  processes.add(proc);
  appendFileSync(resourceFile, `process ${proc.pid} pgid=${proc.pid}: ${JSON.stringify(argv)}; teardown via returned subprocess handle or verified recorded group\n`);
  const timer = setTimeout(() => { proc.kill("SIGTERM"); }, timeout);
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer); processes.delete(proc);
  writeFileSync(path.join(root, `${id}.stdout`), stdout); writeFileSync(path.join(root, `${id}.stderr`), stderr);
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
  appendFileSync(resourceFile, `silo up pid/pgid ${proc.pid} root ${p}; teardown via returned handle then silo down --clean\n`);
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
  appendFileSync(resourceFile, `ungranted launch supervisor=${proposed.supervisorPid} group=${proposed.groupId}; Janitor owns drain after recorded CLI death; tool gate never granted\n`);
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
    await silo(a, ["up"]); await silo(a, ["up", "--force"], "ALREADY_RUNNING");
    await silo(a, ["env", "--profile", "alternative", "--force"], "ALREADY_RUNNING");
    assert.deepEqual((await state(a)).claims, stableA.claims);
    pa.kill("SIGKILL"); await pa.exited; processes.delete(pa);
    await until("owner crash drains A", async () => await body(finalAP.APP_PORT!) === null);
    assert.equal(await body(bp.APP_PORT!), name(b)); assert.deepEqual(await state(b), stableB);
    const crashedA = await state(a); assert.deepEqual(crashedA.claims, stableA.claims); assert(crashedA.completions.length > 0);
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
  await silo(teardown, ["down", "--clean"], "COMMAND_FAILED");
  assert.deepEqual((await state(teardown)).claims, beforeTeardown.claims); assert(existsSync(path.join(teardown, ".silo.lock")));
  writeFileSync(path.join(teardown, "Tiltfile"), tiltfile); await silo(teardown, ["down", "--clean"]);
  log({ scenario: "native Tilt teardown failure propagates and retains claims/snapshots", pass: true });
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
  processes.add(paused); appendFileSync(resourceFile, `paused old env pid/pgid ${paused.pid}; release ${release}, await exit then own old down\n`);
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
  writeFileSync(path.join(p, "silo.toml"), cfg.replace("TILT_PORT=48128", "TILT_PORT=48128\nK3D_REGISTRY_PORT=48130\nHTTP_PORT=48131") + '\n[k3d]\nenabled=true\nkubeconfigPath=".localnet/kubeconfig"\nargs=["--port=${HTTP_PORT}:80@loadbalancer"]\n[k3d.registry]\nenabled=true\n');
  const allocated = await silo(p, ["env", name(p)]); const initial = allocated.project; assert(initial?.allocation);
  const cluster = initial.allocation.state.identity.k3dClusterName!;
  await silo(p, ["down", "--clean"]);
  for (const [kind, objectName] of [["network", `k3d-${cluster}`], ["volume", `k3d-${cluster}-images`]] as const) {
    const id = await docker([kind, "create", "--label", `io.silo.rehearsal=${path.basename(root)}`, objectName]);
    const created = await fixtureSnapshot(kind, id); cleanupObjects.push({ kind, id, name: objectName, created });
    appendFileSync(resourceFile, `${kind} ${id} name=${objectName}; teardown docker ${kind} rm ${id} after exact inspect identity comparison\n`);
    await silo(p, ["env", name(p)], "NAME_CONFLICT"); assert.deepEqual(await fixtureSnapshot(kind, id), created);
    await docker([kind, "rm", id]); cleanupObjects.pop();
  }
  for (const file of [".localnet.env", ".localnet/kubeconfig"]) {
    mkdirSync(path.dirname(path.join(p, file)), { recursive: true }); writeFileSync(path.join(p, file), "foreign fixture sentinel\n");
    await silo(p, ["env", name(p)], "PATH_CONFLICT"); assert.equal(readFileSync(path.join(p, file), "utf8"), "foreign fixture sentinel\n"); rmSync(path.join(p, file));
  }
  await silo(p, ["env", name(p)]); await silo(p, ["ci", "--timeout=120s"]);
  const made = await state(p); assert(made.resources.some(r => r.name === `${cluster}-registry.localhost`)); assert(made.resources.some(r => r.kind === "volume"));
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
  await silo(p, ["down", "--delete-cluster", "--clean"]); assert.equal((await silo(p, ["status"])).project?.allocation, null);
  for (const receipt of made.resources) {
    const result = await command(root, ["docker", receipt.kind, "inspect", receipt.kind === "volume" ? receipt.name : receipt.id]); assert.notEqual(result.code, 0);
  }
  for (const volume of attachedVolumes) assert.notEqual((await command(root, ["docker", "volume", "inspect", volume])).code, 0);
  for (const [objectName, role] of [[`k3d-${cluster}-server-0`, "server"], [`${cluster}-registry.localhost`, "registry"]]) {
    const image = images.get(objectName!); assert(image);
    const id = await docker(["container", "create", "--name", objectName!, "--label", `io.silo.rehearsal=${path.basename(root)}`, "--label", "app=k3d", "--label", `k3d.cluster=${cluster}`, "--label", `k3d.role=${role}`, image]);
    const created = await fixtureSnapshot("container", id); cleanupObjects.push({ kind: "container", id, name: objectName!, created });
    appendFileSync(resourceFile, `synthetic stopped k3d ${role} container ${id} name=${objectName}; teardown docker container rm ${id} after exact inspect comparison\n`);
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
  appendFileSync(resourceFile, `outside-claim synthetic container ${outsideId}; teardown exact ID after inspection\n`);
  await silo(p, ["down", "--clean"], "NAME_CONFLICT"); assert.deepEqual(await fixtureSnapshot("container", outsideId), outsideCreated);
  assert.deepEqual((await state(p)).claims, scoped.project.claims);
  await docker(["container", "rm", "--volumes", outsideId]); cleanupObjects.pop(); await silo(p, ["down", "--clean"]);
  await silo(p, ["env", name(p)], "ENGINE_UNAVAILABLE", { ...safeEnv, DOCKER_HOST: `unix://${root}/absent-docker.sock` });
  log({ scenario: "leftovers refused unchanged, retention holds claims, explicit exact deletion, unreachable engine refuses", pass: true });
}

log({ environment: { platform: process.platform, arch: process.arch, bun: Bun.version, root, accountHome, artifact: cli, sha256: digest(cli) } });
let failure: unknown;
try {
  if (values.suite === "all" || values.suite === "legacy") await legacy();
  if (values.suite === "all" || values.suite === "live") await live();
  if (values.suite === "all" || values.suite === "backend") await backend();
  log({ result: "pass", suite: values.suite });
} catch (error) { failure = error; log({ result: "fail", error: String(error), stack: error instanceof Error ? error.stack : null }); }
finally {
  for (const proc of processes) if (proc.exitCode === null) { proc.kill("SIGTERM"); await proc.exited; }
  for (const object of cleanupObjects) {
    const current = await fixtureSnapshot(object.kind, object.id);
    assert.deepEqual(current, object.created, "Refusing replacement fixture cleanup"); await docker([object.kind, "rm", ...(object.kind === "container" ? ["--volumes"] : []), object.id]);
  }
  for (const p of projects) {
    try { await silo(p, ["down", "--delete-cluster", "--clean"]); }
    catch (error) { log({ cleanup: p, retained: String(error) }); failure ??= error; }
  }
  log({ resources: resourceFile, evidence: root, retainedEvidence: true });
}
if (failure) process.exitCode = 1;
