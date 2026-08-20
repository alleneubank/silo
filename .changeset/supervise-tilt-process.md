---
"@0xbigboss/silo": minor
---

Run Tilt under `janitor` so it cannot outlive the silo process that started it.

`silo up` forwarded SIGINT and SIGTERM to Tilt, but nothing covered the cases
where no handler runs: SIGKILL, SIGHUP when the controlling terminal closes, or
a silo crash. Tilt reparented to init and kept holding the instance's allocated
ports, and because silo allocates a distinct port per instance those orphans
never collided with a later `silo up` and accumulated unnoticed.

`janitor` is now a required tool, validated alongside `tilt` at the start of
`silo up`. Install it from https://github.com/alleneubank/janitor.

`tiltPid` in the lockfile is now the supervisor's pid; `silo status` and
`silo down` accept either the supervisor or tilt as the tracked process.
