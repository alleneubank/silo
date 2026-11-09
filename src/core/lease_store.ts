import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync, mkdirSync, readFileSync, realpathSync, statSync,
} from "node:fs";
import path from "node:path";
import { SiloError } from "../utils/errors";
import { AllocationSchema, BackendReceiptSchema, ExecutorCompletionSchema, FileReceiptSchema, LaunchSchema, OwnedImageCacheSchema, isOwnedImageCache, matchesResource, resourceReceiptKey } from "./lease_types";
import type { Allocation, BackendReceipt, Claim, DockerDeletionTarget, ExecutorCompletion, ExecutorContext, FileReceipt, Launch, LifecyclePhase, ObservedBackendReceipt, OwnedImageCache } from "./lease_types";
import { fileIdentity, prepareFileTarget, type FileRole, type FileTarget } from "./file_target";
import { OwnedFile, appendSink } from "./owned_file";
import { assertNoLegacyState, legacyRegistryDirectories, type findLegacyState } from "./legacy_check";
import { accountStorePath } from "./allocation_domain";
import { checkPortListenerAbsent, type PortCheckFn } from "./ports";
import { STORE_BUSY_TIMEOUT_MS } from "./constants";

const MAX_PROJECTS = 10_000;
const MAX_CLAIMS = 4096;
const MAX_LAUNCHES = 1024;
const SCHEMA_VERSION = 3;
const APPLICATION_ID = 0x53494c4f;

const SCHEMA = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  root TEXT NOT NULL,
  digest TEXT NOT NULL,
  physical_root TEXT NOT NULL,
  retired INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 0,
  operation_token TEXT,
  operation_pid INTEGER,
  operation_started TEXT
);
CREATE UNIQUE INDEX project_digest ON projects(digest) WHERE retired = 0;
CREATE UNIQUE INDEX project_physical_root ON projects(physical_root) WHERE retired = 0;
CREATE TABLE allocations (
  project_id TEXT NOT NULL REFERENCES projects(id),
  generation INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  phase TEXT NOT NULL,
  problem TEXT,
  PRIMARY KEY (project_id, generation)
);
CREATE TABLE claims (
  domain TEXT NOT NULL,
  resource TEXT NOT NULL,
  project_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  is_prefix INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (domain, resource),
  FOREIGN KEY (project_id, generation) REFERENCES allocations(project_id, generation)
);
CREATE TABLE files (
  project_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  role TEXT NOT NULL,
  receipt TEXT NOT NULL,
  PRIMARY KEY (project_id, generation, role),
  FOREIGN KEY (project_id, generation) REFERENCES allocations(project_id, generation)
);
CREATE TABLE launches (
  project_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  id TEXT NOT NULL,
  receipt TEXT NOT NULL,
  PRIMARY KEY (project_id, generation, id),
  FOREIGN KEY (project_id, generation) REFERENCES allocations(project_id, generation)
);
CREATE TABLE resources (
  project_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  receipt_key TEXT NOT NULL,
  receipt TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, generation, receipt_key),
  FOREIGN KEY (project_id, generation) REFERENCES allocations(project_id, generation)
);
CREATE UNIQUE INDEX resource_object_id ON resources(project_id, generation, kind, id) WHERE kind != 'volume';
CREATE UNIQUE INDEX resource_live_name ON resources(project_id, generation, kind, name) WHERE deleted = 0;
CREATE TABLE completions (
  project_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  launch_id TEXT NOT NULL,
  receipt TEXT NOT NULL,
  PRIMARY KEY (project_id, generation, launch_id),
  FOREIGN KEY (project_id, generation, launch_id) REFERENCES launches(project_id, generation, id)
);
CREATE TABLE sinks (
  project_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  target_key TEXT NOT NULL,
  receipt TEXT NOT NULL,
  PRIMARY KEY (project_id, generation, target_key),
  FOREIGN KEY (project_id, generation) REFERENCES allocations(project_id, generation)
);
PRAGMA user_version = ${SCHEMA_VERSION};
PRAGMA application_id = ${APPLICATION_ID};
`;

type ProjectRow = {
  id: string; root: string; digest: string; physical_root: string; generation: number;
  operation_token: string | null; operation_pid: number | null; operation_started: string | null;
};
type AllocationRow = { snapshot: string; phase: LifecyclePhase; problem: string | null };
type JsonRow = { receipt: string };

const CACHE_AUTHORITY = Symbol("image-cache-deletion-authority");
export interface CacheDeletionCapability { readonly [CACHE_AUTHORITY]: true }

const cleanupRequired = (message: string): never => {
  throw new SiloError(`CLEANUP_REQUIRED: ${message}; cache receipts and claims retained`, "CLEANUP_REQUIRED");
};

/** Store authority is an active persisted creation receipt, never a parsed target. */
const activeImageCache = (db: Database, projectId: string, generation: number, key: string, allocation: Allocation): OwnedImageCache => {
  const row = db.query<JsonRow, [string, number, string]>("SELECT receipt FROM resources WHERE project_id = ? AND generation = ? AND receipt_key = ? AND deleted = 0").get(projectId, generation, key);
  if (!row) return cleanupRequired(`no active owned image-cache creation receipt for ${key}`);
  const receipt = BackendReceiptSchema.parse(JSON.parse(row.receipt));
  if (!isOwnedImageCache(receipt) || resourceReceiptKey(receipt) !== key) return cleanupRequired("image-cache receipt class or key differs");
  if (receipt.projectId !== projectId || receipt.generation !== generation || receipt.cluster !== allocation.state.identity.k3dClusterName ||
    receipt.name !== `k3d-${receipt.cluster}-images` || receipt.id !== receipt.name || !receipt.createdAt ||
    receipt.engine.endpoint !== allocation.engine?.endpoint || receipt.engine.id !== allocation.engine.id ||
    receipt.labels["io.silo.project"] !== projectId || receipt.labels["io.silo.generation"] !== String(generation) ||
    receipt.labels["k3d.cluster"] !== receipt.cluster || receipt.labels["io.silo.creation"] !== receipt.creationToken) {
    return cleanupRequired(`image-cache receipt ownership differs: ${receipt.name}`);
  }
  return receipt;
};

// A failed nonblocking read on a peer connection can leave an existing
// Bun/SQLite connection unusable on Darwin. Poll only through a sole connection.
// Registration, polling and close are synchronous so polls see whole lifetimes.
const operationConnections = new Map<string, Set<Database>>();

/** The immutable identity of one launch's completion fact, which outlives any operation. */
export type CompletionKey = { storePath: string; projectId: string; generation: number; launchId: string };

const selectCompletion = (db: Database, key: Omit<CompletionKey, "storePath">): ExecutorCompletion | null => {
  const row = db.query<JsonRow, [string, number, string]>("SELECT receipt FROM completions WHERE project_id = ? AND generation = ? AND launch_id = ?").get(key.projectId, key.generation, key.launchId);
  return row ? ExecutorCompletionSchema.parse(JSON.parse(row.receipt)) : null;
};

const FILE_AUTHORITY = Symbol("owned-file-authority");
export interface FileAuthority {
  readonly [FILE_AUTHORITY]: true;
  readonly projectId: string;
  readonly generation: number;
  assertCurrent(): void;
  assertPublishing(): void;
  assertRemoving(): void;
  receipt(): FileReceipt;
  checkpoint(receipt: FileReceipt): void;
}

class RetirementProof {
  constructor(private readonly owner: ProjectOperation, private readonly generation: number, private readonly token: string) {}
  assertFor(owner: ProjectOperation): void {
    owner.assertCurrent();
    if (this.owner !== owner || this.generation !== owner.generation || this.token !== owner.token) throw new SiloError("Retirement proof belongs to another operation", "STALE_OPERATION");
  }
}

export const digest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

/** Only ESRCH proves absence. Permission failures and recycled live PIDs retain claims. */
export const processAbsent = (pidOrGroup: number): boolean => {
  if (!Number.isSafeInteger(pidOrGroup) || Math.abs(pidOrGroup) <= 1) return false;
  try {
    process.kill(pidOrGroup, 0);
    return false;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
  }
};

const rootIdentity = (root: string): { canonical: string; physical: string; hash: string } => {
  const canonical = realpathSync(root);
  const stat = statSync(canonical, { bigint: true });
  if (!stat.isDirectory()) throw new SiloError(`Project root is not a directory: ${canonical}`, "INVALID_ROOT");
  return { canonical, physical: `${stat.dev}/${stat.ino}`, hash: digest(canonical) };
};

const databaseVersion = (db: Database, create: boolean): number => {
  const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  const application = db.query<{ application_id: number }, []>("PRAGMA application_id").get()!.application_id;
  if (version !== 0 && (version !== SCHEMA_VERSION || application !== APPLICATION_ID)) throw new Error("Unrecognized lease-store schema or application");
  if (version === 0 && (!create || application !== 0 || db.query<{ count: number }, []>("SELECT count(*) AS count FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get()!.count !== 0)) throw new Error("Unrecognized database at lease-store path");
  return version;
};

const openDatabase = (storePath: string, readonly: boolean, create = !readonly, busyTimeoutMs = STORE_BUSY_TIMEOUT_MS): Database => {
  let connection: Database | undefined;
  try {
    if (!readonly) {
      if (create) mkdirSync(path.dirname(storePath), { recursive: true });
      if (existsSync(storePath)) fileIdentity(storePath);
    }
    const db = new Database(storePath, { readonly, create, strict: true });
    connection = db;
    db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${busyTimeoutMs};`);
    databaseVersion(db, create);
    if (!readonly) {
      db.exec("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;");
      db.transaction(() => {
        if (databaseVersion(db, create) === 0) db.exec(SCHEMA);
        databaseVersion(db, false);
      }).immediate();
    }
    return db;
  } catch (cause) {
    connection?.close();
    throw new SiloError(`LEASE_STORE_UNAVAILABLE: cannot open ${storePath}; allocation refused`, "LEASE_STORE_UNAVAILABLE", { cause });
  }
};

