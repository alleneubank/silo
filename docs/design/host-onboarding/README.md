# Design: host onboarding for slots, and a legacy cutover that does not strand hosts

Status: **approved by the owner 2026-11-18** (question tool: "Approve (Recommended)" for the cap design; "Classify only (Recommended)" for the legacy cutover). Drafted 2026-11-18 from
`origin/main` e8a2c14 (silo 1.2.0). Amends [slots](../slots/README.md),
approved 2026-11-16.

## Owner decision

Allen, 2026-11-18, in conversation:

> "We forgot to onboard the hosts. silo should handle this automatically for
> users per-project, optionally per-host."

This reverses part of the slots design: "Caps live only in
`<account home>/.silo/host.toml` ... No default cap and no per-project
override, so a typo or a new host never silently runs unbounded." The
protection that motivated that rule stays: an unknown or typo'd slot still
refuses, and nothing runs unbounded.

## Why

op-forward declares six slots and pins silo 1.2.0. On aem5,
`~/.silo/host.toml` had never been written, so five gate tasks failed with
`SLOT_UNAVAILABLE: slot 'disk-image' is not capped on this host` and a
pre-push gate blocked a push. Nothing told the operator a new host needed the
file until a gate failed; pixelproton's was written by hand on 2026-11-16 and
aem5's on 2026-11-18. The caps a project needs were documented only in
op-forward's README, which every host operator had to copy.

