# @0xbigboss/silo

## 0.8.1

### Patch Changes

- efc5c86: CLI commands print the next correct command at stop points: Tilt API port on
  `silo status` / already-running `up`, "did not start Tilt" on `silo env`,
  kept k3d cluster on `silo down`, install URLs for missing tools, and available
  topics for unknown `silo doc` names.

## 0.8.0

### Minor Changes

- ca78806: `silo ci` now sets `CI=true` in the environment it hands Tilt, and no longer
  requires `GITHUB_ENV`.

  Tiltfiles commonly gate e2e resources on `os.environ.get("CI") == "true"`.
  GitHub Actions sets `CI` for free, so workflows never state it and the gap is
  invisible until you run locally: the gated resources stay manual, never
  execute, and `tilt ci` still exits 0 reporting success, because every workload
  it did build is healthy. Assertions that never ran cannot fail. Running those
  resources is what `silo ci` is for, so it now says so itself.

  Expect previously-skipped resources to start running locally. In CI nothing
  changes, since `CI` was already set there.

  The `$GITHUB_ENV` export is now skipped with a warning when the variable is
  absent, in both `silo ci` and `silo env` — `CI=true` alone never promised that
  file exists. Passing `--export-ci` explicitly still fails when there is nowhere
  to write, because the caller asked for the export.

## 0.7.0

### Minor Changes

- 55e4054: `silo up` no longer starts a duplicate stack when one is already live.

  Before starting anything, `up` checks whether the Tilt recorded in the lockfile
  is still running (the same liveness check `silo status` uses, so a reused pid
  still reads as dead). If it is, `up` reports that instance -- its ports and
  URLs -- and exits 0 instead of forking a second Tilt onto ephemeral ports.

  `silo up --force` still starts a parallel stack for anyone who wants one. The
  running stack is now moved into a new `disownedTilts` list in the lockfile
  rather than being overwritten, so it keeps a record of the ports it owns:
  `silo status` lists disowned stacks, `silo down` warns that it does not stop
  them, and entries are dropped once the process exits.

  `silo up` now holds an exclusive startup claim (`.silo.startup`) from the
  liveness check until the new pid is recorded, so two concurrent runs cannot both
  get past the guard, and it refuses with `DISOWNED_RUNNING` when a disowned stack
  is running but nothing owns the lockfile. `silo env` keeps disowned ports
  reserved rather than reallocating them or dropping them from the machine-wide
  port registry.

  `silo ci` is unchanged and still errors when an instance is already running.

### Patch Changes

- 36c7b0f: Detect a Tilt running outside silo by the directory it is actually running in.

  The check built the pattern `tilt.*<project root>` and passed it to `pgrep -f`,
  which matches a process's argv. silo starts Tilt with the project root as the
  spawn cwd and a developer's own `tilt up` is just `tilt up`, so the path was
  never in argv and the pattern could not match: `findTiltPidsInDir` always
  returned nothing and the "Tilt already running outside silo" guard never fired.

  Candidates are now attributed by reading each process's working directory
  (`/proc/<pid>/cwd` on Linux, `lsof` elsewhere), and stacks silo started are
  excluded by ancestry and process group rather than by pid alone — the `tilt up`
  under a supervisor is a different pid from the one the lockfile records. The
  error now names the pid it found.

- f14a0e4: Point every repository URL at `alleneubank/silo`, the current owner of the
  repo. The old `0xBigBoss/silo` paths still redirect on github.com, but npm
  compares `repository.url` to `GITHUB_REPOSITORY` verbatim when it generates
  provenance, so the stale owner would fail the publish outright. The plugin
  marketplace id moves with it: install with `silo@alleneubank-silo`.

## 0.6.0

### Minor Changes

- 9ddb96e: Run Tilt under `janitor` so it cannot outlive the silo process that started it.

  `silo up` forwarded SIGINT and SIGTERM to Tilt, but nothing covered the cases
  where no handler runs: SIGKILL, SIGHUP when the controlling terminal closes, or
  a silo crash. Tilt reparented to init and kept holding the instance's allocated
  ports, and because silo allocates a distinct port per instance those orphans
  never collided with a later `silo up` and accumulated unnoticed.

  `janitor` is now a required tool, validated alongside `tilt` at the start of
  `silo up`. Install it from https://github.com/alleneubank/janitor.

  `tiltPid` in the lockfile is now the supervisor's pid; `silo status` and
  `silo down` accept either the supervisor or tilt as the tracked process.

## 0.5.9

### Patch Changes