const lookupProject = (db: Database, root: ReturnType<typeof rootIdentity>): ProjectRow | null => {
  const row = db.query<ProjectRow, [string, string]>("SELECT * FROM projects WHERE retired = 0 AND (digest = ? OR physical_root = ?)").get(root.hash, root.physical);
  if (row && row.physical_root !== root.physical) {
    if (row.root === root.canonical && row.generation === 0 && row.operation_token === null) return null;
    throw new SiloError(`Project root or digest collision: ${root.canonical} versus ${row.root}`, "ROOT_CONFLICT");
  }
  return row;
};

const readAllocation = (db: Database, project: ProjectRow): { allocation: Allocation; phase: LifecyclePhase; problem: string | null } | null => {
  if (project.generation === 0) return null;
  const row = db.query<AllocationRow, [string, number]>("SELECT snapshot, phase, problem FROM allocations WHERE project_id = ? AND generation = ?").get(project.id, project.generation);
  if (!row) throw new SiloError("Committed allocation is missing; refusing recovery", "LEASE_STORE_UNAVAILABLE");
  return { allocation: AllocationSchema.parse(JSON.parse(row.snapshot)), phase: row.phase, problem: row.problem };
};

export type ProjectInspection = {
  schemaVersion: 1; projectId: string; root: string; generation: number;
  phase: LifecyclePhase | "unallocated"; problem: string | null;
  operation: { token: string; pid: number | null; startedAt: string | null } | null;
  allocation: Allocation | null; claims: Claim[]; resources: (BackendReceipt & { deleted: boolean })[]; launches: Launch[];
  files: FileReceipt[]; sinks: unknown[];
  completions: ExecutorCompletion[];
};

type OperationOptions = {
  storePath?: string;
  legacyInputs?: Parameters<typeof findLegacyState>[1];
  recover?: boolean;
  executorEntrypoint?: string;
  listenerProbe?: PortCheckFn;
};

/** The sole mutation capability: every effect is fenced by this root, generation and operation. */
export class ProjectOperation {
  private closed = false;
  private readonly cacheCapabilities = new WeakMap<CacheDeletionCapability, { key: string; generation: number; token: string }>();
  private readonly cacheCreations = new Set<string>();
  private mutationState: "active" | "allocating" | "proving-retirement" | "retiring" = "active";

  private constructor(
    private readonly db: Database,
    readonly storePath: string,
    private project: ProjectRow,
    readonly token: string,
    readonly executorEntrypoint: string,
    readonly completionJournal: "account" | "parent",
    private readonly listenerProbe: PortCheckFn,
    private readonly protectedDirectories: readonly string[],
  ) {
    const connections = operationConnections.get(storePath) ?? new Set<Database>();
    connections.add(db);
    operationConnections.set(storePath, connections);
  }

  static async open(root: string, options: OperationOptions = {}): Promise<ProjectOperation> {
    const owner = await ProjectOperation.acquire(root, options, false);
    assert(owner !== null, "A creating acquisition must return an operation");
    return owner;
  }

  static openExisting(root: string, options: OperationOptions = {}): Promise<ProjectOperation | null> {
    return ProjectOperation.acquire(root, options, true);
  }

