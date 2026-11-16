# Design: host slots and `silo run`

Status: **approved by the owner 2026-11-16T01:11Z** (question tool: "Approve both (Recommended)"): `silo run`, slots, host caps at `<account home>/.silo/host.toml`, allocation without Docker, and the release-rule SPEC amendment as drafted. Nothing here is built.
Drafted 2026-11-15 from `origin/main` 2257097 (silo 1.0.0). Approval of this
record authorizes the build PR; the SPEC amendment in [Release rule](#release-rule-spec-amendment)
is the owner's separate decision, and silo's own release gates (matching
specialist review, native Linux and macOS rehearsal) still apply to the
release.

## Ask

Approve four things, each answerable on its own:

1. **`silo run` and slots** as specified below: a command runs only while it
   holds one unit of each named slot; per-host caps; `on-acquire` before the
   command; env injected for isolation; `status` names holders and waiters.
2. **The release rule amendment.** A slot is held for the life of its run's
   process group and released, by the run itself or by a later waiter, once
   that group is proved absent. This contradicts SPEC "Inspections never
   expire, release, repair or garbage-collect peer state" for this one claim
   kind.
3. **Allocation without Docker** for a config that declares no Docker-backed
   feature.
4. **Where host caps live and who sets them** (recommended:
   `<account home>/.silo/host.toml`, set by the host's operator; slot names
   come from the shared agent-profile vocabulary).

## Why

op-forward's merge gate grew about 3,100 lines of project-written machinery,
roughly 21 of its 76 traced mechanisms (locks, leases, ports, private caches)
exist only because several gates share one host, and 8 more manage simulators.
The owner's direction (2026-11-15): Moon decides whether a check runs, silo
decides where and when it runs, and a project only declares — tasks and inputs
in `moon.yml`, needs in `silo.toml`. The owner compared slots to "extensions
and lifecycles". Every repository the owner's agents drive is meant to use the
same two tools, so the slot vocabulary is shared across projects.

## Users and their tasks

| User | Task | What they need from silo |
| --- | --- | --- |
| A Moon task (agent-driven gate or hook) | Run one check that needs a host resource | Block until a unit is free, get an isolated identity in env, run, exit with the command's status |
| An agent watching a gate | Know why a gate is waiting | `silo status` names the slot, its holders (root, command, PID, since) and the queue |
| A host operator | Bound how many simulators, emulators or GUI runs a host takes | One host file of caps; no per-project setting can raise them |
| A project author | Say what isolation a resource needs | `[slots.<name>]` in `silo.toml`: env to inject and an `on-acquire` reset |

## Surface

### Project config (`silo.toml`)

```toml
[slots.ios-simulator]
env = { OPF_SIM_DEVICE = "opf-slot-${slot}" }
on-acquire = ["./scripts/acquire-simulator.sh"]

[slots.phone-ports]
ports = 6                       # a block of host ports claimed for the run
env = { OPF_E2E_PHONE_PORT_BASE = "${ports.0}" }
```

- `${slot}` is the unit index, `0 .. cap-1`, stable per unit so a reset can
  find what the previous holder left (for simulators: the device named
  `opf-slot-1`).
- `ports = N` claims N host ports through the existing `host-port` domain and
  native bind check for the run's life; `${ports.i}` interpolates them. The
  block must come from outside the kernel's live ephemeral range
  (`net.inet.ip.portrange.first..last` on macOS, 49152-65535 on aem5;
  `net.ipv4.ip_local_port_range` on Linux), read at allocation. silo's
  existing fallback range, 49152-65535, is exactly macOS's ephemeral range:
  op-forward #468 was phone ports taken by SSH masters' kernel-assigned
  forwards there. A bind probe passes at allocation and loses later.
  The owner decided (2026-11-16, "Everywhere (Recommended)") that the same
  rule applies to every silo port allocation, `env`/`up` fallback included,
  for new allocations only; existing generations keep their published ports.
- `on-acquire` runs after the unit is granted and before the command, in the
  project root, with the injected env, under the same supervised group. It
  must reset the unit to a known state whatever the previous holder left.
  There is deliberately no `on-release`: silo already rejects teardown hooks,
  and a reset on acquire also covers a holder killed with SIGKILL.
- A project may only name slots that exist in the host file's vocabulary.

### Host caps (`<account home>/.silo/host.toml`)

```toml
[slots]
ios-simulator = 2
android-emulator = 1
gui-session = 1
docker-e2e = 1
disk-image = 1
phone-ports = 4
```

Resolved through the native account home, like the store, independent of
`HOME`. No cap means the slot is unavailable on this host: `silo run` refuses
with `SLOT_UNAVAILABLE` naming the slot and the file, before any effect. No
default cap and no per-project override, so a typo or a new host never
silently runs unbounded.

### Command

```text
silo run --slot <name> [--slot <name> ...] [--wait <duration>] [--json] -- <command> [args...]
```

1. Validate config and host caps; refuse unknown slots.
2. Join each named slot's queue (one durable row per run, FIFO by ticket).
   Multiple slots are granted together in one `BEGIN IMMEDIATE` transaction,
   all or none, so two runs needing the same pair cannot deadlock.
3. While waiting, print once which slot and which holder it waits on, and
   again only when that changes. `--wait` bounds the wait (exit
   `SLOT_WAIT_TIMEOUT`, 75); with no `--wait`, it waits until granted or
   signalled. Waiting holds nothing.
4. On grant: claim the unit(s) and any port block, owned by the run's launch
   record; inject env; run each `on-acquire` in order. A failing `on-acquire`
   stops the run: the command never starts, the units are released, and the
   exit status is `on-acquire`'s with a `SLOT_ACQUIRE_FAILED` message.
5. Run the command as a Janitor-supervised process group (the existing
   `owned_command` path). Exit with its status. SIGINT/SIGTERM go to the whole
   group, as for `up` and `ci`; exit 130/143.
6. Release the units when the group is proved absent (below).

`silo run` is not a project lifecycle operation: it does not take the
project-wide operation token, so several runs from one root (Moon running
tasks in parallel in one worktree) proceed concurrently, each bounded only by
caps. It needs no generation, `env`, Tilt or Docker.

### Status

`silo status` (and `--json`) gains a `slots` section, read-only as today:

```text
slot            cap  held  holder                                               since     waiting
ios-simulator   2    2     #0 ~/Work/.../op-forward-r680  pid 74579  moon ...   21:11:04  1
                           #1 ~/Work/.../op-forward-r682  pid 4994   moon ...   21:20:31
gui-session     1    0                                                                    0
```

A holder whose group is gone but not yet released shows `ended (releasing)`;
status never releases it itself.

## Release rule (SPEC amendment)

Proposed SPEC text, a new section after "Lifecycle authority":

> **Slot claims.** A slot unit is claimed by one run's launch record and held
> while that run's supervised process group may exist. It is released by the
> run when its group is terminal, or by any later `silo run` contending for
> that slot once the holder's recorded supervisor is proved absent (`ESRCH`,
> or a start identity that differs from the recorded one) and its executor
> group has no member. Uncertain liveness keeps the claim. No expiry, TTL or
> force takeover exists. This is the only claim kind another process may
> release; "Inspections never expire, release, repair or garbage-collect peer
> state" continues to hold for every other domain, and `status` stays
> read-only for slots too.

