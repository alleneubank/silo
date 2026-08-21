# Troubleshooting

This document lists common errors and fixes. It is bundled with the CLI and can
be printed with:

```
silo doc troubleshooting
```

## Config File Not Found

**Error:** `Config file not found`

- Ensure `silo.toml` exists in the current directory, or pass `--config`.

## No Lockfile Found

**Error:** `No lockfile found. Nothing to stop.`

- Run `silo up` first, or remove `--clean` if you intended to keep state.

## Instance Already Running

`silo up` reports the running instance and exits 0 instead of starting a second
stack:

```
silo info: Instance 'feature-x' is already running (Tilt pid 12345)
```

- Run `silo down` to stop it, or `silo up --force` to start a parallel stack on
  new ports.

**Error:** `Instance '<name>' is already running: it is running as '<other>', ...`

- `silo up <name>` or `silo up --profile <name>` asked for something other than
  what is live. Run `silo down` first, or `silo up --force` to start a parallel
  stack with the requested name or profile.

**Error:** `Instance '<name>' already running. Use 'silo down' first.`

- Raised by `silo ci`, which never reuses a running environment. Run
  `silo down`, or stop the Tilt process and try again.

## Another silo up Is Starting

**Error:** `Another 'silo up' is starting this project (pid <pid>). Wait for it to finish.`

- Two `silo up` runs overlapped. The second refuses rather than racing the first
  into a duplicate stack. Wait for the first to record its Tilt, then retry.
- If no `silo up` is actually running, the claim file `.silo.startup` was left
  behind by a killed process; silo reclaims it automatically once the recorded
  pid is gone, and removing the file by hand is safe.
- silo waits on a live starter for as long as it runs -- hooks and k3d cluster
  creation can take minutes -- rather than assuming a slow startup is dead.

## Stacks Running That No Longer Own the Lockfile

**Error:** `N stack(s) from this project are running but no longer own the lockfile`

- A `silo up --force` handover did not finish, or the replacement stack it
  started has since exited, leaving an earlier stack running with no owner.
- Stop the listed pids with `kill <pid>`, or run `silo up --force` to start a
  new stack beside them.

## Down --clean With Stacks Still Running

**Error:** `--clean would erase the only record of N running stack(s)`

- `silo down --clean` removes the lockfile and releases this project's port
  reservations. While a disowned stack is running, that record is the only
  thing naming its pid and keeping peer projects off its ports.
- Stop the listed pids with `kill <pid>`, then re-run. Plain `silo down`
  (without `--clean`) still works and leaves the records in place.

## Disowned Stacks Still Running

**Warning:** `N stack(s) disowned by 'silo up --force' are still running`

- A previous `silo up --force` started a parallel stack. The stack named in the
  warning no longer owns the lockfile, so `silo down` will not stop it.
- `silo status` lists each disowned pid with the ports it answers on. Stop one
  with `kill <pid>`; the entry disappears from the lockfile once it exits.

## Tilt Already Running Outside silo

**Error:** `Tilt already running outside silo. Stop it first.`

- Stop the external Tilt process in this directory and retry.

## Profile Switch Requires --force

**Error:** `Profile change requires --force (current: X, requested: Y)`

- Re-run with `--force` when switching profiles:
  `silo up --profile <name> --force`

## Unknown or Missing Profile

**Error:** `Unknown profile: <name>` or `No profiles defined in config`

- Check `[profiles]` in `silo.toml`, or remove `--profile`.

## Missing Tools

**Error:** `tilt` or `k3d` not found

- Ensure required tools are installed and on your PATH.