  private static async acquire(root: string, options: OperationOptions, existingOnly: boolean): Promise<ProjectOperation | null> {
    await assertNoLegacyState(root, options.legacyInputs);
    const identity = rootIdentity(root);
    const storePath = options.storePath ?? accountStorePath();
    if (existingOnly && !existsSync(storePath)) return null;
    const db = openDatabase(storePath, false, !existingOnly);
    const token = randomUUID();
    try {
      const project = db.transaction((): ProjectRow | null => {
        const retiredRoot = db.query<ProjectRow, [string]>("SELECT * FROM projects WHERE digest = ? AND retired = 0 AND generation = 0 AND operation_token IS NULL").get(identity.hash);
        if (retiredRoot?.root === identity.canonical && retiredRoot.physical_root !== identity.physical) {
          db.query("UPDATE projects SET retired = 1 WHERE id = ? AND generation = 0 AND operation_token IS NULL").run(retiredRoot.id);
        }
        let row = lookupProject(db, identity);
        if (!row && existingOnly) return null;
        if (!row) {
          const count = db.query<{ count: number }, []>("SELECT count(*) AS count FROM projects").get()!.count;
          if (count >= MAX_PROJECTS) throw new SiloError("Lease store project limit reached", "STORE_FULL");
          db.query("INSERT INTO projects (id, root, digest, physical_root) VALUES (?, ?, ?, ?)").run(randomUUID(), identity.canonical, identity.hash, identity.physical);
          row = lookupProject(db, identity)!;
        }
        if (row.operation_token !== null) {
          if (!options.recover || row.operation_pid === null || !processAbsent(row.operation_pid)) {
            throw new SiloError(`BUSY: project ${row.root} has operation ${row.operation_token} (pid ${row.operation_pid}). Use status; recover through down only after its owner is absent.`, "BUSY");
          }
        }
        db.query("UPDATE projects SET operation_token = ?, operation_pid = ?, operation_started = ? WHERE id = ?").run(token, process.pid, new Date().toISOString(), row.id);
        return { ...row, operation_token: token, operation_pid: process.pid };
      }).immediate();
      if (!project) { db.close(); return null; }
      return new ProjectOperation(db, storePath, project, token,
        options.executorEntrypoint ?? new URL("../cli.ts", import.meta.url).pathname,
        options.storePath === undefined ? "account" : "parent",
        options.listenerProbe ?? checkPortListenerAbsent,
        legacyRegistryDirectories(options.legacyInputs),
      );
    } catch (error) {
      db.close();
      throw error;
    }
  }

  static inspect(root: string, storePath = accountStorePath()): ProjectInspection | null {
    if (!existsSync(storePath)) return null;
    const db = openDatabase(storePath, true);
    try {
      return db.transaction((): ProjectInspection | null => {
        const project = lookupProject(db, rootIdentity(root));
        if (!project) return null;
        const record = readAllocation(db, project);
        const params: [string, number] = [project.id, project.generation];
        const records = (table: "resources" | "launches" | "files" | "sinks" | "completions"): JsonRow[] => db.query<JsonRow, typeof params>(`SELECT receipt FROM ${table} WHERE project_id = ? AND generation = ?`).all(...params);
        return {
          schemaVersion: 1 as const, projectId: project.id, root: project.root, generation: project.generation,
          phase: record?.phase ?? "unallocated", problem: record?.problem ?? null,
          operation: project.operation_token ? { token: project.operation_token, pid: project.operation_pid, startedAt: project.operation_started } : null,
          allocation: record?.allocation ?? null,
          claims: db.query<Claim, typeof params>("SELECT domain, resource, is_prefix AS prefix FROM claims WHERE project_id = ? AND generation = ? ORDER BY domain, resource").all(...params).map(c => ({ domain: c.domain, resource: c.resource, ...(c.prefix ? { prefix: true } : {}) })),
          resources: db.query<JsonRow & { deleted: number }, typeof params>("SELECT receipt, deleted FROM resources WHERE project_id = ? AND generation = ?").all(...params)
            .map(r => ({ ...BackendReceiptSchema.parse(JSON.parse(r.receipt)), deleted: r.deleted === 1 })),
          launches: records("launches").map(r => LaunchSchema.parse(JSON.parse(r.receipt))),
          files: records("files").map(r => FileReceiptSchema.parse(JSON.parse(r.receipt))),
          sinks: records("sinks").map(r => JSON.parse(r.receipt) as unknown),
          completions: records("completions").map(r => ExecutorCompletionSchema.parse(JSON.parse(r.receipt))),
        };
      })();
    } finally { db.close(); }
  }

  get projectId(): string { return this.project.id; }
  get root(): string { return this.project.root; }
  get generation(): number { return this.project.generation; }

  private static executorGrant(db: Database, context: ExecutorContext): Extract<Launch, { phase: "granted" }> {
    if (context.leaderPid !== process.pid || context.groupId !== process.pid) throw new SiloError("Executor does not own the recorded group leader", "STALE_EXECUTOR");
    const project = lookupProject(db, rootIdentity(context.root));
    if (project?.id !== context.projectId || project.generation !== context.generation) throw new SiloError("Executor generation no longer exists", "STALE_EXECUTOR");
    const row = db.query<JsonRow, [string, number, string]>("SELECT receipt FROM launches WHERE project_id = ? AND generation = ? AND id = ?").get(context.projectId, context.generation, context.launchId);
    const launch = row ? LaunchSchema.parse(JSON.parse(row.receipt)) : null;
    if (launch?.phase !== "granted" || launch.leaderPid !== process.pid || launch.groupId !== context.groupId) throw new SiloError("Executor grant does not match this process", "STALE_EXECUTOR");
    return launch;
  }

  static async validateExecutorGrant(context: ExecutorContext, grant: Extract<Launch, { phase: "granted" }>): Promise<void> {
    await assertNoLegacyState(context.root);
    const db = openDatabase(accountStorePath(), true);
    try { assert.deepEqual(this.executorGrant(db, context), grant, "Executor grant differs from its durable receipt"); }
    finally { db.close(); }
  }

  /** Read-only authority check repeated by the actual executor before its final inspect. */
  static async executorImageCache(context: ExecutorContext, grant: Extract<Launch, { phase: "granted" }>): Promise<OwnedImageCache> {
    await assertNoLegacyState(context.root);
    const db = openDatabase(accountStorePath(), true);
    try {
      assert.deepEqual(this.executorGrant(db, context), grant, "Executor grant differs from its durable receipt");
      const target = grant.deletionTarget;
      if (grant.effect !== "delete" || target?.kind !== "image-cache") return cleanupRequired("executor lacks an image-cache target");
      const row = db.query<AllocationRow, [string, number]>("SELECT snapshot, phase, problem FROM allocations WHERE project_id = ? AND generation = ?").get(context.projectId, context.generation);
      if (!row) return cleanupRequired("executor allocation is absent");
      const receipt = activeImageCache(db, context.projectId, context.generation, target.receiptKey, AllocationSchema.parse(JSON.parse(row.snapshot)));
      if (resourceReceiptKey(target.receipt) !== target.receiptKey) return cleanupRequired("executor target key differs");
      assert.deepEqual(receipt, target.receipt, "Executor target differs from its active creation receipt");
      assert.deepEqual(grant.command, ["docker", "volume", "rm", receipt.name], "Executor cache command differs from receipt");
      return receipt;
    } finally { db.close(); }
  }

