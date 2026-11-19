# CLI commands

Use `silo help [command]` for options and `silo doc --list` for references.
`--config` selects a config (default `silo.toml`); `--verbose` adds diagnostics.

| Command | Behavior |
| --- | --- |
| `init` | Create starter config exclusively; refuse an existing file. |
| `env [name]` | Reserve all identities/files/ports atomically; export env and version-2 snapshot. Start no stack. |
| `up [name]` | Export, run hooks, prepare owned k3d if enabled, supervise Tilt in the foreground. Matching live up reuses it. |
| `ci [name] [-- <tilt args>]` | Same preparation with supervised `tilt ci`; set `CI=true`. Record finished owned producers even on failure and retain their resources for down. |
| `down` | Stop verified recorded Tilt groups; record finished owned producers before deletion, including stopped live up; remove receipted Compose containers/networks by exact ID. Retain clusters, Kubernetes workloads and claims. No Tiltfile evaluation or teardown hooks. |
| `down --delete-cluster` | Also delete exact owned cluster objects. No name-wide adoption or deletion. |
| `down --clean` | Retire only after all requests/groups/resources/listeners are proved absent; delete receipted snapshots and release own claims. |
| `status [--json]` | Read authoritative ownership without repair. Supervisor liveness is not Tilt resource health. Lists host-wide slot holders and waiters. |
| `run [--slot <name>]... [--wait <dur>] [--timeout <dur>] -- <cmd>` | Wait first in, first out for one unit of every named slot, run `on-acquire` then the command in one supervised group, release when it ends. `--timeout` stops the whole group at a deadline (exit 124). Without `--slot`, no config, store or queue. No project lock, generation or Docker. |
| `profiles` | List configured profiles. |
| `doc [topic]` | Print bundled reference; `--list` or `--json` discovers topics. |
| `version` | Print CLI version. |

`env`, `up` and `ci` accept `--profile` and `--force`. Profile resolution is
flag, `SILO_PROFILE`, stored profile, then base. `--force` reconfigures only a
stopped, reconciled generation; live, retained or uncertain state refuses.
Use separate roots and names for parallel stacks. Omitted names reuse the
stored name or generate a bounded unique candidate for a new root.

The same configuration can restart within its generation with down between runs:
`ci`, `down`, `ci`,
then `down --clean`. Old immutable-ID receipts remain audit history while the
new creation result records fresh IDs under the same names. k3d supports the
corresponding `ci`, `down --delete-cluster`, `ci` loop. Explicit cluster deletion
removes its directly created, durably receipted image cache after exact executor
validation and an all-container reference check. Restarts record a fresh token
while retaining prior cache history. Ordinary down retains cluster and cache.
This loop does not qualify Compose's in-place service rebuild/recreate: inherited
anonymous data can survive and require independent owner resolution.

Finite creating tools, including k3d network/volume/cluster creates, hooks and
Tilt CI, record labelled outputs before reporting a known failure. Down also
records a finished producer after importing its completion. Recording is sealed
before the first deletion. A cleanup retry
cannot adopt a same-name replacement from that old launch. Missing producer facts
or unsupported provenance still refuse. A terminal exact-ID delete can instead
resolve through verified target absence; status reports `phase: resolved`,
`resolution: target-absent`, `exitCode: null` when its completion fact was lost.
Unknown creates and untargeted commands cannot use that proof. Resources in status
include historical receipts with `deleted: true` for recorded absence and false
for active receipts. The flag is stored knowledge; use immutable IDs for a fresh
physical-presence check. At the 1024-launch limit, terminal reconciled launch and
completion history can be compacted while uncertainty and resource history remain.

Project commands create and keep the SQLite store at format 3, the format
silo 1.0.0 uses. The first `silo run` on the host adds the slot tables in place
and raises the store to format 4, with no downgrade. After that, silo 1.0.0
refuses the store with `LEASE_STORE_UNAVAILABLE: cannot open …; allocation
refused`, including `status` and `down` of stacks it started: that message
means a newer silo upgraded the store, and the fix is to upgrade silo, not to
delete the store. Read-only status reads a format-3 store as holding no slot
runs.
Format-1 and format-2 stores refuse without migration/reset; format-2 clients
also refuse format 3. Drain the matching old proposal and resolve its resources
before owner-led recreation.

