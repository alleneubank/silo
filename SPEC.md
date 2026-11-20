# silo specification

Silo coordinates ephemeral Tilt/k3d development projects on a shared local
host. Its allocation domain is one operating-system account and one local
Docker engine. It prevents accidental collisions, peer cleanup and unsafe
reuse during crashes. Trusted local users, config, hooks and tools are the
threat model; malicious same-account writers and other hosts/accounts are
outside it. Silo does not create a private runtime, network daemon or proxy.

## Atomic allocation

The authoritative store is `<native-account-home>/.silo/leases.sqlite`,
independent of invoking `HOME`. The qualified Bun 1.4.4 runtime was observed
to make `os.userInfo().homedir` follow HOME, contrary to its documented API;
the implementation queries `getent passwd <effective-uid>` on Linux and
`dscacheutil -q user -a uid <effective-uid>` on macOS, refusing missing or
ambiguous answers. SQLite rollback journaling, full synchronous
writes, foreign keys and bounded busy waits protect local durable state.
Unknown schemas, corruption, missing expected state and failed queries refuse;
there is no empty-store fallback. Runtime CLI/env store overrides do not exist.
Tests inject a private constructor store or run in a disposable OS account.

Project-only use creates and keeps stores at format 3, the released format.
The first `silo run` on the host adds the slot tables to the store in place, in
one transaction, and raises it to format 4 (owner decision 2026-11-16); this
additive step is the only upgrade and has no downgrade. Format-3 clients then
refuse the store before application mutation rather than allocate ports
without seeing slot port blocks. Every slot-table read is guarded by the
format, and read-only status reads a format-3 store as holding no slot run. Format-1 and format-2 proposal
stores are refused before application mutation; no migration or reset occurs.
Format-2 proposal clients also refuse format-3 stores before application
mutation. SQLite may recover an interrupted transaction before schema
validation. Writable lifecycle commands, including down, allow this native
rollback recovery; read-only status can refuse while recovery is required.
Owners must drain the matching old proposal and resolve its remaining
resources before recreating its disposable store. Config version 1, snapshot
version 2 and JSON response version 1 are separate.

A single constructor commits each generation's declared ports, final rendered
identities, namespace prefixes and file targets in `BEGIN IMMEDIATE`.
Claims have non-null unique `(domain, resource)` keys and foreign-key owners
(project ID, generation). Prefix claims conflict on overlap as well as exact
identity. No replace/upsert can take a peer's claim. Inspections never expire,
release, repair or garbage-collect peer state.

Port selection tries defaults in declaration order, then 1024–65535 from the
top down; `random`/`0` skips defaults. No new allocation, default or fallback,
takes a port inside the kernel's live ephemeral range, read at allocation
(`net.inet.ip.portrange.first..last` on macOS, `net.ipv4.ip_local_port_range`
on Linux; unreadable refuses). Existing generations keep their published ports. Native TCP/UDP probes across IPv4/IPv6 are hints.
Only the transaction grants ownership. A losing port contender retries;
explicit name/path conflicts refuse. Generated names have a bounded retry.
Published generation ports never drift to match a backend's accidental bind.
Silo never kills a non-silo listener or treats its response as readiness.

Canonical roots use physical filesystem identity. Symlinks, native case and
normalization aliases of a root share its project and mutex. Hash collisions
refuse rather than merging distinct roots. A retired/recreated physical root
gets a fresh identity; old capabilities remain fenced.

## Lifecycle authority

A project-wide operation token fences every env/up/ci/down operation, hooks,
backend commands and deferred callbacks. Live or uncertain operation owners
return `BUSY`; only process absence (`ESRCH`) permits recovery. Every mutation
requires project ID, generation and operation token. No TTL or force takeover
exists. Separate roots/names are required for parallel stacks.

Each mutating command receives a durable planned launch, then a real
Janitor-supervised executor group. The executor reports its actual group,
Silo commits the grant, and only then opens the execution gate. Grant failure
or EOF before grant executes nothing. Janitor uses `--pgroup-only`, never
process-tree discovery, except for `silo run`: its supervisor also ends the
executor's descendants that left the group (`setsid`), which a deadline must
not leave running. Janitor targets only processes whose parent chain it proves
leads to the executor when the stop begins, each re-verified by start identity
before it is signalled, so no unrelated or reused process is reached; a process
already reparented away from that chain before the stop (double fork plus
`setsid`) escapes. Identity checks use the recorded supervisor PID,
start identity and launch token before signalling that group. Dead PIDs alone
do not prove an external request cancelled. Unknown groups/requests retain
claims and cleanup state.

