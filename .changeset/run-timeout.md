---
"@0xbigboss/silo": minor
---

Add `silo run --timeout <dur>` and runs without slots. `--timeout` bounds a
run from its grant (on-acquire and the command, not the slot wait): at the
deadline Janitor sends SIGTERM to the command's whole process group and the
`setsid` descendants it proves, SIGKILL after the grace; silo releases its
slots and exits 124, and `--json` reports `run.timedOut`. A command that exits
before the deadline keeps its own status. `--kill-after <dur>` sets the
SIGTERM-to-SIGKILL grace for every stop (default 5s). `--timeout` takes 1s to
7 days, `--kill-after` 1s to 10m. `silo run` stays in its caller's process
group, so Ctrl-C or a group signal still stops the command (exit 130/143),
unlike wrapping it in `timeout -k`. `--slot` is now optional: a run without
slots reads no silo.toml, opens no store and needs no Docker, so task runners
can give every task a deadline that ends its whole process tree.

A run now reports a stop, a timeout, an interrupt or a release only once
Janitor has exited on its own and the group has no member. If Janitor is
killed or stalls, silo stops the group itself and fails with
`RUN_STOP_INCOMPLETE` (exit 1, with `cause` and `reason`), keeping any slots
held; this replaces the `released: false` result of 1.1.0.
