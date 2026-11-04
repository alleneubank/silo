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
  `silo down --delete-cluster --clean` explicitly deletes the owned cluster,
  then removes receipted snapshots and releases claims once absence is proved.
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