  /** An executor may append its own immutable fact; it cannot change lifecycle or claims. */
  static async recordExecutorCompletion(context: ExecutorContext, result: Pick<ExecutorCompletion, "started" | "exitCode" | "completedAt">): Promise<void> {
    await assertNoLegacyState(context.root);
    const db = openDatabase(accountStorePath(), false, false);
    const completion = ExecutorCompletionSchema.parse({ ...context, ...result, launchId: context.launchId });
    try {
      db.transaction(() => {
        this.executorGrant(db, context);
        const old = db.query<JsonRow, [string, number, string]>("SELECT receipt FROM completions WHERE project_id = ? AND generation = ? AND launch_id = ?").get(context.projectId, context.generation, context.launchId);
        if (old) {
          const recorded = ExecutorCompletionSchema.parse(JSON.parse(old.receipt));
          assert.deepEqual([recorded.started, recorded.exitCode, recorded.leaderPid, recorded.groupId], [completion.started, completion.exitCode, completion.leaderPid, completion.groupId], "Executor completion is immutable");
          return;
        }
        db.query("INSERT INTO completions (project_id, generation, launch_id, receipt) VALUES (?, ?, ?, ?)").run(context.projectId, context.generation, context.launchId, JSON.stringify(completion));
      }).immediate();
    } finally { db.close(); }
  }

  /**
   * Observes an immutable completion without waiting on a lock or requiring
   * an operation. Uses only a sole connection; multiple operations yield no
   * fact. A locked read throws, and the caller may try a later poll.
   */
  static readExecutorCompletion(key: CompletionKey): ExecutorCompletion | null {
    const connections = operationConnections.get(key.storePath);
    if (connections && connections.size > 1) return null;
    const existing = connections?.values().next().value;
    if (existing) {
      try {
        existing.exec("PRAGMA busy_timeout = 0;");
        return selectCompletion(existing, key);
      } finally { existing.exec(`PRAGMA busy_timeout = ${STORE_BUSY_TIMEOUT_MS};`); }
    }
    const db = openDatabase(key.storePath, true, false, 0);
    try { return selectCompletion(db, key); }
    finally { db.close(); }
  }

  /** The executor's immutable fact for one of this generation's launches, once it is durable. */
  private executorCompletion(launchId: string): ExecutorCompletion | null {
    return selectCompletion(this.db, { projectId: this.projectId, generation: this.generation, launchId });
  }

  applyCompletions(): void {
    for (const launch of this.launches()) {
      if (launch.phase !== "granted") continue;
      const completion = this.executorCompletion(launch.id);
      if (!completion) continue;
      assert.deepEqual([completion.projectId, completion.generation, completion.leaderPid, completion.groupId], [this.projectId, this.generation, launch.leaderPid, launch.groupId], "Completion provenance differs from the grant");
      this.checkpointLaunch({ ...launch, phase: "exited", started: completion.started, exitCode: completion.exitCode, reconciled: !completion.started || launch.effect === "none" });
    }
    // Completion import must be sufficient after a crash; there may be no
    // remaining object on which to execute another successful retry.
    for (const launch of this.launches()) {
      if (launch.phase === "exited" && launch.effect === "delete" && launch.exitCode === 0 && launch.deletionTarget?.kind !== "image-cache") this.reconcileDeletion(launch);
    }
  }

  recordCommandResult(result: Extract<Launch, { phase: "exited" }>): Extract<Launch, { phase: "exited" }> {
    if (this.completionJournal === "parent") { this.checkpointLaunch(result); return result; }
    this.applyCompletions();
    const recorded = this.launches().find(l => l.id === result.id);
    if (recorded?.phase !== "exited") throw new SiloError(`CLEANUP_REQUIRED: executor ${result.id} has no durable completion fact; claims retained`, "CLEANUP_REQUIRED");
    return recorded;
  }

  /** A successful repeat resolves completed deletions of the same target, never creates or unknown requests. */
  reconcileDeletion(result: Extract<Launch, { phase: "exited" }>): Extract<Launch, { phase: "exited" }> {
    this.assertMutable();
    const completed = this.launches().find(launch => launch.id === result.id);
    assert(completed?.phase === "exited" && completed.exitCode === 0 && completed.effect === "delete", "Deletion reconciliation requires a successful durable result");
    assert(completed.deletionTarget?.kind !== "image-cache", "Cache deletion reconciles only on exact receipt absence");
    // Launch rows are append-only. Only intents preceding this success can be
    // retries it resolves; a later failed request must retain its uncertainty.
    const earlier = this.db.query<JsonRow, [string, number, string, number, string]>(`SELECT receipt FROM launches
      WHERE project_id = ? AND generation = ? AND rowid <= (
        SELECT rowid FROM launches WHERE project_id = ? AND generation = ? AND id = ?)
      ORDER BY rowid`).all(this.projectId, this.generation, this.projectId, this.generation, completed.id);
    for (const row of earlier) {
      const previous = LaunchSchema.parse(JSON.parse(row.receipt));
      if (previous.phase === "exited" && previous.exitCode !== null && previous.effect === "delete" &&
        (previous.terminal || previous.id === completed.id) && previous.kind === completed.kind &&
        JSON.stringify(previous.command) === JSON.stringify(completed.command) &&
        JSON.stringify(previous.deletionTarget) === JSON.stringify(completed.deletionTarget)) {
        this.checkpointLaunch({ ...previous, reconciled: true });
      }
    }
    return { ...completed, reconciled: true };
  }

  assertCurrent(): void {
    if (this.closed) throw new SiloError("Operation has closed", "STALE_OPERATION");
    const row = this.db.query<{ generation: number; operation_token: string | null }, [string]>("SELECT generation, operation_token FROM projects WHERE id = ?").get(this.projectId);
    if (row?.operation_token !== this.token || row.generation !== this.generation) {
      throw new SiloError("STALE_OPERATION: project generation or operation changed", "STALE_OPERATION");
    }
  }

  private assertMutable(): void {
    this.assertCurrent();
    if (this.mutationState !== "active") throw new SiloError("OPERATION_SEALED: operation is proving or consuming terminal resource ownership", "OPERATION_SEALED");
  }

  current(): { allocation: Allocation; phase: LifecyclePhase; problem: string | null } | null {
    this.assertCurrent();
    return readAllocation(this.db, this.project);
  }

  private transaction<T>(run: () => T, sealed = false): T {
    this.assertCurrent();
    if (!sealed) this.assertMutable();
    return this.db.transaction(() => { this.assertCurrent(); return run(); }).immediate();
  }

