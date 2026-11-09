# CLI commands

Use `silo help [command]` for options and `silo doc --list` for references.
`--config` selects a config (default `silo.toml`); `--verbose` adds diagnostics.

| Command | Behavior |
| --- | --- |
| `init` | Create starter config exclusively; refuse an existing file. |
| `env [name]` | Reserve all identities/files/ports atomically; export env and version-2 snapshot. Start no stack. |
| `up [name]` | Export, run hooks, prepare owned k3d if enabled, supervise Tilt in the foreground. Matching live up reuses it. |
| `ci [name] [-- <tilt args>]` | Same preparation with supervised `tilt ci`; set `CI=true`. Record finished owned producers even on failure and retain their resources for down. |
| `down` | Stop verified recorded Tilt groups; record finished owned producers before deletion, including stopped live up; remove receipted Compose containers/networks by exact ID. Retain clusters, Kubernetes workloads and claims. No Tiltfile evaluation or teardown hooks. |
| `down --delete-cluster` | Also delete exact owned cluster objects. No name-wide adoption or deletion. |
| `down --clean` | Retire only after all requests/groups/resources/listeners are proved absent; delete receipted snapshots and release own claims. |
| `status [--json]` | Read authoritative ownership without repair. Supervisor liveness is not Tilt resource health. |
| `profiles` | List configured profiles. |
| `doc [topic]` | Print bundled reference; `--list` or `--json` discovers topics. |
| `version` | Print CLI version. |

`env`, `up` and `ci` accept `--profile` and `--force`. Profile resolution is
flag, `SILO_PROFILE`, stored profile, then base. `--force` reconfigures only a
stopped, reconciled generation; live, retained or uncertain state refuses.
Use separate roots and names for parallel stacks. Omitted names reuse the
stored name or generate a bounded unique candidate for a new root.

The same configuration can restart within its generation with down between runs:
`ci`, `down`, `ci`,
then `down --clean`. Old immutable-ID receipts remain audit history while the
new creation result records fresh IDs under the same names. k3d supports the
corresponding `ci`, `down --delete-cluster`, `ci` loop. Explicit cluster deletion
removes its directly created, durably receipted image cache after exact executor
validation and an all-container reference check. Restarts record a fresh token
while retaining prior cache history. Ordinary down retains cluster and cache.
This loop does not qualify Compose's in-place service rebuild/recreate: inherited
anonymous data can survive and require independent owner resolution.

Finite creating tools, including k3d network/volume/cluster creates, hooks and
Tilt CI, record labelled outputs before reporting a known failure. Down also
records a finished producer after importing its completion. Recording is sealed
before the first deletion. A cleanup retry
cannot adopt a same-name replacement from that old launch. Missing producer facts
or unsupported provenance still refuse. A terminal exact-ID delete can instead
resolve through verified target absence; status reports `phase: resolved`,
`resolution: target-absent`, `exitCode: null` when its completion fact was lost.
Unknown creates and untargeted commands cannot use that proof. Resources in status
include historical receipts with `deleted: true` for recorded absence and false
for active receipts. The flag is stored knowledge; use immutable IDs for a fresh
physical-presence check. At the 1024-launch limit, terminal reconciled launch and
completion history can be compacted while uncertainty and resource history remain.

The unreleased SQLite proposal format is 3. Format-1 and format-2 stores refuse
without migration/reset; format-2 clients also refuse format 3. Drain the matching
old proposal and resolve its resources before owner-led recreation.

`ci --timeout 300s` forwards the timeout. Passthrough cannot override managed
listener ports/hosts or an explicit web mode. `env`/`ci --export-ci` require
`GITHUB_ENV`; automatic CI export warns and skips if it is absent. The sink
must be a separate append-only target and cannot alias a generated file.

`--json` lifecycle responses carry `schemaVersion: 1`, `legacy`, `changed`
and the current project. Errors carry a stable `code` and message, with
read-only listings for `LEGACY_STATE`. Diagnostics go to stderr.

Interrupting `ci --json` with SIGINT or SIGTERM returns one `INTERRUPTED`
error with a top-level `signal` field and exit 130 or 143. The supervisor
drains its recorded group after the CLI exits. Run `status` and `down` to
recover an abandoned operation and reconcile retained ownership.
A signal after final JSON emission starts preserves that result and its exit status.
Normal JSON output handles pipe backpressure for up to 30 seconds. During that
flush, CI interrupts preserve the selected result. A reader stalled longer than
30 seconds gets a nonzero exit; a failed output stream receives no second object.

Status preserves stored fields under `project`. Separate `launchStatus` entries
report `launchId`, observed `state`, `groupsAbsent` and a provenance-checked
`completion` (or null). A dead recorded group is `terminated` if its result is
unknown, or `completed` when its durable result exists. Stored exits and terminal
facts remain known even after PID reuse. `unconfirmed` means no process group
was recorded; `live-or-unknown` proves neither completion nor readiness.
`groupsAbsent` is a fresh observation, not a change to the stored terminal flag.
`operationOwnerAbsent` identifies a dead recorded CLI owner. `cleanupRequired`
also reflects unreconciled completed/terminated launches and stored cleanup
problems; inspect a live `project.operation` before attempting recovery.
Status never imports facts into ownership or releases claims; `down` does that.
A fact whose provenance conflicts with its grant refuses with
`COMPLETION_PROVENANCE_MISMATCH`; ownership remains retained.

Launch identity observations share a 30-second startup budget, capped at the
finite command's run budget, followed by the durable grant checkpoint. The
executor waits up to 45 seconds for that grant. The command's execution timer
still starts after grant. Status text, `up` and `down` allow up to 30 seconds
per recorded supervisor identity check under load.

`doc` embeds the Markdown references in every build. Topic output works when
the JavaScript bundle or standalone executable is copied outside the repository.

`env`, `up`, `ci`, `down` and `status` run the host-wide legacy refusal before
store, file, directory or tool effects. Follow `silo doc ports` for the
mandatory host cutover procedure; there is no migrate operation.