- a18e6b6: Add a machine-wide port registry (`~/.silo/instances/`) so two silo instances (e.g. different worktrees) get guaranteed-disjoint port sets, even on a cold machine where nothing is bound yet. Before allocating, silo reads peer instances' registered ports and excludes them; after allocating, it registers its own. Registry entries are garbage-collected when their project's `.silo.lock` disappears. Fixes overlapping `NEXTJS_PORT`/`TILT_PORT`/etc. across worktrees.

## 0.5.8

### Patch Changes

- 632d1b1: Fix port allocator to check both `0.0.0.0` and `127.0.0.1` for availability, preventing "address already in use" errors when another silo instance binds a port on loopback only

## 0.5.7

### Patch Changes

- b148243: Document npm-based Tilt extension loading for CI environments and add a regression test to keep the guidance in bundled docs.

## 0.5.6

### Patch Changes

- 1ba52bd: Validate k3d registry `hostFrom*` advertisement overrides against the resolved
  shortened/hash-based k3d registry identity to prevent unreachable hostnames and
  `ImagePullBackOff` during local image pulls.

## 0.5.5

### Patch Changes

- 69b4e02: Fix k3d bootstrap recovery for stale clusters where the registry container is missing, and harden registry health checks to require exact name matches.

## 0.5.4

### Patch Changes

- 0fa4869: Fix release workflow to create GitHub releases by using `changeset publish` instead of raw `npm publish`

## 0.5.3

### Patch Changes

- 8d2a767: Improve registry auto-discovery with k3d metadata lookup, retries, configurable
  ConfigMap fields, external registry advertisement, and registry status details.

## 0.5.2

### Patch Changes

- 6f2e108: Add about blurb and Silo Overseer quote to version output; add screenshot to README

## 0.5.1

### Patch Changes

- 1110836: Add `silo ci` command with CI env export, document remote Tilt extension usage,
  and add CI health checks for the example workloads.

## 0.5.0

### Minor Changes

- Add SILO\_\* env markers for child processes and ship a Tilt require extension for silo-only runs.

## 0.4.1

### Patch Changes

- fix(k3d): shorten cluster names to stay within 32-char limit

  k3d cluster names cannot exceed 32 characters. When `{prefix}-{name}` exceeds this limit, silo now shortens the name using a deterministic format that preserves uniqueness.

  fix(k3d): reconcile registry port drift between lockfile and actual

  When reusing an existing k3d cluster, the allocated registry port in the lockfile may differ from the actual port bound by Docker. Silo now queries the actual registry port via `docker port` and updates the lockfile if drift is detected.

## 0.4.0

### Minor Changes

- d0ef21d: Add support for `random` or `0` port values to always allocate from the ephemeral range (49152-65535), while still reusing lockfile ports across restarts.

  Fix kubeconfig corruption when k3d outputs debug lines with ANSI escape sequences to stdout.

## 0.3.3

### Patch Changes

- Fix knip configuration to ignore changeset binary

## 0.3.2

### Patch Changes

- Clarify k3d agents and loadbalancer in embedded docs

## 0.3.1

### Patch Changes

- Add colored ASCII art to version command (yellow silo, green ground)

## 0.3.0

### Minor Changes

- Rewrite skill for clarity and add 5 new doc topics (hosts, urls, logging, tilt, troubleshooting)

  - Skill now concise and action-oriented with clear triggers
  - Doc system refactored with --list and --json flags
  - Added doc.test.ts for topic validation
  - Version now embedded at build time via src/version.ts

## 0.2.4

### Patch Changes

- Update skill documentation with all doc topics and version command

## 0.2.3

### Patch Changes

- Add comprehensive documentation topics: commands, lockfile, interpolation, ports, k3d, hooks

## 0.2.2

### Patch Changes

- Add version command and profiles documentation topic

## 0.2.1

### Patch Changes

- Fix Claude Code plugin marketplace structure for proper installation

## 0.2.0

### Minor Changes

- Add profile support for environment-specific configuration overrides

  - New `silo profiles` command to list available profiles
  - `--profile` flag and `SILO_PROFILE` env var for profile selection
  - Profile resolution: flag > env var > lockfile > base config
  - Profile switching requires `--force` flag
  - Profiles can override ports, hosts, urls, k3d settings, and hooks
  - `[profiles.x.append]` section for appending to arrays instead of replacing

  Add Claude Code plugin for AI agent integration

  - `.claude-plugin/plugin.json` manifest for marketplace distribution
  - `skills/silo/SKILL.md` with CLI documentation and usage patterns
  - Teaches AI agents when and how to use silo commands