  excludedPorts(): Set<number> {
    this.assertCurrent();
    return new Set(this.db.query<{ resource: string }, [string, number]>("SELECT resource FROM claims WHERE domain = 'host-port' AND NOT (project_id = ? AND generation = ?)").all(this.projectId, this.generation).map(r => Number(r.resource)));
  }

  private insertClaim(claim: Claim, generation: number): void {
    const conflict = this.db.query<{ resource: string; root: string }, [string, string, string, number, string, string]>(
      `SELECT resource, root FROM claims JOIN projects ON projects.id = claims.project_id
       WHERE domain = ? AND (resource = ? OR (is_prefix = 1 AND substr(?, 1, length(resource)) = resource)
       OR (? = 1 AND substr(resource, 1, length(?)) = ?)) LIMIT 1`,
    ).get(claim.domain, claim.resource, claim.resource, claim.prefix ? 1 : 0, claim.resource, claim.resource);
    if (conflict) {
      const code = claim.domain === "host-port" ? "PORT_CLAIM_CONFLICT" : claim.domain === "file-target" ? "PATH_CONFLICT" : "NAME_CONFLICT";
      throw new SiloError(`${code}: ${claim.domain}/${claim.resource} belongs to ${conflict.root}; choose another name or output.`, code, { details: { owner: conflict.root, resource: claim } });
    }
    this.db.query("INSERT INTO claims (domain, resource, project_id, generation, is_prefix) VALUES (?, ?, ?, ?, ?)").run(claim.domain, claim.resource, this.projectId, generation, claim.prefix ? 1 : 0);
  }

  /** Commits the complete snapshot and all claims, or leaves the prior generation intact. */
  async allocate(allocation: Allocation, claims: Claim[], targets: { role: FileRole; target: FileTarget }[]): Promise<void> {
    this.assertMutable();
    this.mutationState = "allocating";
    try {
      if (this.current()) await this.verifyTerminalResources();
      this.commitAllocation(allocation, claims, targets);
    } finally { this.mutationState = "active"; }
  }

  private commitAllocation(allocation: Allocation, claims: Claim[], targets: { role: FileRole; target: FileTarget }[]): void {
    if (claims.length + targets.length > MAX_CLAIMS) throw new SiloError("Allocation exceeds claim limit", "INVALID_CONFIG");
    const previous = this.current();
    if (previous) {
      if (this.resources().length > 0 || this.launches().some(l => !l.terminal || !l.reconciled)) {
        throw new SiloError("CLEANUP_REQUIRED: stop and reconcile retained resources before changing this generation", "CLEANUP_REQUIRED");
      }
    }
    const generation = this.db.query<{ next: number }, [string]>("SELECT coalesce(max(generation), 0) + 1 AS next FROM allocations WHERE project_id = ?").get(this.projectId)!.next;
    if (!Number.isSafeInteger(generation)) throw new SiloError("Allocation generation limit reached", "STORE_FULL");
    const receipts = targets.map(({ role, target }): FileReceipt => {
      this.protectStoreTarget(target);
      const old = this.fileReceipt(role);
      if (old && (old.target.key !== target.key || old.target.path !== target.path)) {
        throw new SiloError(`PATH_CONFLICT: ${role} target changed; down --clean uses its recorded target. Clean before reallocating.`, "PATH_CONFLICT");
      }
      const identity = fileIdentity(target.path);
      if (role === "config") {
        if (identity === null) throw new SiloError(`Config disappeared: ${target.path}`, "PATH_CHANGED");
        return { role, target, published: { identity, hash: digest(readFileSync(target.path)), generation }, pending: null };
      }
      if (!old && identity !== null) {
        throw new SiloError(`PATH_CONFLICT: unreceipted file exists: ${target.path}. Inspect its owner; silo will not overwrite or delete it.`, "PATH_CONFLICT");
      }
      return { role, target, published: old?.published ?? null, pending: null };
    });
    this.transaction(() => {
      if (previous) {
        this.releaseGenerationClaims(receipts);
      }
      this.db.query("INSERT INTO allocations (project_id, generation, snapshot, phase) VALUES (?, ?, ?, 'reserved')").run(this.projectId, generation, JSON.stringify(AllocationSchema.parse(allocation)));
      for (const claim of claims) this.insertClaim(claim, generation);
      for (const receipt of receipts) {
        this.insertClaim({ domain: "file-target", resource: receipt.target.key }, generation);
        this.db.query("INSERT INTO files (project_id, generation, role, receipt) VALUES (?, ?, ?, ?)").run(this.projectId, generation, receipt.role, JSON.stringify(receipt));
      }
      this.db.query("UPDATE projects SET generation = ? WHERE id = ? AND operation_token = ? AND generation = ?").run(generation, this.projectId, this.token, this.generation);
    }, true);
    this.project = { ...this.project, generation };
  }

  fileReceipt(role: FileRole): FileReceipt | null {
    this.assertCurrent();
    const row = this.db.query<JsonRow, [string, number, string]>("SELECT receipt FROM files WHERE project_id = ? AND generation = ? AND role = ?").get(this.projectId, this.generation, role);
    return row ? FileReceiptSchema.parse(JSON.parse(row.receipt)) : null;
  }

  prepareTarget(base: string, relative: string, role: FileRole | "sink"): FileTarget {
    this.assertMutable();
    return prepareFileTarget(base, relative, role, this.protectedDirectories);
  }

  private checkpointFile(receipt: FileReceipt): void {
    this.transaction(() => {
      const old = this.fileReceipt(receipt.role);
      if (!old || old.target.key !== receipt.target.key || old.target.path !== receipt.target.path) throw new SiloError("File receipt changed", "STALE_OPERATION");
      this.db.query("UPDATE files SET receipt = ? WHERE project_id = ? AND generation = ? AND role = ?").run(JSON.stringify(FileReceiptSchema.parse(receipt)), this.projectId, this.generation, receipt.role);
    }, true);
  }

  file(role: Exclude<FileRole, "config">): OwnedFile {
    const generation = this.generation;
    const receipt = this.fileReceipt(role);
    if (!receipt) throw new SiloError(`No owned ${role} target in this allocation`, "PATH_CONFLICT");
    const assertCurrent = () => {
      this.assertCurrent();
      if (this.generation !== generation) throw new SiloError("File capability belongs to an earlier generation", "STALE_OPERATION");
    };
    const authority: FileAuthority = {
      [FILE_AUTHORITY]: true, projectId: this.projectId, generation,
      assertCurrent,
      assertPublishing: () => { assertCurrent(); this.assertMutable(); },
      assertRemoving: () => {
        assertCurrent();
        if (this.mutationState === "allocating" || this.mutationState === "proving-retirement") throw new SiloError("File mutation is sealed during resource proof", "OPERATION_SEALED");
      },
      receipt: () => { assertCurrent(); return this.fileReceipt(role)!; },
      checkpoint: next => {
        assertCurrent();
        assert(next.role === role && next.target.key === receipt.target.key && next.target.path === receipt.target.path, "Owned file target and role are immutable");
        this.checkpointFile(next);
      },
    };
    return new OwnedFile(authority);
  }

