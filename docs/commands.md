# CLI Commands

This document is the canonical reference for silo's CLI commands. It is bundled
with the CLI and can be printed with:

```
silo doc commands
```

## Global Options

Most commands accept:

- `-c, --config` Path to config file (default: `silo.toml`)
- `-v, --verbose` Enable verbose logging
- `-h, --help` Show help

## help

```
silo help [command]
```

Shows global help or per-command help.

## init

```
silo init
```

Creates a starter `silo.toml` in the current directory. Fails if the file
already exists.

## doc

```
silo doc [topic]
```

Prints bundled documentation as raw markdown. If no topic is provided, silo
prints the available topics.

Topics currently include:

- `config`
- `profiles`
- `commands`
- `lockfile`
- `interpolation`
- `ports`
- `hosts`
- `urls`
- `k3d`
- `hooks`
- `logging`
- `troubleshooting`
- `tilt`

Options:

- `--list` Print topic keys (one per line)
- `--json` Print topics as JSON

## up

```
silo up [name]
```

Starts an environment (creates k3d if configured, starts Tilt). If `name` is
omitted, silo reuses the name from the lockfile or generates a new one.

If this project's Tilt is already running, `silo up` reports that instance --
its ports and URLs -- and exits 0 without starting anything. Running `silo up`
twice is therefore safe; use `silo down` to stop the instance.

Asking for something else while an instance is live is an error rather than a
reuse: `silo up other-name` or `silo up --profile other` reports what is
actually running and points at `silo down`.

Options:

- `-f, --force` Regenerate ports; start a parallel stack if one is live
- `-p, --profile` Use named profile (overrides `SILO_PROFILE`)

Notes:

- Switching profiles on an existing instance requires `--force`.
- `--force` against a live instance starts a second, parallel stack on new
  ports. The running stack is recorded in the lockfile as disowned: it keeps
  answering on its own ports (which stay reserved), `silo status` lists it, and
  `silo down` does not stop it -- stop it with `kill <pid>`.
- Tool validation runs before startup (`tilt`, plus `k3d`/`kubectl` if needed).

## down

```
silo down
```

Stops Tilt and runs down hooks. By default, k3d clusters are kept for faster
restarts.

`--clean` refuses while a stack disowned by `silo up --force` is still running:
the lockfile is the only record of its pid and the only thing keeping other
projects off its ports.

Options:

- `--delete-cluster` Delete the k3d cluster
- `--clean` Remove env file and lockfile

## status

```
silo status
```

Shows the current instance state (profile, Tilt pid, k3d, ports, URLs) based on
the lockfile. That is not Tilt resource health. When Tilt is running, status
prints `tilt get uiresources --port $TILT_PORT`. See `silo doc tilt`.

## env

```
silo env [name]
```

Generates env and lockfile only; does not start k3d or Tilt. Accepts the same
profile and force options as `silo up`.

Options:

- `-f, --force` Regenerate ports even if lockfile exists
- `-p, --profile` Use named profile (overrides `SILO_PROFILE`)
- `--export-ci` Export env vars to `$GITHUB_ENV` (auto in CI)

## ci

```
silo ci [name] [-- <tilt args>]
```

Runs the full silo startup sequence for CI (env, hooks, k3d) and executes
`tilt ci` instead of `tilt up`.

`CI=true` is set in the environment handed to Tilt. Tiltfiles commonly gate e2e
resources on `os.environ.get("CI") == "true"`; without it those resources stay
manual, never run, and `tilt ci` still reports success because every workload it
did build is healthy.

The `$GITHUB_ENV` export is skipped with a warning when the variable is absent,
so `CI=true silo ci` works outside GitHub Actions. Passing `--export-ci`
explicitly still fails when there is nowhere to write.

Options:

- `-f, --force` Regenerate ports even if lockfile exists
- `-p, --profile` Use named profile (overrides `SILO_PROFILE`)
- `--timeout` Passed through to `tilt ci --timeout`
- `--export-ci` Export env vars to `$GITHUB_ENV` (auto in CI)
- `--` Pass remaining args to `tilt ci`

## profiles

```
silo profiles
```

Lists profiles defined in `silo.toml`, or prints "No profiles defined" if none.

## version

```
silo version
```

Prints the current CLI version in the format `silo vX.Y.Z`.

## Behavioral Guarantees

- Lockfile reuse: if `.silo.lock` exists and ports are free, silo reuses them
  unless `--force` is used.
- Profile switching: changing profiles on an existing instance requires
  `--force`.
- Port allocation order: ports are allocated in declaration order with
  default-first, then ephemeral fallback (use `random`/`0` to skip defaults).