REQ-LAUNCH-002: launch handshake and supervisor identity observations share
`LAUNCH_START_TIMEOUT_MS` (30 s), capped at the finite command's run budget.
The executor's group-leader check uses the same maximum. Its grant wait is
`EXECUTOR_GRANT_TIMEOUT_MS` (45 s): the observation maximum plus the store's
5 s busy timeout and 10 s checkpoint/scheduling margin. Checkpoint fsync and
OS stalls beyond that window remain unknown outcomes, never launch success.
The existing execution timeout starts after grant. Identity inspection outside
startup allows 30 s per recorded supervisor. Checks: `owned_command.test.ts`,
delayed-ps, startup-expiry and non-leader cases; near-deadline lock rehearsal
in `evidence/guest-fixes-r17`.

The gated executor appends an immutable completion fact (started, exit status,
project/generation/launch/group) to the existing canonical store. It cannot
allocate, delete resources or change lifecycle state. The operation owner
folds that fact into its journal. Injected-store tests use a parent completion
path that grants no access to the real account store. This lets owner-crash
recovery distinguish a completed tool from an unresolved remote request.
A lost completion remains uncertain. Terminal facts are monotonic and cannot
be invalidated by later OS PID reuse. Janitor already signals the whole group;
the executor does not forward a second signal to Tilt.

The owner treats a command as finished once its supervisor exits or the
executor's completion fact is in the store, whichever comes first. Supervisor
exit and EOF on the inherited pipes then get one stop window (Janitor grace plus
5 s). After it, the owner signals only that launch's own supervisor handle and
abandons the pipes, keeping the output read so far, and only while Bun has not
yet recorded the supervisor's exit. Janitor 0.3.1 on macOS can miss its child's
exit and then waits until its owner dies, and a descendant that leaves the group
can hold the pipes open; neither holds a finished command to its timeout. Polls
for the fact back off to 1 s and stay keyed by project, generation and launch.
The watch outlives the operation that started the launch: interactive `up`
releases that operation while Tilt runs. A poll uses an existing store
connection only when it is the process's sole open connection to that store.
With none open, it opens, selects through and closes one read-only connection
synchronously. With two or more open, it opens nothing, changes no timeout and
yields no fact. The poll does not wait on a lock. A failed or locked read yields
no fact for that poll; the poll does not end or signal the command. The fact is
never the sole evidence of the result; the operation owner imports it durably
afterward.

`env` reserves and exports without starting tools. `up` supervises foreground
Tilt; a matching live `up` is idempotent. `ci` uses the same allocation and
launch paths with `CI=true` and supervised Tilt CI. All errors keep the owned
state needed for reconciliation. `--force` reconfigures only a stopped,
reconciled generation; it refuses live, retained and cleanup-required state.

REQ-CLI-001: SIGINT/SIGTERM during public `up`, `ci` or `down`, including setup and final
status collection, exits 130/143 respectively and names status/down recovery. With
`--json`, it emits one schemaVersion-1 `INTERRUPTED` error with top-level
`signal` and exits 130/143 respectively. Output is committed once; ordinary
results/errors use the same writer. A signal after final JSON emission starts
does not overwrite that result or its exit status. Cancellation adds no signal or deletion
authority: one operation signal owner spans every `up` phase; owned commands
drain within the existing stop deadline, while `ci` uses Janitor's parent watcher.
Cancelled probes preserve uncertainty and claims instead of reporting an engine
failure; `down` recovers retained ownership. Check: `src/commands/ci.test.ts`.
Normal JSON output awaits stream backpressure with a 30 s flush deadline;
failure closes that output stream and exits nonzero, without a second object.
After emission starts, signals preserve the selected result while it flushes.
The CI interrupt handler synchronously emits its fixed small first value before
exit. Up/down unwind their cancelled work before emitting the error.
Check: large-result pipe case in `src/commands/ci.test.ts`.

`down` stops only journaled owned groups after verifying their owner and command,
reconciles completion facts, records finished owned Compose producers, and deletes receipted Compose containers and
networks by immutable Docker ID. It never evaluates a Tiltfile, runs lifecycle
hooks, or delegates teardown to Tilt, Compose, k3d or a name/label selector.
Cluster resources and Kubernetes workloads remain by default. Explicit
`--delete-cluster` deletes exact receipted backend objects.
`--clean` first proves all command groups terminal, requests resolved, backend
resources absent and no TCP listener or peerless UDP socket on a declared host
port; another process's outgoing connection is not a listener. It seals new
effects during that proof and its consumption, then removes matching owned
snapshots and releases only that generation's claims. Any uncertainty keeps ownership.