  launches(): Launch[] {
    this.assertCurrent();
    return this.db.query<JsonRow, [string, number]>("SELECT receipt FROM launches WHERE project_id = ? AND generation = ?").all(this.projectId, this.generation).map(r => LaunchSchema.parse(JSON.parse(r.receipt)));
  }

  resourceClaims(): Claim[] {
    this.assertCurrent();
    return this.db.query<Claim, [string, number]>("SELECT domain, resource, is_prefix AS prefix FROM claims WHERE project_id = ? AND generation = ?").all(this.projectId, this.generation).map(c => ({ domain: c.domain, resource: c.resource, ...(c.prefix ? { prefix: true } : {}) }));
  }

  planLaunch(input: Pick<Launch, "kind" | "command" | "effect"> & { deletionTarget?: DockerDeletionTarget }): Extract<Launch, { phase: "planned" }> {
    assert(input.deletionTarget === undefined || input.effect === "delete", "Only a deletion may carry a deletion target");
    assert(!input.deletionTarget || input.deletionTarget.kind === "container" || input.deletionTarget.kind === "network", "Generic launch planning excludes cache targets");
    const { kind, command, effect, deletionTarget } = input;
    return this.insertLaunch({ kind, command, effect, ...(deletionTarget ? { deletionTarget } : {}) });
  }

  planImageCacheCreation(): Extract<Launch, { phase: "planned" }> {
    const cluster = this.current()?.allocation.state.identity.k3dClusterName;
    if (!cluster || !this.current()?.allocation.engine) return cleanupRequired("cache creation requires a recorded cluster and engine");
    const creation = { token: randomUUID(), cluster, name: `k3d-${cluster}-images` };
    const launch = this.insertLaunch({ kind: "k3d-image-cache-create", effect: "create", cacheCreation: creation,
      command: ["docker", "volume", "create", "--label", `io.silo.project=${this.projectId}`,
        "--label", `io.silo.generation=${this.generation}`, "--label", `k3d.cluster=${cluster}`,
        "--label", `io.silo.creation=${creation.token}`, creation.name] });
    this.cacheCreations.add(launch.id);
    return launch;
  }

  authorizeImageCacheDeletion(receiptKey: string): CacheDeletionCapability {
    return this.transaction(() => {
      activeImageCache(this.db, this.projectId, this.generation, receiptKey, this.current()!.allocation);
      const capability: CacheDeletionCapability = { [CACHE_AUTHORITY]: true };
      this.cacheCapabilities.set(capability, { key: receiptKey, generation: this.generation, token: this.token });
      return capability;
    });
  }

  planImageCacheDeletion(capability: CacheDeletionCapability): Extract<Launch, { phase: "planned" }> {
    return this.transaction(() => {
      const binding = this.cacheCapabilities.get(capability);
      if (!binding || binding.generation !== this.generation || binding.token !== this.token) return cleanupRequired("cache capability belongs to another operation");
      const receipt = activeImageCache(this.db, this.projectId, this.generation, binding.key, this.current()!.allocation);
      return this.insertLaunch({ kind: "owned-image-cache-delete", effect: "delete", command: ["docker", "volume", "rm", receipt.name],
        deletionTarget: { kind: "image-cache", receiptKey: binding.key, receipt } });
    });
  }

  private insertLaunch(input: Pick<Launch, "kind" | "command" | "effect" | "deletionTarget" | "cacheCreation">): Extract<Launch, { phase: "planned" }> {
    const launch: Extract<Launch, { phase: "planned" }> = { ...input, id: randomUUID(), phase: "planned", reconciled: false, terminal: false, supervisorPid: null, leaderPid: null, groupId: null, supervisorIdentity: null, exitCode: null };
    this.transaction(() => {
      if (this.launches().length >= MAX_LAUNCHES) {
        // Only facts whose processes and effects are resolved can be discarded.
        // Resource/mount history is independent and remains available for audit.
        for (const old of this.launches().filter(l => l.terminal && l.reconciled)) {
          this.db.query("DELETE FROM completions WHERE project_id = ? AND generation = ? AND launch_id = ?").run(this.projectId, this.generation, old.id);
          this.db.query("DELETE FROM launches WHERE project_id = ? AND generation = ? AND id = ?").run(this.projectId, this.generation, old.id);
        }
      }
      if (this.launches().length >= MAX_LAUNCHES) throw new SiloError("Launch capacity is occupied by unresolved processes or effects; inspect status and reconcile their exact targets", "STORE_FULL");
      this.db.query("INSERT INTO launches (project_id, generation, id, receipt) VALUES (?, ?, ?, ?)").run(this.projectId, this.generation, launch.id, JSON.stringify(LaunchSchema.parse(launch)));
    });
    return launch;
  }

  checkpointLaunch(launch: Launch): void {
    this.assertMutable();
    this.storeLaunch(launch);
  }

  private storeLaunch(launch: Launch): void {
    this.transaction(() => {
      const old = this.launches().find(l => l.id === launch.id);
      if (!old) throw new SiloError("Launch intent no longer belongs to this operation", "STALE_OPERATION");
      const transitions = { planned: ["planned", "granted", "cancelled"], granted: ["granted", "exited", "resolved"], exited: ["exited"], cancelled: ["cancelled"], resolved: ["resolved"] };
      assert(transitions[old.phase].includes(launch.phase), `Invalid launch transition: ${old.phase} -> ${launch.phase}`);
      assert.deepEqual([launch.kind, launch.effect, launch.command, launch.deletionTarget, launch.cacheCreation], [old.kind, old.effect, old.command, old.deletionTarget, old.cacheCreation], "Launch identity is immutable");
      if (old.phase === "planned" && launch.phase === "granted" && launch.deletionTarget?.kind === "image-cache") {
        const target = launch.deletionTarget;
        const receipt = activeImageCache(this.db, this.projectId, this.generation, target.receiptKey, this.current()!.allocation);
        assert.deepEqual(receipt, target.receipt, "Cache grant requires the unchanged active creation receipt");
      }
      if (old.phase !== "planned") assert.deepEqual(
        [launch.supervisorPid, launch.leaderPid, launch.groupId, launch.supervisorIdentity],
        [old.supervisorPid, old.leaderPid, old.groupId, old.supervisorIdentity], "Executor identity is immutable",
      );
      if (launch.terminal && !old.terminal && !this.launchIsAbsent(launch)) {
        throw new SiloError("CLEANUP_REQUIRED: executor terminal proof is unavailable", "CLEANUP_REQUIRED");
      }
      const next = { ...launch, terminal: old.terminal || launch.terminal, reconciled: old.reconciled || launch.reconciled };
      const result = this.db.query("UPDATE launches SET receipt = ? WHERE project_id = ? AND generation = ? AND id = ?").run(JSON.stringify(LaunchSchema.parse(next)), this.projectId, this.generation, launch.id);
      if (result.changes !== 1) throw new SiloError("Launch intent no longer belongs to this operation", "STALE_OPERATION");
    }, true);
  }

