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

The unreleased proposal store format is 2. Format-1 proposal stores are refused
before application mutation; no migration or reset occurs. SQLite may recover
an interrupted transaction before schema validation. Writable lifecycle commands,
including down, allow this native rollback recovery; read-only status can refuse
while recovery is required. Owners
must drain the matching old proposal before recreating its disposable store.
Config version 1, snapshot version 2 and JSON response version 1 are separate.

A single constructor commits each generation's declared ports, final rendered
identities, namespace prefixes and file targets in `BEGIN IMMEDIATE`.
Claims have non-null unique `(domain, resource)` keys and foreign-key owners
(project ID, generation). Prefix claims conflict on overlap as well as exact
identity. No replace/upsert can take a peer's claim. Inspections never expire,
release, repair or garbage-collect peer state.

Port selection tries defaults in declaration order, then 49152–65535;
`random`/`0` skips defaults. Native TCP/UDP probes across IPv4/IPv6 are hints.
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
process-tree discovery. Identity checks use the recorded supervisor PID,
start identity and launch token before signalling that group. Dead PIDs alone
do not prove an external request cancelled. Unknown groups/requests retain
claims and cleanup state.

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
for the fact back off to 1 s. Each poll reads through its own read-only
connection keyed by project, generation and launch, so it outlives the operation
that started the launch: interactive `up` releases that operation while Tilt
runs. A poll never waits for a locked store, and a failed read only yields no
fact for that poll; it never ends or signals the command.

`env` reserves and exports without starting tools. `up` supervises foreground
Tilt; a matching live `up` is idempotent. `ci` uses the same allocation and
launch paths with `CI=true` and supervised Tilt CI. All errors keep the owned
state needed for reconciliation. `--force` reconfigures only a stopped,
reconciled generation; it refuses live, retained and cleanup-required state.

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
`NAME_CONFLICT`, never reuse/adoption/deletion. New k3d networks and named image
cache volumes are precreated with project/generation labels. The named cache
is retained after cluster deletion: k3d 5.9.0 requires it for its tools node,
and Silo never deletes volumes by name. Its owner resolves that cache before
clean can release the generation. k3d nodes receive those
labels. Registry provenance requires the completed owned creation request
(the finished cluster create that passed `--registry-create` for that exact
registry) and matching cluster/name; a nonzero exit of that request uses the
same provenance as success. Other producers, such as hooks, cannot vouch for a
registry, and unknown completion cannot grant capture. k3d 5.9 uses the requested registry hostname without a
`k3d-` prefix; claims and capture use that actual name. Compose container
provenance includes project label, physical working root and owned launch;
other objects require ownership labels. Backend publications must be claimed.

Container creation-result receipts include anonymous mount names, creation
times and destinations for audit only. They never grant volume deletion
authority. `down` removes exact receipted Compose container IDs with
`docker container rm --force --volumes`, then its receipted network IDs. Explicit cluster
deletion removes exact receipted k3d container IDs the same way, then removes
its network by immutable ID. Docker removes attached anonymous volumes;
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
down-stopped live up. Deletion remains recorded IDs only. The human may reverse
this interior recording choice; no migration or project-wide teardown is added.

Decision (ratified 2026-11-05, human via silo-redesign addendum 6): stop only
recorded owned processes and delete only recorded Docker IDs; no delegated
project teardown. REQ-CLEANUP-004: if real Compose recreates a service after its
recorded parent is removed, resumed cleanup preserves the new container, its
anonymous volume and data, and all ownership claims until owner resolution.

Decision (ratified 2026-11-05, human via silo-redesign addendum 1): anonymous
volumes are removed with their recorded container, never by name.
Decision (provisional 2026-11-05): refuse retirement/reconfiguration with retained
claims while recorded anonymous names remain; a name cannot establish whether
the remaining object is original or replacement data. The no-name-deletion
rule also retains k3d's named image cache; disabling it fails k3d 5.9.0 tools-node
creation, so its owner must resolve it independently.
`scripts/allocation-rehearsal.ts --suite volumes` drives ordinary cleanup,
sharing, same-name replacement and leak refusal; lease-store recovery tests
cover durable successful retry reconciliation. Named-volume behavior follows
[Docker's container removal contract](https://docs.docker.com/reference/cli/docker/container/rm/).

- REQ-CLEANUP-001: built-in Docker deletion accepts only container/network
  targets; anonymous volume deletion uses an exact parent container ID with
  `--volumes`. Check: `--suite parent-volumes`, `same-second`, `paused-delete`.
- REQ-CLEANUP-002: a surviving recorded anonymous name or named cache prevents
  retirement/replacement with claims preserved. Check: `--suite volumes` and
  `backend`.
- REQ-CLEANUP-003: recovery folds durable successful exact deletion retries
  through the common reconciliation rule, never an earlier success over a
  later failure. Check: `--suite retry-crash` and lease-store deletion tests.
- REQ-CLEANUP-005: Compose ci/down/ci and k3d ci/delete-cluster/ci keep the
  generation and record fresh same-name IDs without discarding prior mount
  history. Check: `--suite lifecycle` and lease-store receipt-cycle tests.
- REQ-CLEANUP-006: finished owned producers are captured once before deletion;
  failed CI and stopped live up clean their exact IDs, while partial-cleanup
  retries preserve Q/W and claims. Check: `--suite lifecycle`,
  `live-compose-replacement` and `compose-replacement`.
- REQ-CLEANUP-007: terminal exact-ID delete requests reconcile on proven target
  absence, preserving an unknown exit when completion is lost; unknown creates
  stay unresolved. Check: `--suite absent-delete`, `lost-delete` and lease-store
  exact-target absence tests.
- REQ-STORE-001: unsupported proposal stores refuse before application mutation;
  supported stores remain recoverable after interrupted SQLite transactions.
  Check: clean unsupported-format byte-preservation test and native hot-journal
  recovery probe. No automatic schema migration or reset is performed.
- REQ-LAUNCH-001: terminal reconciled launch history cannot exhaust cleanup
  capacity; unresolved facts and resource audit history survive compaction.
  Check: lease-store capacity test and native `--suite producers` at 1023 records.
- REQ-CLEANUP-008: finished creating tools reconcile only after labelled outputs
  are recorded or their claimed namespace is proven empty. Check: native
  `--suite producers` port-squatter k3d and overlapping-IPAM network failures.
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
`changed:false`; status also reports `legacy:true`.

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
