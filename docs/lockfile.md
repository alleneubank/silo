# Ownership store and snapshots

Run `silo doc lockfile` for this reference.

The per-account SQLite store is authoritative. `.silo.lock` version 2 and the
generated env file are consumer snapshots, never ownership grants. Deleting or
editing either does not release claims, authorize cleanup, or reset a project.

A snapshot carries `version: 2`, `projectId`, `generation`, `generatedAt` and
`instance` (name, optional profile, ports, identity, creation time, cluster
state and optional supervisor PID). Generated env also exports
`SILO_PROJECT_ID` and `SILO_GENERATION`. `silo status --json` reads the store
without initializing or repairing it and shows claims, receipts, launch facts,
retained resources and any cleanup problem.

Projects use canonical physical roots. Root symlinks and native filesystem
aliases share the operation mutex. Every operation and deferred callback is
fenced by project ID, generation and operation token; stale owners cannot
write the current generation. A project-wide mutex covers env, up, CI, down,
hooks and backend mutations. A live owner returns `BUSY`; only proven process
absence permits recovery.

Generated files use a single receipt-bound capability. Physical parent device
and inode plus an ASCII-folded leaf identify targets across file roles and
nested roots. Paths cannot escape through traversal, symlinks or hardlinks.
Config/control paths and old registry trees are protected. An existing output
without a receipt is a conflict, even if its bytes look like silo output.

Exports create an exclusive temporary file, sync it, journal its inode/hash,
then atomically rename and sync the parent. Recovery completes only that
recorded operation. Cleanup requires the stored target and matching receipt;
a config edit cannot redirect deletion and a foreign replacement is left
untouched. Interrupted operations retain enough ownership to refuse safely.
CI env export is a separate append-only sink claim, never a deletion grant.

Use `silo down --delete-cluster --clean` to retire a reconciled generation.
Missing/corrupt/unknown-version stores refuse; silo never replaces them with
an empty domain. See `silo doc troubleshooting` before intervening. There is
no automatic migration from version-1 locks or old JSON registries; follow the
host cutover procedure in `silo doc ports`.