REQ-CLEANUP-009: the listener proof supports Linux and macOS. Linux validates every nonempty
row of all four `/proc/net/{tcp,udp,tcp6,udp6}` tables in silo's network
namespace: TCP state `0A` (LISTEN) and UDP state `07` (no peer) block on any
address, while connected and TIME-WAIT sockets do not. Missing IPv4 tables
refuse. Missing IPv6 tables are accepted only when both are absent and the
kernel IPv6 sysctl directory `/proc/sys/net/ipv6` is independently absent;
interface disable flags alone do not establish protocol unavailability.
Check: `src/core/socket_listeners.test.ts`, “Linux listener observation”.

REQ-CLEANUP-010: macOS uses `/usr/sbin/lsof`'s numeric, NUL-delimited TCP/UDP fields, refusing
TCP LISTEN and peerless UDP sockets visible to the invoking account, including
IPv6 and non-loopback listeners. Separate accounts remain outside the allocation
domain. Checks: `src/core/ports.test.ts`, “checkPortListenerAbsent (integration)”,
and `src/core/lease_store.test.ts`, declared-listener and connected-UDP cases.

REQ-CLEANUP-011: an observation error, malformed or incomplete record, unknown state,
failed or warning-bearing command, empty macOS listing, more than 1 MiB per
table/listing, or a 30-second timeout per complete observation refuses before
claims or snapshots are released. Unsupported platforms refuse. This is an observation, not a socket
reservation: the accepted later-bind race remains. Allocation keeps its native
bind availability check. Checks: `src/core/socket_listeners.test.ts` and
`src/core/lease_store.test.ts`, “retains claims and snapshots” cases.

## Slots

`silo run --slot <name> ... -- <command>` runs one command while it holds one
unit of each named slot. A slot not declared under `[slots.<name>]` in the
project config refuses with `SLOT_UNAVAILABLE` (exit 2) before any effect.

**Caps.** The owner decided (Allen, 2026-11-18, in conversation): "We forgot
to onboard the hosts. silo should handle this automatically for users
per-project, optionally per-host." This replaces the 2026-11-16 rule that caps
live only in the host file with no default and no per-project override
(design: `docs/design/host-onboarding/README.md`, approved 2026-11-18). A
project declares a default `cap` per slot, 1-64, either one number or a table
naming `macos` and/or `linux`. The optional `<account home>/.silo/host.toml`,
resolved like the store, may set an entry 0-64 per slot. Each grant
transaction resolves a slot's cap as: the host entry if present (0 turns the
slot off); otherwise, when the requesting run recorded its own default, the
smallest default recorded by it and every run holding or waiting for that
slot; otherwise none. Off and none
refuse with `SLOT_UNAVAILABLE` naming the source to change. Each queued run
records its project's default for this OS in its request; runs that recorded
none contribute nothing. No source yields an unbounded cap, and a typo'd
`--slot` still refuses. `status` reports each slot's cap with `capSource`
(`host`, `project` or null), `hostFile` and `projectCaps`, including the
current project's declared defaults; `cap` is 0 when the host turns the slot
off. An unreadable or invalid `silo.toml` becomes the slot section's problem
and never fails status. silo 1.2.0 rejects a host file with a 0 entry. Checks: `src/core/slot_store.test.ts`
(smallest default, host override, off/none), `src/core/config.test.ts` (cap
forms), `src/commands/run.test.ts` (no host file, override, per-OS, status).

Each
run holds one durable ticket; grants are first in, first out per slot and
all-or-none across slots in one `BEGIN IMMEDIATE` transaction. A waiting ticket
holds nothing; a contender may drop the ticket of a waiter proved absent by the
rule below. Each waiting pass may also release, under the same proof, up to
eight rows of slots it does not request whose waiter no longer answers a null
signal, so a crashed run of an unrequested slot cannot hold port blocks
indefinitely. Caps are re-read for every grant attempt. Legacy-registry state
refuses a run only when a requested slot declares `ports` (owner decision
2026-11-16). Slot port blocks share the `host-port` claim domain with generation
claims and follow the ephemeral-range rule. `run` takes no project operation
token, generation or Docker engine; `on-acquire` steps and the command run in
one Janitor-supervised executor group. Checks: `src/commands/run.test.ts`,
`src/core/slot_store.test.ts`.

**Runs without slots and deadlines.** `silo run [--slot <name>]... [--wait
<dur>] [--timeout <dur>] [--kill-after <dur>] [--json] -- <command>` accepts
zero slots: the command alone runs in one Janitor-supervised executor group in
the config's directory (the current directory by default). Such a run reads no
`silo.toml` or host file, opens no store, checks no legacy state and makes no
Docker call; its status reaches silo only through the supervisor's exit, and
`--wait` refuses with `INVALID_ARGUMENT`. `--timeout` bounds the run from its
grant (every `on-acquire` step and the command), never the wait, which `--wait`
bounds. Durations use `--wait`'s parser; `--timeout` is 1 s to 7 days and
`--kill-after` 1 s to 10 minutes, and a value outside its bounds refuses with
`INVALID_ARGUMENT` before any effect. `--kill-after` sets Janitor's grace
between SIGTERM and SIGKILL for every stop of the group, deadline, interrupt,
or the drain of members left after the command exits, and defaults to the
5-second drain grace; the windows silo waits for a stop scale with it.