Why release by a waiter is safe here: a slot unit carries no data the next
holder must not lose, and `on-acquire` resets the unit before use. Holding a
dead run's unit until a human runs `down --clean` is what op-forward's gate
did with stale locks, and it is the failure (a gate killed mid-simulator-run
blocks the next one) the owner wants gone.

## States

| State | What the caller sees | Next action it implies |
| --- | --- | --- |
| Granted immediately | command output only | none |
| Waiting | `waiting for ios-simulator (2/2 held; next: #0 r680 pid 74579)` | none; or `silo status` |
| Wait bounded out | exit 75, `SLOT_WAIT_TIMEOUT` naming slot and holders | retry later |
| Slot unknown or not capped here | exit 2, `SLOT_UNAVAILABLE` naming slot and host file | add a cap or run elsewhere |
| `on-acquire` failed | its exit status, `SLOT_ACQUIRE_FAILED` with the step and its stderr tail | fix the reset; unit already released |
| Command failed | the command's status | none from silo |
| Interrupted | 130/143, group signalled, units released once the group is gone | none |
| Holder SIGKILLed | next waiter proves absence, releases, proceeds | none |
| Liveness uncertain (`EPERM`, identity unreadable) | waiter keeps waiting and says why | operator inspects that PID |
| Store locked/corrupt | existing refusals | existing guidance |

