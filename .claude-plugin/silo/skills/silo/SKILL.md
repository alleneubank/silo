---
name: silo
description: Use when operating silo environments, editing silo.toml, switching profiles, or diagnosing Tilt/k3d allocation and cleanup.
---

# silo

Read the installed CLI's bundled reference with `silo doc <topic>` before
changing its configuration or repairing an environment. Discover topics with
`silo doc --list`; inspect commands with `silo help <command>`.

- `silo env [name]` atomically reserves ports, names and file targets, and
  exports env plus `.silo.lock`. It starts no stack. `silo up [name]` prepares
  the environment and supervises Tilt; repeating the same live `up` reuses it.
  `silo ci [name] --timeout 300s` runs the supervised CI flow.
- `silo status --json` reports authoritative project/generation ownership,
  claims, resources and cleanup problems. A live supervisor is not resource
  health: source the generated env and query
  `tilt get uiresources --port "$TILT_PORT"`. Keep lifecycle changes in silo.
- Stop with `silo down`. k3d resources and all reservations remain owned.
  Receipted Compose containers are removed with their anonymous volumes.
  Cleanup stops only verified recorded process groups and removes recorded
  container/network IDs. It never evaluates Tiltfile or runs teardown hooks.
  Kubernetes workloads remain in a retained cluster. Finished owned Tilt/hook
  producers are recorded before deletion, including failed CI and stopped live
  up; recording is sealed before any deletion and cannot renew on retry. Missing
  non-delete facts or unsupported provenance require independent owner resolution.
  Matching names/labels without a pending owned producer never grant authority.
  `silo down --delete-cluster --clean` explicitly deletes the owned cluster,
  removing each exact receipted container ID with its anonymous volumes, then
  snapshots and claims once absence is proved. Silo never deletes a volume by
  name. `status --json` lists audit-only `anonymousVolumes`, even after a parent
  is gone. Named/explicit mounts and volumes still used elsewhere survive.
  Leaked or replaced names keep claims and block clean/force until their owner
  resolves them independently; Silo cannot clean a volume whose parent is gone.
  Inherited `volumes-from` provenance refuses before container removal.
  k3d's named image cache also remains for its owner to resolve before clean.
  Same-config ci/down/ci reuses its generation with new ID receipts and keeps
  old mount history. A terminal exact-ID delete can resolve through verified
  target absence; `resolved`/`target-absent` with null exit does not claim success.
  Unreleased store format 1 requires matching-old-proposal drain and owner-led
  recreation before format 2; no migration/reset is automatic.
  Failed or uncertain teardown retains ownership. Inspect `status` and
  `silo doc troubleshooting`; never delete the store, lock or peer reservation
  to make allocation succeed. Never adopt or delete a conflicting object.
- `--force` can reconfigure a stopped, reconciled generation. It refuses live,
  retained or uncertain state. Stop/reconcile before changing name, profile,
  ports or output paths. Parallel stacks require separate roots and names.
  Clean before changing a recorded path (including capitalization) or removing
  a generated-file role, such as disabling k3d with a published kubeconfig.
  Profile selection is `--profile` > `SILO_PROFILE` > stored profile > base.
- `LEGACY_STATE` is a host-wide, read-only refusal, including lock-only peers
  with no listener. Read its listing. Before a host's first new allocation,
  announce cutover, upgrade or retire every permitted old silo invocation,
  and wait for all old operations to finish. Have each owner stop and recreate
  its ephemeral environment. There is no migration or automatic old-client
  drain; do not run old clients after cutover. Never manufacture a clean scan
  by deleting another project's JSON entry or lock.
- Output and custom kubeconfig paths are literal ASCII project-relative files,
  without expansion, traversal, symlinks or hardlinks. Existing unreceipted
  files refuse. Separate file roles cannot share a physical target. The
  default kubeconfig alone may live under the invoking HOME's `.kube`.
- Prefer `${name}.localhost` host templates for browser cookie isolation.
  k3d registry needs `K3D_REGISTRY_PORT` in `[ports]`; map only declared allocated
  ports in `k3d.args`. Let silo select the k3d API port and own its control flags.

The canonical per-account SQLite store ignores `HOME` and
`SILO_PORT_REGISTRY_DIR` as allocation-store selectors. Changing those variables
cannot create an independent silo domain. See `silo doc ports`, `lockfile`,
`profiles`, `k3d`, `tilt`, and `troubleshooting` for details.
