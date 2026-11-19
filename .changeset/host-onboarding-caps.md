---
"@0xbigboss/silo": minor
---

Projects can now set a default cap per slot, so a new host runs `silo run`
with no setup. Add `cap = <n>`, or `cap = { macos = <n>, linux = <n> }`, under
`[slots.<name>]` in silo.toml. `<account home>/.silo/host.toml` becomes
optional: an entry there overrides every project default on that host, up or
down, and the new value `0` turns a slot off. Without a host entry, the
smallest default among the projects queued for the slot applies. A slot with
no cap from either source still refuses with `SLOT_UNAVAILABLE`, which now
names both places to set one. `silo status` shows each slot's cap source
(`--json`: `capSource`, `hostFile`, `projectCaps`).

`cap` is new in silo.toml and silo 1.2.0 rejects it: a project that adds it
must require this release. Existing host files keep working unchanged.

`LEGACY_STATE` now says, for each silo 0.x registry entry, whether that
project's own 0.x `down` can remove it. An entry whose root moved or became a
symlink, or no longer exists, cannot be removed by any 0.x `down`; the listing
says so and names the recorded ports and PIDs to check before deleting it by
hand. silo still deletes nothing.
