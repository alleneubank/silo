---
"@0xbigboss/silo": minor
---

Add host slots and `silo run --slot <name> [--wait <dur>] [--json] -- <cmd>`:
run a command while holding one unit of each named host slot. Projects declare
`[slots.<name>]` (env, on-acquire, ports) in silo.toml; host operators cap
slots in `<account home>/.silo/host.toml`. Grants are first in, first out and
all-or-none across slots; units are released when the run's process group
ends, or by a later run once the holder is proved gone. `silo status` lists
holders and waiters.

New port allocations, including the env/up fallback and declared defaults,
stay outside the kernel's live ephemeral range. Existing generations keep
their ports.

Upgrade note: the first `silo run` on a host upgrades the account store from
format 3 to format 4 in place, with no downgrade. silo 1.0.0 then refuses the
store with `LEASE_STORE_UNAVAILABLE: cannot open …; allocation refused`, even
for `status` and `down`; that message means a newer silo upgraded the store.
Upgrade every silo on the host before the first `silo run`. Project-only use
leaves the store at format 3.