A run ends at the first of four events: its supervisor exits, its executor
exits (seen from the completion fact, from ESRCH, or from an unreaped
executor's changed start identity, so a stalled supervisor cannot hold the run
open), its deadline passes, or silo receives SIGINT or SIGTERM. A deadline is a timeout only when
it finds the command still running (no completion fact recorded and the
executor still the recorded process); otherwise the command's own exit decides.
The deadline and an interrupt share one stop: silo sends SIGTERM to its
supervisor, which ends the group and the descendants it proves (see the `run`
exception under Lifecycle authority) with SIGTERM, then SIGKILL after the
grace. Every wait after the first event is bounded; a wait that runs out
SIGKILLs the supervisor through silo's own handle and counts it as lost, and
none of these waits is cut short by a later signal.

The group is **proved gone** only when the supervisor exited on its own
(not by a signal) and the executor group then has no member. Only a group
proved gone yields a result (the command's status, or 124 with
`run.timedOut: true`), an `INTERRUPTED` error (130/143) saying the group was
stopped, or the release of held units. Every other end fails with
`RUN_STOP_INCOMPLETE` (exit 1), names its `cause` (`exited`, `timed-out`,
`interrupted`) and `reason`, and leaves held units held until a later run
proves the group gone under the slot-claim rule:

- `supervisor-lost`: the supervisor was killed or did not drain in its window.
  silo then signals the recorded group itself (SIGTERM, the grace, SIGKILL) and
  the group has no member, but descendants that left it with `setsid` cannot be
  proved gone without the supervisor's snapshot.
- `leader-exited`: the supervisor was lost and the executor had already exited.
  silo signals the group only while the executor is still the recorded process,
  whose life keeps the group ID from naming another group; with the executor
  gone it sends no signal.
- `liveness-unknown`: repeated, bounded reads could not tell whether the
  executor still runs. Every `ps` read silo makes while supervising runs in its
  own process group, so a signal to silo's group cannot end one; a failed or
  signalled read is unknown, never absent.
- `group-survived-kill`: the group still has members after SIGKILL.
- `group-outlived-supervisor`: the supervisor exited but the group still has
  members.

Once one event has started the stop, a later SIGINT or SIGTERM does not change
the outcome. Without `--json`, a command that itself exits 124, 130 or 143 is
indistinguishable by status from a timeout or an interrupt.

`silo run` stays in its caller's process group, so a terminal's Ctrl-C or a
signal to the caller's group reaches it; only the command's group is new.
SIGINT or SIGTERM to silo stops the group by the stop above and exits 130 or
143 once the group is proved gone. SIGHUP is not handled: silo exits by the signal, Janitor's watch of
silo drains the group, and held units are released by the next contending run.
Checks: `src/commands/run.test.ts`.

**Slot claims.** A slot unit is claimed by one run's launch record and held
while that run's supervised process group may exist. It is released by the
run when its group is terminal, or by any later `silo run` contending for
that slot once the holder's recorded supervisor is proved absent (`ESRCH`,
or a start identity that differs from the recorded one) and its executor
group has no member. Uncertain liveness keeps the claim. No expiry, TTL or
force takeover exists. This is the only claim kind another process may
release; "Inspections never expire, release, repair or garbage-collect peer
state" continues to hold for every other domain, and `status` stays
read-only for slots too.

## File authority

Output and custom kubeconfig paths use literal ASCII project-relative
components (`A-Z a-z 0-9 _ - . /`), with no empty, `.` or `..` components.
Absolute paths, interpolation, expansion, backslashes and separators refuse.
The default kubeconfig alone may be outside the root at the invoking HOME's
`.kube/<cluster>`. Parent symlinks, final symlinks and hardlinks refuse.

Physical parent device/inode plus ASCII-folded leaf identifies targets across
roles and nested roots. Config, lock and generated outputs are disjoint.
Git/control paths and legacy registry trees cannot be export destinations.
An existing unreceipted output refuses even when its contents look familiar.
No arbitrary path writer or deletion grant bypasses the owned-file capability.

Exports use exclusive temporary files, fsync, durable pending inode/hash
receipts, atomic rename and parent fsync. Recovery completes only the recorded
rename/unlink. Parent replacement or unrelated file replacement refuses and
leaves foreign bytes intact. Cleanup uses the stored target, never a newly
edited config. CI exports claim a separate append-only sink with no deletion
authority; simultaneous writers and snapshot aliases refuse.

