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

`env` reserves and exports without starting tools. `up` supervises foreground
Tilt; a matching live `up` is idempotent. `ci` uses the same allocation and
launch paths with `CI=true` and supervised Tilt CI. All errors keep the owned
state needed for reconciliation. `--force` reconfigures only a stopped,
reconciled generation; it refuses live, retained and cleanup-required state.

`down` stops only journaled owned groups, reconciles completion facts, runs
owned teardown and retains cluster resources by default. Failed Tilt teardown
propagates. Explicit `--delete-cluster` deletes exact receipted backend objects.
`--clean` first proves all command groups terminal, requests resolved, backend
resources absent and declared host ports free. It seals new effects during
that proof and its consumption, then removes matching owned snapshots and
releases only that generation's claims. Any uncertainty keeps ownership.

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

`.silo.lock` version 2 carries project ID and generation. It and the env file
are consumer snapshots, not ownership authorities. Missing snapshots do not
release claims. `status --json` is read-only and does not initialize a store.
It exposes ownership, resources, launches, completion facts and problems.
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
`NAME_CONFLICT`, never reuse/adoption/deletion. New k3d networks and image
volumes are precreated with project/generation labels. k3d nodes receive those
labels. Registry provenance requires the completed owned creation request and
matching cluster/name. k3d 5.9 uses the requested registry hostname without a
`k3d-` prefix; claims and capture use that actual name. Compose container
provenance includes project label, physical working root and owned launch;
other objects require ownership labels. Backend publications must be claimed.

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
