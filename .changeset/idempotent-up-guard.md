---
"@0xbigboss/silo": minor
---

`silo up` no longer starts a duplicate stack when one is already live.

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