  private launchIsAbsent(launch: Launch): boolean {
    if (launch.phase === "planned" || launch.phase === "cancelled") return true;
    return launch.supervisorPid !== null && launch.groupId !== null &&
      processAbsent(launch.supervisorPid) && processAbsent(-launch.groupId);
  }

  /** Terminal proof is monotonic: a later reuse of a numeric PID is not this executor. */
  markLaunchTerminal(id: string): void {
    this.assertMutable();
    this.proveLaunchTerminal(id);
  }

  private proveLaunchTerminal(id: string): void {
    const launch = this.launches().find(l => l.id === id);
    if (!launch) throw new SiloError("Launch intent not found", "STALE_OPERATION");
    if (launch.terminal) return;
    if (!this.launchIsAbsent(launch)) throw new SiloError(`CLEANUP_REQUIRED: recorded executor ${id} is live or unknown`, "CLEANUP_REQUIRED");
    if (launch.phase === "planned") this.storeLaunch({ ...launch, phase: "cancelled", terminal: true, reconciled: true });
    else this.storeLaunch({ ...launch, terminal: true });
  }

  resources(includeDeleted = false): BackendReceipt[] {
    this.assertCurrent();
    return this.db.query<JsonRow, [string, number, number]>("SELECT receipt FROM resources WHERE project_id = ? AND generation = ? AND (? = 1 OR deleted = 0)").all(this.projectId, this.generation, includeDeleted ? 1 : 0).map(r => BackendReceiptSchema.parse(JSON.parse(r.receipt)));
  }

  recordResources(resources: ObservedBackendReceipt[]): void {
    if (resources.length > MAX_CLAIMS) throw new SiloError("Too many backend resources", "STORE_FULL");
    this.transaction(() => {
      for (const resource of resources) {
        assert(!isOwnedImageCache(resource), "Generic observations cannot confer cache creation authority");
        const sameName = this.resources().find(r => r.kind === resource.kind && r.name === resource.name);
        if (sameName && isOwnedImageCache(sameName)) {
          if (!matchesResource(sameName, resource)) return cleanupRequired(`owned cache identity changed: ${resource.name}`);
          continue;
        }
        this.insertResource(resource);
      }
    });
  }

  /** Only a successful direct creator with a durable fact can issue this receipt. */
  recordImageCacheCreation(launchId: string, observed: ObservedBackendReceipt): OwnedImageCache {
    return this.transaction(() => {
      const launch = this.launches().find(l => l.id === launchId);
      const fact = this.executorCompletion(launchId);
      if (!this.cacheCreations.has(launchId) || launch?.phase !== "exited" || launch.reconciled || !launch.started || launch.exitCode !== 0 || launch.effect !== "create" ||
        !launch.cacheCreation || !fact?.started || fact.exitCode !== 0) return cleanupRequired("cache creator has no successful durable completion");
      const allocation = this.current()!.allocation;
      const creation = launch.cacheCreation;
      if (observed.kind !== "volume" || observed.authority !== "observed" || observed.source !== "k3d" ||
        observed.name !== creation.name || observed.id !== creation.name || !observed.createdAt ||
        creation.cluster !== allocation.state.identity.k3dClusterName || !allocation.engine ||
        observed.labels["io.silo.project"] !== this.projectId || observed.labels["io.silo.generation"] !== String(this.generation) ||
        observed.labels["k3d.cluster"] !== creation.cluster || observed.labels["io.silo.creation"] !== creation.token) {
        return cleanupRequired(`direct cache creation result differs: ${observed.name}`);
      }
      const receipt = OwnedImageCacheSchema.parse({ ...observed, authority: "owned-image-cache", purpose: "k3d-image-cache",
        creationToken: creation.token, projectId: this.projectId, generation: this.generation, cluster: creation.cluster, engine: allocation.engine });
      this.insertResource(receipt);
      this.cacheCreations.delete(launchId);
      return receipt;
    });
  }

  private insertResource(resource: BackendReceipt): void {
    const claimed = this.resourceClaims().some(c => c.domain === resource.kind && (c.resource === resource.name || (c.prefix && resource.name.startsWith(c.resource))));
    if (!claimed) throw new SiloError(`NAME_CONFLICT: resource lies outside this allocation's claims: ${resource.name}`, "NAME_CONFLICT");
    const key = resourceReceiptKey(resource);
    const sameName = this.resources().find(r => r.kind === resource.kind && r.name === resource.name);
    if (sameName && resourceReceiptKey(sameName) !== key) {
      if (isOwnedImageCache(sameName) || isOwnedImageCache(resource)) return cleanupRequired(`live cache identity changed: ${resource.name}`);
      throw new SiloError(`NAME_CONFLICT: live resource identity changed: ${resource.kind}/${resource.name}`, "NAME_CONFLICT");
    }
    const old = this.resources(true).find(r => resourceReceiptKey(r) === key || (r.kind !== "volume" && r.kind === resource.kind && r.id === resource.id));
    if (old && (old.name !== resource.name || old.createdAt !== resource.createdAt || !this.resources().some(r => resourceReceiptKey(r) === resourceReceiptKey(old)))) {
      throw new SiloError(`NAME_CONFLICT: resource identity changed or reappeared: ${resource.kind}/${resource.name}`, "NAME_CONFLICT");
    }
    if (!old) this.db.query("INSERT INTO resources (project_id, generation, kind, name, id, created_at, receipt_key, receipt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(this.projectId, this.generation, resource.kind, resource.name, resource.id, resource.createdAt, key, JSON.stringify(BackendReceiptSchema.parse(resource)));
  }

  /** The backend must first prove this exact identity absent on the allocation's engine. */
  recordResourceAbsence(resource: BackendReceipt): void {
    this.transaction(() => {
      const key = resourceReceiptKey(resource);
      const stored = this.resources(true).find(r => resourceReceiptKey(r) === key);
      assert.deepEqual(stored, resource, "Absence must consume this generation's exact receipt");
      if (resource.kind !== "volume" || isOwnedImageCache(resource)) {
        for (const launch of this.launches()) {
          const target = launch.deletionTarget;
          const matches = target?.kind === "image-cache" ? target.receiptKey === key && resourceReceiptKey(target.receipt) === key :
            target?.kind === resource.kind && target.id === resource.id;
          if (!launch.terminal || launch.effect !== "delete" || !matches || !target) continue;
          if (launch.phase === "exited") this.checkpointLaunch({ ...launch, reconciled: true });
          else if (launch.phase === "granted") this.checkpointLaunch({ ...launch, phase: "resolved", effect: "delete", deletionTarget: target,
            resolution: "target-absent", terminal: true, reconciled: true });
        }
      }
      const updated = this.db.query("UPDATE resources SET deleted = 1 WHERE project_id = ? AND generation = ? AND receipt_key = ?").run(this.projectId, this.generation, key);
      assert.equal(updated.changes, 1, "Absence must tombstone one exact receipt");
    });
  }

  update(allocation: Allocation, phase: LifecyclePhase, problem: string | null = null): void {
    this.transaction(() => {
      const result = this.db.query("UPDATE allocations SET snapshot = ?, phase = ?, problem = ? WHERE project_id = ? AND generation = ?").run(JSON.stringify(AllocationSchema.parse(allocation)), phase, problem, this.projectId, this.generation);
      if (result.changes !== 1) throw new SiloError("Allocation no longer belongs to this operation", "STALE_OPERATION");
    });
  }

  noteFailure(error: unknown): void {
    const problem = (error instanceof Error ? error.message : String(error)).slice(0, 4096);
    this.transaction(() => {
      this.db.query("UPDATE allocations SET phase = 'cleanup-required', problem = ? WHERE project_id = ? AND generation = ?").run(problem, this.projectId, this.generation);
    }, true);
  }

  appendGithubEnv(file: string, content: string): void { appendSink(this, file, content); }

  claimSink(target: FileTarget): void {
    this.transaction(() => {
      this.protectStoreTarget(target);
      this.insertClaim({ domain: "file-target", resource: target.key }, this.generation);
      this.db.query("INSERT INTO sinks (project_id, generation, target_key, receipt) VALUES (?, ?, ?, ?)").run(this.projectId, this.generation, target.key, JSON.stringify({ target, state: "append-uncertain", operation: this.token }));
    });
  }

  completeSink(target: FileTarget): void {
    this.transaction(() => {
      this.db.query("DELETE FROM sinks WHERE project_id = ? AND generation = ? AND target_key = ?").run(this.projectId, this.generation, target.key);
      this.db.query("DELETE FROM claims WHERE domain = 'file-target' AND resource = ? AND project_id = ? AND generation = ?").run(target.key, this.projectId, this.generation);
    });
  }

  protectStoreTarget(target: FileTarget): void {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      const protectedTarget = prepareFileTarget(path.dirname(this.storePath), path.basename(this.storePath) + suffix, "config");
      if (target.key === protectedTarget.key) throw new SiloError(`PATH_CONFLICT: lease-store control target: ${target.path}`, "PATH_CONFLICT");
    }
  }