Generation claim release uses one file-obligation boundary for reconfiguration
and retirement. Every prior snapshot must transfer its exact recorded path and
receipt or be cleaned first, including roles omitted by the next configuration.
Disabling k3d with a published kubeconfig therefore requires `down --clean`
before reallocation. A folded target key does not authorize changing the path's
spelling. A failed parent sync keeps the rename/unlink pending, even if its
filesystem effect is already visible; recovery retries the parent sync before
checkpointing. A short or interrupted CI append keeps its uncertainty receipt
and claims, blocking both reallocation and retirement. Silo cannot undo or
replay such an append; its runner file must be inspected with its owner.

`.silo.lock` version 2 carries project ID and generation. It and the env file
are consumer snapshots, not ownership authorities. Missing snapshots do not
release claims. `status --json` is read-only and does not initialize a store.
It exposes ownership, resources, launches, completion facts and problems.
REQ-STATUS-002: `project` remains the stored inspection. Separate `launchStatus`
entries carry `launchId`, `state`, `groupsAbsent`, and `completion`. States are
`unconfirmed` (no recorded groups), `completed` (stored exit or matching durable
completion), `resolved` (stored resolution), `terminated` (stored terminal or
both recorded groups absent without a completion), and `live-or-unknown`.
Completion provenance matches project, generation, launch, leader and group.
Status refuses a mismatched fact with `COMPLETION_PROVENANCE_MISMATCH` and retains ownership.
`groupsAbsent` is a fresh ESRCH-only observation, never a persisted terminal
fact. Stored terminal facts take precedence over later PID reuse.
`operationOwnerAbsent` requires ESRCH for the recorded operation PID.
`cleanupRequired` reflects stored cleanup-required, an absent operation owner,
or observed completed/terminated launches whose stored receipts remain
unreconciled. It is conservative during a live operation; callers inspect
`project.operation` before starting recovery. No observation changes rows,
claims, files or resource authority. Checks: `src/commands/ci.test.ts`.
Each resource has `deleted`: true records a tombstone, while false denotes an
active receipt rather than a fresh physical-presence check. At the 1024-launch
generation limit, terminal reconciled launches and their completion facts can
be compacted. Unresolved facts and resource/mount history remain; successful
restart history cannot consume the capacity needed for exact cleanup.
Process liveness is not application readiness; operators use the Tilt API for
resource health with the allocated `TILT_PORT`.

## Backend authority

Silo records a local Unix Docker endpoint and engine ID and revalidates both
before backend effects. Remote or changed engines refuse. Structured complete
Docker enumeration and a known-present bridge control distinguish empty
namespaces from query failures. k3d lists use exact structured names, never
substring text matches. Bounded/invalid responses refuse.

Every selected existing cluster, registry, network, volume or container needs
an exact matching receipt (kind, name, ID, creation identity). Leftovers are
`NAME_CONFLICT`, never reuse/adoption/deletion. A receipted image-cache
replacement instead reports `CLEANUP_REQUIRED`.

New k3d networks and image caches are precreated with project/generation
labels. Only a k3d image cache Silo directly created and durably receipted at
creation is eligible for explicit cluster cleanup. The store issues a deletion
grant only from that generation's active owned-image-cache creation receipt;
the executor independently re-reads and exactly matches it, including its
creation token, project, generation, cluster and engine. A target or matching
labels without that persisted receipt never grant authority. Immediately
before removal, its name, CreatedAt and recorded ownership labels must match its receipt and
no running or stopped container may reference it. A mismatch or uncertain
query refuses with CLEANUP_REQUIRED and keeps receipts and claims. Silo uses
Docker's name-addressed removal only for this verified cache; it never falls
back to a volume name without that authority. Docker has no conditional local
volume deletion, so external replacement after final inspection is a declared
residual race under the cooperating-tool model. Ordinary down retains the
cache; anonymous, user, external and other observed named volumes do not gain
this authority. k3d nodes receive the ownership labels. Registry provenance requires the completed owned creation request
(the finished cluster create that passed `--registry-create` for that exact
registry) and matching cluster/name; a nonzero exit of that request uses the
same provenance as success. Other producers, such as hooks, cannot vouch for a
registry, and unknown completion cannot grant capture. k3d 5.9 uses the requested registry hostname without a
`k3d-` prefix; claims and capture use that actual name. Its tools container also
omits Silo labels. Only a finished direct cluster create can vouch for it:
the exact tools name, k3d app/cluster/noRole labels and a mount at `/k3d/images`
must match this generation's active, identity-verified owned image cache.
Conflicting Silo labels, an observed cache or another producer confer no
authority. Capture persists the exact container ID before deletion; ordinary
foreign cache borrowers still block cache removal. Compose container
provenance includes project label, physical working root and owned launch;
other objects require ownership labels. Backend publications must be claimed.