## Slots and `silo run`

```text
silo run [--slot <name>]... [--wait <duration>] [--timeout <duration>] [--kill-after <duration>] [--json] -- <command> [args...]
```

A slot is a host resource several projects share, such as a simulator, an
emulator or a GUI session. The project declares what isolation each slot needs
in `silo.toml` (`[slots.<name>]`: `cap`, `env`, `on-acquire`, `ports`; see
`silo doc config`), including a default `cap`, so a new host needs no setup.
A host operator may override any cap in `<account home>/.silo/host.toml`,
resolved through the native account home like the store:

```toml
[slots]
ios-simulator = 1   # this host takes one simulator, whatever projects declare
gui-session = 0     # this host has no GUI session
```

A slot's cap comes from, in order:

1. the host file's entry, up or down; `0` turns the slot off on this host;
2. otherwise, when the requesting project declares a default for this OS, the
   smallest default among the requesting run and every run holding or waiting
   for the slot, so one project cannot push the host past what another queued
   project declared;
3. otherwise none: `run` refuses with `SLOT_UNAVAILABLE` (exit 2) before any
   effect, naming the slot, the `silo.toml` and the host file.

A `--slot` name the project does not declare also refuses with
`SLOT_UNAVAILABLE`. `silo status` shows each slot's cap and its source
(`host`, `project`, or `project (smallest of N)`); `--json` adds `capSource`,
`hostFile` and `projectCaps` (`[{ root, cap }]`); `cap` is `0` for a slot the
host turned off and `null` for one nothing caps. A host-file `0` is new: silo
1.2.0 rejects a host file containing it, for every slot, so upgrade every
silo on the host before writing one.

`run` joins the queue with one durable ticket and waits. Tickets are granted
first in, first out: a run takes a unit of a slot only while more units are
free than earlier waiters need from it. Several slots are granted together in
one transaction or not at all, so two runs naming the same slots in opposite
orders cannot deadlock. Waiting holds nothing. While waiting, `run` prints
which slot and holder it waits on, once and again when that changes. `--wait`
bounds the wait (`500ms`, `30s`, `5m`, `2h`; a bare number is seconds); when it
runs out, `run` leaves the queue and exits 75 with `SLOT_WAIT_TIMEOUT` naming
the slot and its holders. Without `--wait` it waits until granted or signalled.

On grant, `${slot}` is the unit index (`0 .. cap-1`, stable per unit), and a
slot with `ports = N` holds a contiguous block of N host ports, `${ports.0}`
to `${ports.N-1}`. Port blocks share the `host-port` domain with every
generation's port claims and come from outside the kernel's live ephemeral
range. Each `on-acquire` step then runs with `/bin/sh -c` in the project root
with the slot env, followed by the command, in one Janitor-supervised process
group. A failing step stops the run: the command never starts, the units are
released, and `run` exits with that step's status and `SLOT_ACQUIRE_FAILED`
naming the step and the tail of its stderr. There is no `on-release`: reset on
acquire also covers a holder killed with SIGKILL.

`run` exits with the command's status. Without `--json`, a command that itself
exits 2 or 75 is indistinguishable from `SLOT_UNAVAILABLE` or
`SLOT_WAIT_TIMEOUT` by status alone; use `--json` (an error has `code`, a
result has `run.exitCode`) when that matters. The command's stdin is not
connected. SIGINT or SIGTERM leaves the queue while waiting, or stops the whole
group while running, and exits 130 or 143. The command runs in its own process
group, so a terminal's Ctrl-C reaches it as Janitor's SIGTERM to the group,
followed by SIGKILL after the `--kill-after` grace (5 seconds by default), not
as SIGINT.