Separately, silo 1.x refuses allocations while any 0.x
`~/.silo/instances/*.json` exists. On aem5, six entries survived their
projects' own 0.8.1 `down --clean` because they were registered under
`/Users/allen/0xbigboss/...`, since replaced by a symlink to
`/Users/allen/alleneubank`. 0.x keys an entry by the SHA-256 of the realpath of
its root at registration, so after the move its `unregister` computes a
different key and silently removes nothing. `LEGACY_STATE` listed those
entries with the same advice as live ones (run the project's own `down`),
which could not work.

## Users and their tasks

| User | Task | What they need |
| --- | --- | --- |
| A project author | Ship a project whose gate runs on any host the project's agents use | Declare a default cap per slot, per OS, in `silo.toml` |
| A host operator | Run a fresh host with no setup; lower or raise one slot for this machine; turn one off | Nothing by default; an optional host file whose entries win |
| An agent whose run waits or refuses | Know what cap applied and where it came from | `silo status` and the refusal name the cap's source |
| An operator cutting a host over from 0.x | Clear every legacy entry, including ones no 0.x `down` can reach | `LEGACY_STATE` says, per entry, which next step works |

## Part 1: caps

### Project default

```toml
[slots.ios-simulator]
cap = { macos = 2 }              # unavailable on Linux unless a host file caps it
env = { OPF_SIM_DEVICE = "opf-slot-${slot}" }

[slots.docker-e2e]
cap = { macos = 2, linux = 1 }

[slots.disk-image]
cap = 1                          # same on every OS
```

- `cap` is an integer 1..64, or a table with `macos` and/or `linux` keys
  (other keys refuse as `INVALID_CONFIG`). A missing key for the current OS
  means no project default on that OS.
- `cap` is optional. A slot with no default here and no host entry refuses as
  today.
- There is no "unlimited" value; every effective cap is an integer at most 64.

### Host file (optional)

```toml
[slots]
ios-simulator = 1    # this host: one simulator, whatever projects declare
gui-session = 0      # this host has no GUI session: refuse
```

- An entry wins over every project default for that slot, up or down.
- `0` is new: the slot is unavailable on this host (`SLOT_UNAVAILABLE`,
  naming the host file). Before this change a host could only omit a slot.
- No file, or no entry for a slot, means project defaults apply.

### Precedence and conflicts

Effective cap of a slot, decided inside each grant transaction:

1. The host file entry, if present (re-read for every grant attempt, as today).
2. Otherwise, the **smallest** project default among the requesting run and
   every run that holds or waits for that slot (each queued run records the
   default its project declared when it enqueued).
3. Otherwise unavailable: `SLOT_UNAVAILABLE` before any effect.

So two projects declaring `ios-simulator` 2 and 1 run at most one simulator
while any run of the cap-1 project is queued or holding, and two once only the
cap-2 project's runs remain. A project never pushes the host past what another
active project declared. Lowering never revokes a held unit: units at or above
the cap still count as held, as today.

### Why the old protection still holds

| Old risk | Now |
| --- | --- |
| `--slot` typo | Refuses: the name must be declared under `[slots.<name>]` in the project (unchanged) |
| Typo'd slot name in `silo.toml` | It is its own slot with its own declared cap; bounded, and visible in `status` under that name with its source |
| New host runs unbounded | Every grant uses a finite cap from the host file or a project default; no default means refuse |
| One project raises the host's load | Smallest active default wins; only the host file can raise above it |

### Status

```text
Slots (host-wide):
slot             cap  source                     held  holder                                   since      waiting
disk-image       1    project                    0                                                         0
docker-e2e       2    project                    1     #0 ~/Work/.../op-forward-r680  pid 74579 21:11:04Z  0
gui-session      0    host ~/.silo/host.toml     0                                                         0
ios-simulator    1    project (smallest of 2)    1     #0 ~/Work/.../op-forward-r682  pid 4994  21:20:31Z  1
phone-ports      none none                       0                                                         0
```

Slots listed: every host-file entry, every slot a queued run names, and every
slot the current project's `silo.toml` declares. `--json` adds per slot
`capSource` (`"host"`, `"project"` or `null`), `hostFile` when the source is
the host, and `projectCaps`: `[{ root, cap }]` for each contributing project
default (the current project's included). Status stays read-only.

### Refusal text

```text
SLOT_UNAVAILABLE: slot 'disk-image' has no cap on this host (linux). Add `cap = <n>` under [slots.disk-image] in /path/silo.toml, or `disk-image = <n>` under [slots] in /home/u/.silo/host.toml
SLOT_UNAVAILABLE: slot 'gui-session' is turned off on this host (gui-session = 0 in /home/u/.silo/host.toml)
```

### Compatibility

- `cap` in `[slots.<name>]` is new config. silo 1.2.0 rejects it
  (`[slots.*]` is strict), so a project adding `cap` must pin this release.
- The queued-run receipt gains an optional `cap` per request. silo 1.2.0
  parses and ignores it; 1.2.0 runs record none and contribute nothing to the
  smallest-default rule. A 1.2.0 run on a host with no host entry refuses as it
  does today, so mixed versions never exceed a host entry.
- No store format change.
- aem5's and pixelproton's hand-written host files keep working unchanged
  (host entries win). Once op-forward declares `cap`, an operator may delete
  entries equal to the project default; silo does not edit or remove the file.

## Part 2: legacy cutover

### Classification in `LEGACY_STATE`

For each legacy registry entry with a recorded root, silo (read-only) decides
whether that project's own 0.x `down` can remove it: 0.x removes
`sha256(realpath(root)).json`.

| Finding | Test | Next step printed |
| --- | --- | --- |
| reachable | `realpath(root)` exists and its hash is the file name | Stop it with that project's own silo 0.x (`silo down --clean` in the root), then upgrade the project's silo |
| moved | the root resolves to a different path (symlink or move) | No 0.x `down` can remove this entry. If it is not in use, delete the file by hand |
| root missing | the root does not exist | Same as moved |
| unrecognized | not a 0.x entry | Unchanged |

Liveness stays the operator's call: silo still does no attribution and deletes
nothing. The finding's recorded ports and PIDs (already in `--json`
`details.found`) are printed alongside so the operator can check them.

### Projects still on 0.x

The `LEGACY_STATE` message ends with: any project whose `silo` still resolves
0.x recreates this state on its next `up`; upgrade it before the host's next
allocation (`silo version` in its root). `docs/troubleshooting.md` gains a
host cutover checklist: list entries, stop reachable ones with their own 0.x,
remove moved/missing ones by hand, upgrade each project's and the global silo,
then allocate.

### Proposed, not built without approval

- **A. `silo legacy forget <entry>`**: deletes one moved or root-missing entry
  after proving its recorded PIDs absent and its ports unbound. Reverses the
  1.0 rule "No migrate command, import or recreate helper exists." Recommended
  **not** to build: the cutover is one-time per host, the classification
  makes the manual step safe, and 2 hosts remain.
- **B. silo 0.9.1**: `unregister` also removes the entry keyed by the stored
  root; `up` warns when a 1.x store exists on the host. Recommended **not** to
  publish: projects pin exact 0.x versions (press pins 0.5.9 in mise), so a
  patch reaches few of them; upgrading their pins is the fix. Unpinned
  projects (sox, team-hub) use the host's global silo, 0.8.1 on aem5
  (`bun install -g`), which the host cutover upgrades.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| silo writes `~/.silo/host.toml` from the first project's defaults | Silently freezes one project's numbers as host policy; first writer wins every later conflict; edits an operator file |
| Each run uses only its own project's default | Simple, but a cap-2 project lets the host take two simulators while a cap-1 project assumed one |
| Largest default wins | Lets any project raise the whole host's load |
| Refuse when projects disagree | A gate fails because an unrelated project is queued; the conflict is not the caller's to fix |
| One `cap` with no per-OS form | op-forward documents different Linux caps (`docker-e2e = 1`) and macOS-only slots |
| Host file `0` not added | A host could only refuse a slot by omitting it, which now means "use the project default" |

## Verification (build PR)

- Unit: cap resolution (host wins, smallest active default, OS table, `0`,
  none); grant decisions with mixed defaults; legacy classification for
  reachable, symlinked, moved and missing roots.
- Built CLI on native macOS (aem5) in a disposable account home and project:
  no host file, project defaults apply; host entry lowers and raises; `0`
  refuses; two projects with defaults 2 and 1 contend; `status` text and
  `--json` show sources; a legacy entry under a symlinked root is classified
  moved.
- Linux: same scenarios in a Linux container with the built artifact (gap if
  native Linux is unavailable, recorded).
- Specialist review (public config/API contract) before merge.

## Decision log

- 2026-11-18 (owner, in conversation): projects declare default caps; an
  optional host file overrides. Quote above.
- 2026-11-18 (owner, question tool: "Approve (Recommended)", "Classify only (Recommended)"): host entry wins; otherwise smallest
  active project default; `cap` integer or `{ macos, linux }`; host `0` turns a
  slot off; legacy findings classified reachable/moved/root-missing with no
  deletion; options A and B not built.