## Allocation without Docker

`allocateProject` calls `captureEngine` unconditionally
(`src/core/allocation.ts:61`). Proposed: capture the engine only when the
resolved config declares a Docker-backed feature (Compose identities, k3d,
Tilt), and record `engine: none` in the generation otherwise. A config with
none of those allocates with Docker stopped. `silo run` never needs it.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| Keep op-forward's `ci_lock.py` leases and simulator pool | Project-written, about 3,100 lines plus 2,900 of tests and fakes; every repository would grow its own |
| `flock` held by the command's process | Released correctly on death, but Bun holding a lock across a child process group is unverified, it cannot show holders or queue, and it does not compose multiple slots atomically |
| Moon `mutex` | Does not hold across two Moon processes (observed 2026-11-15) |
| Expiring leases | An expiry wrong in either direction either blocks for its length or hands a live unit to a second holder |
| `on-release` teardown hook | Never runs after SIGKILL; silo already rejects teardown hooks |
| `simctl erase` as the simulator reset | Re-runs first-boot migration, which stalled past 180 s under load; delete-by-name, clone a migrated template, boot measured 10.1 to 15.7 s at load above 90 |
| A per-project cap | Lets one project exceed what the host can take; caps are the host's |

## Verification (build PR)

Driven through the built CLI on native macOS and Linux, in a disposable
account per the existing rehearsal rule:

- two commands contending for a cap-1 slot run one after the other;
- a holder killed with SIGKILL frees its slot for the waiter with no manual
  step, including a holder whose PID is reused by an unrelated process;
- `on-acquire` runs before the command, sees the injected env, and its failure
  prevents the command and releases the unit;
- two runs needing slots {A, B} and {B, A} on cap-1 slots both complete;
- `status` names holders and waiters and changes nothing;
- a config with no Docker feature allocates, and `silo run` works, with Docker
  stopped;
- interrupt during wait, during `on-acquire` and during the command: 130/143,
  no unit left held.

Then silo's release gates: matching specialist review (public API of a
published tool: high-risk), native Linux and macOS rehearsal records with
head, artifact digest, versions, scenarios and gaps.

## Not verified yet

- Whether Bun can observe a group's absence reliably on both OSes beyond what
  `owned_command` already proves for `up`/`ci`.
- Face ID enrollment after a clone boot; Android emulator slots; several
  simulator slots at once; a missing or half-prepared template. These are
  op-forward's `on-acquire` script's concerns, tested there.

## Open for the owner

None. Approved 2026-11-16: the design, the release-rule amendment, allocation
without Docker and the host file location; the port range and wait default
are in the decision log.

## Decision log

- 2026-11-16 (owner, question tool, on build PR #68): store "Format 4,
  upgrade in place (Recommended)": the first writable open upgrades a
  format-3 store to format 4; 1.0.0 clients refuse a format-4 store rather
  than allocate ports without seeing slot port blocks; no downgrade path;
  REQ-STORE-001's "no automatic migration" is amended; minor version bump.
  Legacy state "Only for slots with ports (Recommended)": `silo run` refuses
  on legacy `~/.silo/instances` state only when a requested slot declares
  `ports`.

- 2026-11-16T03:1xZ (owner, question tool): ephemeral-range exclusion
  "Everywhere (Recommended)": `silo run` port blocks and `env`/`up` fallback,
  new allocations only, in the slots build PR.
- 2026-11-16 (provisional, agent call under "no artificial cap"): no default
  wait bound; op-forward requires a Moon `options.timeout` on every task, which
  bounds a waiting `silo run` from outside. `--wait` stays available.

- 2026-11-16T01:11Z (owner, question tool): "Approve both (Recommended)": design and SPEC amendment approved. Still open: port blocks outside the ephemeral range for `env`/`up` too, and the wait default.

- 2026-11-15 (owner, ratified): slots live in silo; the project dictates what
  silo injects; per-host caps.
- 2026-11-15 (proposed here): no `on-release`; reset on acquire; FIFO,
  all-or-none multi-slot grant; caps only in the host file; `silo run` outside
  the project operation token.