  private async verifyTerminalResources(): Promise<void> {
    this.assertCurrent();
    for (const launch of this.launches()) this.proveLaunchTerminal(launch.id);
    const remaining = this.resources();
    const launches = this.launches();
    if (remaining.length > 0 || launches.some(l =>
      !l.terminal || l.phase === "granted" ||
      (l.phase === "exited" && !l.reconciled))) {
      throw new SiloError("CLEANUP_REQUIRED: resources, process groups or unresolved tool intents remain; claims retained", "CLEANUP_REQUIRED");
    }
    const { proveBackendAbsent } = await import("../backends/ownership");
    await proveBackendAbsent(this);
    const current = this.current();
    for (const port of Object.values(current?.allocation.state.ports ?? {})) {
      if (!(await this.listenerProbe(port))) throw new SiloError(`CLEANUP_REQUIRED: declared port ${port} still has a TCP or UDP listener; no listener was stopped`, "CLEANUP_REQUIRED");
    }
    this.assertCurrent();
  }

  /** Seals backend mutation before any snapshot cleanup can consume the proof. */
  async prepareRetirement(): Promise<RetirementProof> {
    this.assertMutable();
    this.mutationState = "proving-retirement";
    try {
      await this.verifyTerminalResources();
      this.mutationState = "retiring";
      return new RetirementProof(this, this.generation, this.token);
    } catch (error) { this.mutationState = "active"; throw error; }
  }

  /** Only a terminal, resource-free owner may retire its complete claim set. */
  retire(proof: RetirementProof): void {
    proof.assertFor(this);
    if (this.mutationState !== "retiring") throw new SiloError("Retirement proof has already been consumed", "STALE_OPERATION");
    this.transaction(() => {
      this.releaseGenerationClaims([]);
      this.db.query("UPDATE projects SET generation = 0 WHERE id = ? AND generation = ? AND operation_token = ?").run(this.projectId, this.generation, this.token);
    }, true);
    this.project = { ...this.project, generation: 0 };
  }

  /** A generation may release claims only after every file obligation is discharged or transferred. */
  private releaseGenerationClaims(transfers: readonly FileReceipt[]): void {
    if (this.db.query<{ count: number }, [string, number]>("SELECT count(*) AS count FROM sinks WHERE project_id = ? AND generation = ?").get(this.projectId, this.generation)!.count > 0) {
      throw new SiloError("CLEANUP_REQUIRED: interrupted CI append remains uncertain; sink and generation claims retained. Inspect the runner file with its owner; silo cannot undo or replay an uncertain append.", "CLEANUP_REQUIRED");
    }
    const receipts = this.db.query<JsonRow, [string, number]>("SELECT receipt FROM files WHERE project_id = ? AND generation = ?").all(this.projectId, this.generation).map(r => FileReceiptSchema.parse(JSON.parse(r.receipt)));
    for (const receipt of receipts) {
      if (receipt.role === "config") continue;
      const next = transfers.find(file => file.role === receipt.role);
      if (next) {
        assert(next.target.key === receipt.target.key && next.target.path === receipt.target.path, "Transferred file target is immutable");
        this.file(receipt.role).verify();
        assert.deepEqual(next.published, receipt.published, "Transferred snapshot retains its receipt");
        assert(next.pending === null, "Only completed snapshots can transfer");
      } else if (receipt.published || receipt.pending || fileIdentity(receipt.target.path) !== null) {
        throw new SiloError(`CLEANUP_REQUIRED: owned ${receipt.role} snapshot remains at ${receipt.target.path}. Run down --clean before removing its role; claims retained.`, "CLEANUP_REQUIRED");
      }
    }
    this.db.query("DELETE FROM claims WHERE project_id = ? AND generation = ?").run(this.projectId, this.generation);
  }

  finish(): void {
    if (this.closed) return;
    try {
      this.transaction(() => {
        this.db.query("UPDATE projects SET operation_token = NULL, operation_pid = NULL, operation_started = NULL WHERE id = ? AND generation = ? AND operation_token = ?").run(this.projectId, this.generation, this.token);
      }, true);
    } finally {
      this.closed = true;
      const connections = operationConnections.get(this.storePath);
      connections?.delete(this.db);
      if (connections?.size === 0) operationConnections.delete(this.storePath);
      this.db.close();
    }
  }
}
