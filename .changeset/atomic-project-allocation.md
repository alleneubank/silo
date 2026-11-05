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
explicit cluster deletion does the same for k3d. Silo never deletes a volume by
name. Named/explicit mounts and volumes still referenced elsewhere survive;
inherited volumes-from provenance refuses. Leaked or replaced names block clean
and force with retained claims until their owner resolves them independently.
k3d's named image cache is retained for its owner to resolve. A durable successful exact
deletion retry is reconciled on recovery even if the caller crashed first.

Pin Bun 1.4.4 and Janitor 0.3.1. Release remains gated on matching specialist
review and native Linux/macOS rehearsal; this changeset does not authorize
publication or the stop/recreate of any existing host project.
