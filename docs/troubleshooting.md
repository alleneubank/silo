# Troubleshooting

Use `silo status --json` and the error's code before changing anything.
Errors preserve ownership when absence or attribution cannot be proved.

## LEGACY_STATE

All allocation/lifecycle commands, including read-only status, refuse with a
listing of old JSON registry entries or a legacy root lock. JSON output has
`code: "LEGACY_STATE"`, `found` and `changed: false`; status exits nonzero.
Malformed and lock-only entries block too. Nothing is migrated, deleted,
recreated or automatically stopped.

Before the host's first new allocation: announce cutover, upgrade or retire
every permitted old invocation, and wait for every old operation to finish.
Each project owner must stop and recreate its ephemeral environment. An old
command paused before publication must be drained before the clean scan.
Do not clear someone else's entry, run an old client after cutover, or change
HOME to evade the refusal. See `silo doc ports`.

## BUSY / ALREADY_RUNNING / CONFIG_CHANGED

`BUSY` means another operation owns this root. Wait for that operation; there
is no timeout-based lock stealing. A repeated matching live `up` reports the
existing instance and exits successfully. A changed name/profile/config or
`--force` cannot disown it. Run `down` to reconcile first. For a retained
cluster use explicit `down --delete-cluster` if deletion is intended.
Then reconfigure the stopped generation with `--force`, or use `--clean` to
retire it. Parallel stacks need separate roots and names.
Clean before removing a generated-file role, such as disabling k3d after it
published a kubeconfig, or changing any recorded path's spelling. Silo retains
the prior generation until its recorded snapshots are cleaned.

## NAME_CONFLICT / PATH_CONFLICT / PATH_CHANGED

Silo does not adopt same-name clusters, registries, networks, volumes,
containers, or unreceipted output files. Read-only inspection commands and
identities accompany backend conflicts. Ask the object's owner to resolve it
or choose a different project name. Never delete a peer object to proceed.

Output and custom kubeconfig paths must be literal ASCII project-relative
files. Separate roles cannot alias the same physical target, including case
variants. Symlinks, hardlinks, traversal, config files and control paths
refuse. A replaced snapshot or parent directory is not deleted. Restore the
owner's original recorded object only when its identity is understood; do not
edit `.silo.lock` or the SQLite store to manufacture permission.

## PORT_BIND_CONFLICT

A native process occupied a claimed port after probing, or a backend published
an unclaimed port. Claims and snapshots keep their assignment. The listener
is not killed and its HTTP response is not treated as readiness. Identify
and resolve it through its owner, then run `down` to reconcile. A remaining
TCP/UDP listener blocks clean and reallocation.

## CLEANUP_REQUIRED

After Ctrl+C, `stopped` means the Tilt process stopped. Its workload receipt
may still need reconciliation. Run `down` before restarting; a stopped process
alone is not a reconciled generation. The restart error names this condition.

Retained resources, uncertain requests, missing executor completion facts or
live/unknown groups prevent claim release. `status --json` lists the recorded
launches, exact objects and problem. `down --clean` keeps snapshots and claims
when proof is incomplete. `down --delete-cluster --clean` deletes only exact
owned objects; failed Tilt teardown propagates. An uncertain request cannot
be cancelled by process death or an empty listing. Escalate with those facts
rather than deleting the ownership store.

An interrupted or short CI environment append keeps its sink receipt and
claims even through `down --clean`; cleanup cannot undo or replay an uncertain
append. Inspect the runner file with its owner and preserve the recorded state
when escalating. A failed parent-directory sync remains pending even when a
rename or unlink is visible; retrying recovery must sync the parent successfully.

## ENGINE_UNAVAILABLE / ENGINE_CHANGED / STORE_ERROR

A failed query is not proof of absence. Restore the original local Docker
endpoint and engine before reconciliation. Remote engines are unsupported.
SQLite busy, corrupt or unknown-version state refuses without resetting
another project's claims. Preserve the original state and collect the error;
never create a replacement empty store as a repair.

## Tool/config errors

Use Bun 1.4.4, Janitor 0.3.1 with `--pgroup-only`, Tilt, Docker, and optional
k3d/kubectl on PATH. Read `silo help <command>` or `silo doc config` for invalid
arguments and profile names. `--config` selects the project through the
config's directory. `silo init` refuses an existing config.

`LAUNCH_FAILED` includes the supervisor's exit status and diagnostic when it
exits before the grant handshake. A version-manager shim can exist on PATH
without a runnable Janitor version in the project's directory. Check
`janitor version` from that directory and configure the required version there,
or put the installed Janitor binary's directory ahead of its shim on PATH.
The native launch tests also run this check from a disposable fixture directory;
a repository-only version-manager setting does not configure that directory.
