# CLI commands

Use `silo help [command]` for options and `silo doc --list` for references.
`--config` selects a config (default `silo.toml`); `--verbose` adds diagnostics.

| Command | Behavior |
| --- | --- |
| `init` | Create starter config exclusively; refuse an existing file. |
| `env [name]` | Reserve all identities/files/ports atomically; export env and version-2 snapshot. Start no stack. |
| `up [name]` | Export, run hooks, prepare owned k3d if enabled, supervise Tilt in the foreground. Matching live up reuses it. |
| `ci [name] [-- <tilt args>]` | Same preparation with supervised `tilt ci`; set `CI=true`. Retain owned resources after exit. |
| `down` | Stop verified recorded Tilt groups; remove receipted Compose containers/networks by exact ID. Retain clusters, their Kubernetes workloads and claims. No Tiltfile evaluation or teardown hooks. |
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

`ci --timeout 300s` forwards the timeout. Passthrough cannot override managed
listener ports/hosts or an explicit web mode. `env`/`ci --export-ci` require
`GITHUB_ENV`; automatic CI export warns and skips if it is absent. The sink
must be a separate append-only target and cannot alias a generated file.

`--json` lifecycle responses carry `schemaVersion: 1`, `legacy`, `changed`
and the current project. Errors carry a stable `code` and message, with
read-only listings for `LEGACY_STATE`. Diagnostics go to stderr.

`env`, `up`, `ci`, `down` and `status` run the host-wide legacy refusal before
store, file, directory or tool effects. Follow `silo doc ports` for the
mandatory host cutover procedure; there is no migrate operation.