Container creation-result receipts include anonymous mount names, creation
times and destinations for audit only. They never grant volume deletion
authority. `down` removes exact receipted Compose container IDs with
`docker container rm --force --volumes`, then its receipted network IDs. Explicit cluster
deletion removes exact receipted k3d container IDs the same way, then removes
its network by immutable ID, then its verified owned image cache. Docker removes attached anonymous volumes;
explicitly named mounts and volumes still referenced by another container
survive. Inherited `volumes-from` provenance refuses before container removal:
Docker could otherwise remove inherited anonymous data after its donor is gone.

Immutable parent/mount receipts survive physical container deletion. If the
parent is already gone, Silo does not attempt volume cleanup. Every remaining
recorded anonymous name is reported as a leak; Silo cannot distinguish leaked
original data from a same-name replacement and never deletes either. Ordinary
down retains claims and reports the names in status's problem; clean and forced
replacement refuse until those names are absent. Explicit user/named volumes
are never deleted; a receipted named volume still present also prevents clean
and replacement. The data's owner must resolve these leftovers independently;
repeated Silo cleanup is not a deletion remedy. A crash can therefore leak data
but cannot grant name-based cleanup authority. `status --json` exposes
`anonymousVolumes`, including deleted parents until the generation retires.
Tools that delete/recreate containers before capture can destroy attribution;
arbitrary external tool lifecycles are outside the cooperating-tool contract.

Resource history keys container/network identities by immutable ID. One live
receipt per kind/name is permitted; an earlier receipt is tombstoned only after
exact absence is verified. A fresh same-name ID from an owned creation result
can then be recorded in the same generation. Tombstones retain anonymous-mount
audit data, and status includes historical receipts rather than asserting their
physical liveness. Volume audit identity includes name and creation time; it
never grants deletion authority.

Before deletion, every finished started producer with a known exit is recorded
using its success path's claimed namespace, labels and physical-root provenance.
Direct k3d network, volume and cluster creates use k3d provenance; hooks and Tilt
workloads can also produce Compose outputs. Finite producers capture before
reporting failure, and down applies the same boundary after importing completions.
Recording is durably reconciled before any deletion starts; a
cleanup retry cannot renew that producer's capture or adopt a replacement Q.
Pre-up hook results are recorded before k3d's namespace preflight, so the next
stage recognizes the generation's own newly created objects.
Matching labels/names without such a pending owned producer do not grant recording
authority. Unknown producers, missing non-delete completion facts and unsupported
creation provenance retain claims for independent owner resolution. Container/network
receipts parse only Docker's full 64-character immutable IDs, with no name
fallback. Anonymous volumes are removed only as an effect of exact-parent
deletion; named volumes remain audit-only because Docker gives them no immutable
object ID. Pre-down/post-down hooks are rejected in base and profile config.

Exact Docker deletion intents carry typed kind/immutable-ID targets. When their
groups are terminal and the exact target is proven absent on the recorded engine,
request reconciliation and its resource tombstone commit together. A missing
completion uses phase `resolved`, resolution `target-absent`, terminal/reconciled
true and exitCode null; it does not claim execution or invent a successful exit.
This proof cannot resolve an unknown create or an untargeted generic command.

Decision (provisional 2026-11-06, coordinator via addendum 7): record the
generation's finished producers before deletion, including failed CI and
down-stopped live up. Deletion uses recorded immutable IDs and the explicit owned-image-cache receipt exception. The human may reverse
this interior recording choice; no migration or project-wide teardown is added.

Decision (ratified 2026-11-05, human via silo-redesign addendum 6): stop only
recorded owned processes and delete recorded Docker IDs, with the explicit
owned-image-cache receipt exception ratified on 2026-11-09; no delegated
project teardown. REQ-CLEANUP-004: if real Compose recreates a service after its
recorded parent is removed, resumed cleanup preserves the new container, its
anonymous volume and data, and all ownership claims until owner resolution.

