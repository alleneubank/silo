---
"@0xbigboss/silo": major
---

Allocate project ports, final resource names and physical file targets atomically
in a canonical per-account SQLite store. Fence lifecycle effects and cleanup by
project/generation ownership, journal gated process groups and exact backend
receipts, and retain reservations after uncertain failures. Existing unowned
resources/files refuse instead of being reused or deleted.

BREAKING: before a host's first new allocation, announce the cutover, upgrade or
retire every permitted old silo invocation, and wait until all old operations
are terminal—including commands paused before publishing state. Stop projects
with their own old silo, then recreate the ephemeral environments. Any legacy
JSON reservation or root lock returns read-only LEGACY_STATE; malformed and
lock-only entries also block. Nothing migrates and no data, ports, clusters or
volumes carry over. Do not run old clients after cutover. An old client's later
writes may collide; visible legacy state blocks new commands but does not undo
that old invocation. Project owners resolve their own leftovers.

BREAKING: output/custom kubeconfig paths are literal ASCII project-relative
files; aliases, traversal, symlinks, hardlinks and existing unreceipted files
refuse. Lockfile version 2 is a snapshot, not allocation authority. Changing HOME
or SILO_PORT_REGISTRY_DIR cannot select an independent store. --force no longer
disowns a live stack: reconcile first, or use separate roots and names. Clean
requires proof of terminal commands, absent resources and free declared ports.
Container receipts retain anonymous mount names for audit after parent deletion.
Down removes exact receipted Compose container IDs with their anonymous volumes;
explicit cluster deletion does the same for k3d. Only a directly created, durably receipted k3d image cache can use Docker's
name-addressed removal, after independent executor receipt/identity/token/engine
validation and an all-container reference check. Other volumes gain no authority. Named/explicit mounts and volumes still referenced elsewhere survive;
inherited volumes-from provenance refuses. Leaked or replaced names block clean
and force with retained claims until their owner resolves them independently.
Explicit cluster deletion removes its verified unused image cache. Docker has no
conditional volume deletion; external replacement after final inspection is a
disclosed residual race. A durable successful exact
deletion retry is reconciled on recovery even if the caller crashed first.

BREAKING: down stops verified recorded processes and deletes recorded immutable
container/network IDs and receipt-bound image caches; it never runs tilt down, compose down or arbitrary
teardown hooks. Pre-down/post-down config keys are rejected, including profiles.
Kubernetes workloads remain with a retained cluster. Finished owned producers,
including k3d network/volume/cluster creates, hooks, failed CI and live up stopped
by down, are recorded before deletion. Known failed creates reconcile after their
outputs or absence are recorded. Recording is sealed once per producer; a cleanup retry cannot
adopt a replacement from that old launch. Unknown producers/missing non-delete
facts still require independent owner resolution.

Resource history is keyed by immutable container/network IDs so ordinary
stop/restart can record fresh same-name IDs in the same generation. Terminal
exact-ID delete requests reconcile when that target is verified absent, including
an explicit target-absent resolution with unknown exit if completion was lost.
No success is invented and unknown creates remain unresolved. Unreleased proposal
store formats 1 and 2 are refused without schema migration by format 3; format-2
clients also refuse format 3. SQLite's native
rollback recovery remains available to writable lifecycle commands. Owners drain the matching old
proposal before recreating. There is no automatic store migration or reset.
Terminal reconciled launch/completion history is compacted at the 1024-record
limit, preserving unresolved facts and resource/mount history for cleanup.
JSON resource receipts expose `deleted` to distinguish recorded tombstones.

Pin Bun 1.4.4 and Janitor 0.3.1. Release remains gated on matching specialist
review and native Linux/macOS rehearsal; this changeset does not authorize
publication or the stop/recreate of any existing host project.
