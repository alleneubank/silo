---
"@0xbigboss/silo": minor
---

Add `silo run --timeout <dur>` and runs without slots. `--timeout` bounds a
run from its grant (on-acquire and the command, not the slot wait): at the
deadline silo sends SIGTERM to the command's whole process group, SIGKILL
after the grace, releases its slots and exits 124; `--json` reports
`run.timedOut`. `--kill-after <dur>` sets the SIGTERM-to-SIGKILL grace for
every stop (default 5s). `--timeout` takes 1s to 7 days, `--kill-after` 1s to
10m. `silo run` stays in its caller's process group, so Ctrl-C or a group
signal still stops the command (exit 130/143), unlike wrapping it in
`timeout -k`. `--slot` is now optional: a run without slots reads no
silo.toml, opens no store and needs no Docker, so task runners can give every
task a deadline that ends its whole process tree.