The host file is re-read and caps resolved on every grant attempt, so lowering
a cap applies to runs already queued; units already held above the new cap stay held until released.
A waiter that cannot prove a holder gone (permission denied, or an unreadable
identity) keeps waiting and says so once. Each waiting pass also releases, under
the same proof, up to eight rows of other slots whose `silo run` process is
gone, so a crashed run of a slot nobody requests does not hold its port block
forever. The executor retries recording the command's completion within a
bound while the store is busy; if it still cannot, the run keeps the command's
exit status from the supervisor. Legacy registry state (`LEGACY_STATE`) refuses
a run only when a requested slot declares `ports`. Waiting costs one store
transaction plus one `ps` per live contending holder per poll, polled at most
once a second; with many contenders a handoff can take up to a second. Units are released by the run once its
supervisor has exited on its own and its group has no member; otherwise the
run fails with `RUN_STOP_INCOMPLETE` and they stay held (see below). A later `run` contending for the same
slot releases a holder once its recorded processes are proved gone (`ESRCH`,
or a start identity that differs from the recorded one) and its group has no
member; uncertain liveness keeps the claim. It also drops the ticket of a
waiter that is gone. No expiry or force takeover exists.

`run` does not take the project's operation token: several runs from one root
proceed concurrently, bounded only by caps. It needs no generation, env file,
Tilt or Docker. With `--json`, the command's stdout goes to stderr and stdout
carries one schemaVersion-1 result:

```json
{"schemaVersion":1,"run":{"id":"…","root":"/repo","command":["./e2e.sh"],
 "slots":[{"slot":"phone-ports","unit":0,"ports":[49140,49141]}],
 "waitedMs":1520,"exitCode":0,"timedOut":false,"released":true}}
```

### Deadlines and runs without slots

`--timeout` bounds a run from its grant: every `on-acquire` step and the
command, not the time spent waiting for slots (`--wait` bounds that). It takes
the same durations as `--wait`, from 1 second to 7 days. At the deadline silo
stops the command's process group, children and grandchildren included, and,
through Janitor, the descendants that left it with `setsid` that Janitor proves
still descend from the command: SIGTERM, then SIGKILL after the grace. It then releases its slots as
after any exit and exits 124, like coreutils `timeout`; with `--json`,
`run.timedOut` is `true` and `run.exitCode` is 124. A process that double-forks
and calls `setsid` before the deadline is no longer a descendant and escapes.

`setsid` descendants are reached only by a stop (deadline or interrupt). When
the command exits on its own, its executor is already gone by the time Janitor
drains, so a `setsid` descendant it left behind is never signalled, and the run
still releases its slots and reports the command's status while that process
lives. This is a documented escape: a command that starts a daemon with
`setsid` must stop it itself.

The deadline counts as a timeout only if the command is still running when it
passes. A command that exits first keeps its own status, even while left-over
members of its group are still being drained. Whichever comes first, the
command's exit, the deadline or a Ctrl-C, decides; a later signal does not
change the outcome.

`run` reports a stop only once Janitor has exited on its own and the command's
process group has no member. If Janitor is killed, or does not finish draining
within the grace plus 5 seconds, silo kills it and stops the group itself:
SIGTERM, the grace, then SIGKILL, and only while the command's executor is
still running, since its life is what keeps the group ID from naming another
group. Without Janitor, silo cannot prove that descendants which left the group
with `setsid` are gone. Every such end, and any group that still has members,
fails with `RUN_STOP_INCOMPLETE` (exit 1) instead of a result: `--json` names
the `cause` (`exited`, `timed-out`, `interrupted`) and the `reason`
(`supervisor-lost`, `leader-exited`, `group-survived-kill`,
`group-outlived-supervisor`, `liveness-unknown`), and any slots stay held
until a later run proves the group gone. `run` notices the executor's exit even
when Janitor is stalled and has not reaped it, with or without `--timeout`, so
a stalled Janitor never holds a run open. Each `ps` read silo makes during a
run runs in its own process group, so a Ctrl-C to the caller's group cannot
end it; a read that fails or is killed is retried, and if the executor's state
stays unreadable the run reports `liveness-unknown` rather than guessing.

`--kill-after` sets the grace between SIGTERM and SIGKILL for every stop of the
group: a deadline, an interrupt, or the drain of members left behind after the
command exits. It takes 1 second to 10 minutes and defaults to 5 seconds. The same grace
applies when Janitor is lost and silo signals the group itself. How long `run`
waits for a stopped group follows it: the grace plus 5 seconds.

Without `--json`, a command that itself exits 124, 130 or 143 looks the same
by status as a timeout or an interrupt; use `--json` (`run.timedOut`, or an
`INTERRUPTED` error) when that matters.