Decision (ratified 2026-11-05, human via silo-redesign addendum 1): anonymous
volumes are removed with their recorded container, never by name.
Decision (provisional 2026-11-05): refuse retirement/reconfiguration with retained
claims while recorded anonymous names remain; a name cannot establish whether
the remaining object is original or replacement data. The no-name-deletion
rule continues for anonymous and observed named data. Decision (ratified
2026-11-09, human via silo-hosted-example addendum 1): explicit cluster deletion
may remove only its directly created, durably receipted image cache under the
receipt/token protocol above. The token is persisted before creation; a crash
before its creation receipt never permits automatic promotion or deletion.
The creation receipt and token remain after launch compaction. Resource history
and absence use the full cache identity, so equal names/CreatedAt with different
tokens remain distinct generations of that cache within one allocation.
`scripts/allocation-rehearsal.ts --suite volumes` drives ordinary cleanup,
sharing, same-name replacement and leak refusal; lease-store recovery tests
cover durable successful retry reconciliation. Named-volume behavior follows
[Docker's container removal contract](https://docs.docker.com/reference/cli/docker/container/rm/).

- REQ-CLEANUP-001: built-in Docker deletion accepts immutable container/network
  targets and the separate receipt-bound image-cache target; anonymous volume deletion uses an exact parent container ID with
  `--volumes`. Check: `--suite parent-volumes`, `same-second`, `paused-delete`.
- REQ-CLEANUP-002: a surviving recorded anonymous name or unremoved cache prevents
  retirement/replacement with claims preserved. Only explicit cluster deletion
  may remove a verified owned image cache. Check: `--suite volumes` and
  `backend`.
- REQ-CLEANUP-003: recovery folds durable successful exact deletion retries
  through the common reconciliation rule, never an earlier success over a
  later failure. Cache requests reconcile only after successful complete proof
  of the full receipted identity's absence. Check: `--suite retry-crash`,
  `cache` and lease-store deletion tests.
- REQ-CLEANUP-005: Compose ci/down/ci and k3d ci/delete-cluster/ci keep the
  generation and record fresh same-name IDs without discarding prior mount
  history. Check: `--suite lifecycle` and lease-store receipt-cycle tests.
- REQ-CLEANUP-006: finished owned producers are captured once before deletion;
  failed CI and stopped live up clean their exact IDs, while partial-cleanup
  retries preserve Q/W and claims. Check: `--suite lifecycle`,
  `live-compose-replacement` and `compose-replacement`.
- REQ-CLEANUP-007: terminal immutable-ID and full cache-identity delete requests reconcile on proven target
  absence, preserving an unknown exit when completion is lost; unknown creates
  stay unresolved. Check: `--suite absent-delete`, `lost-delete` and lease-store
  exact-target absence tests.
- REQ-STORE-001: unsupported proposal stores refuse before application mutation;
  supported stores remain recoverable after interrupted SQLite transactions.
  Check: clean unsupported-format byte-preservation test and native hot-journal
  recovery probe. No automatic schema migration or reset is performed beyond
  the additive format-3 to format-4 slot tables at the first slot run
  (`src/core/slot_store.test.ts`).
- REQ-LAUNCH-001: terminal reconciled launch history cannot exhaust cleanup
  capacity; unresolved facts and resource audit history survive compaction.
  Check: lease-store capacity test and native `--suite producers` at 1023 records.
- REQ-CLEANUP-008: finished creating tools reconcile only after attributable outputs
  are recorded or their claimed namespace is proven empty. Check: native
  `--suite producers` port-squatter k3d and overlapping-IPAM network failures,
  and `partial k3d tools cleanup` CLI tests for interrupted auxiliary containers.
- REQ-CLEANUP-012: explicit cluster deletion removes only an unused directly
  created image cache whose active persisted creation receipt is independently
  validated at planning, grant and executor boundaries. All-container reference
  queries, exact final identity/token/label/engine checks and post-removal absence
  are required. Missing/audit-only/tombstoned/stale authority refuses. Same-name,
  same-CreatedAt token cycles preserve both histories; stale absence cannot
  consume a successor. Check: `--suite cache`, `backend`, `lifecycle`,
  `producers`, copied full example and receipt/executor boundary tests.
- REQ-STATUS-001: JSON resource receipts distinguish tombstones with `deleted`.
  Check: receipt-cycle unit tests and the native same-generation lifecycle loop.

Trusted hooks/Tiltfiles must consume generated identities and ports. In
particular Tilt requires explicit `docker_compose(project_name=...)`; its
directory-name default ignores the environment's Compose project name.
The example passes the generated value and labels all Compose resources.
Silo refuses owner-labelled objects outside claimed names and keeps claims;
it cannot sandbox arbitrary tool effects or confer cleanup authority for
those objects. This cooperation requirement is part of the contract, not a
claim that arbitrary shell code is isolated.

Silo owns k3d network, API port, registry creation, runtime labels and kubeconfig
control flags. User mappings must publish declared allocated ports. An
automatic `K3D_API_PORT` claim is added when omitted. No backend inspection can
renumber snapshots. Deletion verifies exact recorded identities; Silo does
not invoke k3d's broad name/label deletion. Retained or failed creation keeps
claims; it cannot be released by assuming empty output means no request.

## Breaking host cutover

Before a host's first new allocation, announce cutover, upgrade or retire
every permitted old invocation and wait until every old operation is terminal.
This operational precondition includes an old command paused before publishing
its JSON reservation. Silo does not scan or kill old processes automatically.
Each project owner stops its old ephemeral environment, then recreates it.
No migrate command, import or recreate helper exists.

Before any store/file/directory/tool effect, `env`, `up`, `ci`, `down` and
`status` inspect every `*.json` entry in the explicit
`SILO_PORT_REGISTRY_DIR`, OS account home's `.silo/instances` and invoking
HOME's `.silo/instances`, plus a legacy lock in the selected root. Malformed,
stale and lock-only entries block. A version-2 project/generation marker is
recognized. The check lists findings read-only, performs no attribution and
prints no generated delete commands. `LEGACY_STATE` exits nonzero with
`changed:false`; status also reports `legacy:true`. Each registry entry with a
recorded root is classified, read-only, by whether its own 0.x `down` can
remove it (0.x removes `sha256(realpath(root)).json`): `reachable`, `moved`
(the root now resolves to a path whose hash is not the file name, with
`resolvedRoot`), or `root-missing`. The listing prints the step that clears
each class: the project's own 0.x `down` for reachable entries, removal by the
operator for the others after checking the listed ports and PIDs (owner
decision 2026-11-18, "Classify only": no deletion helper and no 0.x release).
Checks: `src/core/legacy_check.test.ts`.

Old clients started after cutover are outside the guarantee. They cannot read
or mutate SQLite claims, but may take lock-only ports, change files or create
same-name backend resources. Later visible JSON state causes `LEGACY_STATE`;
other conflicts retain ownership. Pre-registry peers without reachable state,
other accounts and other hosts are covered only by the upgrade/retire list.
The cutover does not assert that all old Docker objects are gone: collisions
refuse; non-colliding peer resources remain untouched.

## Configuration and distribution

The supported runtime is pinned Bun 1.4.4 (SQLite 3.53.4 in the Linux artifact)
and Janitor 0.3.1 with process-group-only supervision. The package distributes
`dist/cli.js`, built with `bun build --target=bun`, plus bundled docs, skill
and Tilt extension. The same built entrypoint executes gated children.

**Bundled Janitor.** silo ships the Janitor release pinned in
`src/core/janitor_release.ts` (0.3.1; macOS arm64/x86_64, Linux
aarch64/x86_64) as Bun file assets, beside `dist/cli.js` and inside standalone
executables, and never resolves `janitor` from `PATH`. Owner decision, Allen,
2026-11-20: "lets build that into silo then rather than requriing another
CLI" ([design](docs/design/bundled-janitor/README.md)). Before its first launch
for an account, silo checks the host binary's SHA-256 against the pin and
copies it to `<account home>/.silo/janitor/<version>-<digest prefix>/janitor`
(mode 0755, by rename); later launches reuse that file. A digest mismatch, an
unsupported platform or a failed copy refuses with `LAUNCH_FAILED` before any
effect. `SILO_JANITOR=<path>` substitutes another binary for one invocation.
`bun install` in a checkout runs `scripts/fetch-janitor.ts` (`prepare`), which
fetches the release archives and checks the archive and binary digests.
Checks: `src/core/janitor.test.ts`, `src/core/owned_command.test.ts`.
REQ-DOC-001: every listed documentation topic embeds its Markdown source as
text in JavaScript and standalone builds, without runtime source-tree paths.
Check: `src/commands/doc.test.ts`, public distribution topic tests.

Config remains TOML version 1. Profiles select flag > `SILO_PROFILE` > stored
profile > base, merge maps and replace arrays unless explicitly appended.
Interpolation phases remain identity, hosts, ports, URLs, k3d args. The
reference in `docs/silo-toml.md` defines fields. `docs/commands.md` defines
commands; the other bundled topics define their respective product surfaces.

## Acceptance and release gates

The breaking release is 1.0.0. Release requires matching specialist review
and native Linux/macOS rehearsals. No release or actual host-wide
cutover is implied by a feature branch. The approved basis is plan r3 §§1–3,
plan r5 and the owner's explicit stop/recreate and cutover-precondition
choices. The implementation does not authorize stopping existing projects.

Native tests cover unique atomic claims, own-only cleanup, operation fencing,
path alias/escape/replacement, interrupted exports, legacy detection and launch
gating. The portable rehearsal drives the built CLI against native Tilt,
Docker/k3d, squatters, owner crashes and pinned old clients in a disposable
account. Both OS records must include the head/artifact digest, versions,
filesystem behavior, exact owned resource identities, scenarios and gaps.
macOS requires native case-sensitive and case-insensitive filesystem runs,
including normalization aliases. Component tests, a Linux pass and guest
feedback do not substitute for those gates.