Unlike wrapping the command in `timeout -k`, which moves it into a new process
group, `silo run` itself stays in its caller's group: a terminal's Ctrl-C or a
task runner's signal to its group reaches silo, which stops the command's group
and exits 130 or 143. SIGHUP ends silo itself; Janitor then drains the group,
and a later run releases any slots it held.

With no `--slot`, `run` is a plain supervised run: it reads no `silo.toml` or
host file and opens no store, so it needs no slots, caps or Docker. The command
runs in the directory of `--config` (the current directory by default), and
`--wait` is refused because there is nothing to wait for. Task runners can wrap
every task the same way:

```bash
silo run --timeout 20m -- zig build test
silo run --slot ios-simulator --wait 30m --timeout 1h -- ./e2e.sh
```

`status` (and `status --json` under `slots.list`) lists each capped or queued
slot with its cap, holders (unit, root, command, silo run PID, group, since) and
waiter count. An unreadable host file or slot queue is reported in
`slots.problem` (`code`, `message`) and never fails the project status or the
JSON result of `env`, `up`, `ci` or `down`. A holder whose recorded processes are gone but whose row a
contender has not yet released shows `ended (releasing)`; status never
releases it.

`ci --timeout 300s` forwards the timeout. Passthrough cannot override managed
listener ports/hosts or an explicit web mode. `env`/`ci --export-ci` require
`GITHUB_ENV`; automatic CI export warns and skips if it is absent. The sink
must be a separate append-only target and cannot alias a generated file.

`--json` lifecycle responses carry `schemaVersion: 1`, `legacy`, `changed`
and the current project. Errors carry a stable `code` and message, with
read-only listings for `LEGACY_STATE`. Diagnostics go to stderr.

Interrupting `up`, `ci` or `down` with SIGINT or SIGTERM exits 130 or 143
and names `status` and `down` as the next steps. With `--json`, it returns one
`INTERRUPTED` error with a top-level `signal` field. The first interrupt stops
`up` during hooks, k3d setup or Tilt using the same owned-group stop deadline.
Claims and receipts remain for recovery; an interrupted Docker probe does not
establish resource absence or diagnose an engine failure. `ci`'s supervisor
drains its recorded group after the CLI exits. Run `status` and `down` to
reconcile retained ownership, then retry any interrupted cleanup.
A signal after final JSON emission starts preserves that result and its exit status.
Normal JSON output handles pipe backpressure for up to 30 seconds. During that
flush, interrupts preserve the selected result. A reader stalled longer than
30 seconds gets a nonzero exit; a failed output stream receives no second object.

Status preserves stored fields under `project`. Separate `launchStatus` entries
report `launchId`, observed `state`, `groupsAbsent` and a provenance-checked
`completion` (or null). A dead recorded group is `terminated` if its result is
unknown, or `completed` when its durable result exists. Stored exits and terminal
facts remain known even after PID reuse. `unconfirmed` means no process group
was recorded; `live-or-unknown` proves neither completion nor readiness.
`groupsAbsent` is a fresh observation, not a change to the stored terminal flag.
`operationOwnerAbsent` identifies a dead recorded CLI owner. `cleanupRequired`
also reflects unreconciled completed/terminated launches and stored cleanup
problems; inspect a live `project.operation` before attempting recovery.
Status never imports facts into ownership or releases claims; `down` does that.
A fact whose provenance conflicts with its grant refuses with
`COMPLETION_PROVENANCE_MISMATCH`; ownership remains retained.

Launch identity observations share a 30-second startup budget, capped at the
finite command's run budget, followed by the durable grant checkpoint. The
executor waits up to 45 seconds for that grant. The command's execution timer
still starts after grant. Status text, `up` and `down` allow up to 30 seconds
per recorded supervisor identity check under load.

`doc` embeds the Markdown references in every build. Topic output works when
the JavaScript bundle or standalone executable is copied outside the repository.

`env`, `up`, `ci`, `down` and `status` run the host-wide legacy refusal before
store, file, directory or tool effects. Follow `silo doc ports` for the
mandatory host cutover procedure; there is no migrate operation.
