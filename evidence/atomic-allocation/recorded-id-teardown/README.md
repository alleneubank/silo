# Recorded-ID teardown qualification

Verified Linux proposal; unmerged draft. Matching specialist round 5 and native
Mac qualification remain pending. The human ratified recorded-ID-only cleanup
on 2026-11-05 through silo-redesign addendum 6. This record supersedes the
round-4 cleanup behavior; its unchanged rejection is retained in
`verdict-specialist-r4.md`.

Runtime implementation: `d9628d1fe8ec47ca401998e35a8786a85bb0ebe6`.
Final source plus rehearsal: `77e3d68f9b8dffff2aec9c31bc2833349c36c3f3`.
CLI SHA-256: `b14266a4564fa89dd7440d5cce5de08f51dd587173a9b3ee475b49b2743c2e53`.
Record-only descendants reuse those executable inputs. `source-head.txt`,
`artifact.txt` and the contemporaneous example provenance files bind the runs.
The final proposal ref and network push result will be sealed in the coordinator
handoff `pr-ops.md`; no live GitHub state is inferred here.

## Construction and changed contract

Down has no Tilt teardown, hook runner, generic executor or creation-capture
import. It stops verified recorded supervisors, removes receipted Compose
container/network IDs, and optionally removes receipted k3d objects by the same
leaf. Container/network IDs are parsed and branded full immutable Docker IDs;
there is no name fallback. Volumes remain audit records and cannot enter the
removal branch. Anonymous data can disappear only with its exact parent through
`container rm --force --volumes`; named caches and orphaned/replaced anonymous
names remain for independent owner resolution.

Cleanup never evaluates Tiltfile or adopts matching names/labels. Pre-down and
post-down hooks are rejected in base and profile config. Kubernetes workloads
remain with retained clusters. An interrupted producer can leave unreceipted
objects; cleanup refuses them with claims intact instead of adopting them.
This conservative availability limit is in SPEC.md and the bundled operator docs.
`source-teardown-audit.txt` is a one-off standard source inspection, including a
baseline-positive control and removal call trace, not a permanent source checker.

## Author observations

Environment: onyx Linux x64; real local Docker engine
`114f4194-e27d-4d0b-82fc-201ecd0e9997`; native Bun 1.4.4, Janitor 0.3.1,
Tilt 0.37.8-fork.20261009.g753c01455; checksum-verified k3d 5.9.0.
`environment.txt`, checksum receipts and archived launcher sources record inputs.
Disposable account filesystem views isolate native account discovery; HOME alone
is not treated as store isolation. No production cluster or real account store
was used. The author drove the built public CLI and actual tools end to end.

| Scenario | Observation / raw evidence |
| --- | --- |
| Required checks | `source-gates.log`: 139 tests / 356 assertions, typecheck, lint, knip, zero duplicate blocks, build. Normal commits run hooks; `local-bare-qualified-push.log` is an actual local-bare push through every pre-push hook. |
| Round-4 race, red at a7359a45 | `compose-replacement-red.log`, baseline CLI digest 90a44fcc: real Tilt/Compose creates P; transparent Docker wrapper removes exact P then pauses. Real Compose recreates Q and W under the same project. Resumed baseline cleanup exits 0, deletes Q, leaves W and releases all claims. Fixture-owner resolution removes the surviving synthetic W. |
| Same race, corrected | `all-final.log` / raw fixture VMowsW: barrier is reached after P/data removal; recreated Q/W, data readback and claims remain intact. Cleanup refuses while Q is attached to the recorded network; fixture-owner exact Q removal permits public retry/retirement. No second teardown discovery grants authority. |
| Unreceipted object at entry | Real external Compose creates a matching object after env allocation. Public clean refuses; object snapshot and claims are unchanged and resources remain empty. Separate exact fixture-owner removal enables clean. |
| Full CLI suite | `all-final.log`: all-suite passes across 371 recorded commands; all 24 final cleanup commands exit 0. Includes legacy/cutover controls, peer/live/crash and file cases, native k3d, same-second/paused-name replacement, parent volumes, inherited refusal and retry/crash recovery. `rehearsal-summary.json` indexes observations; raw commands/events/handles are under `fixtures/`. |
| Copied full example | `example-summary.json` / matching before-after provenance: CI, web/API health pass. All mounted volume handles are recorded. Ordinary down removes the physical Compose parent while both Kubernetes deployments remain ready. Explicit cluster deletion removes recorded parents/networks and all six anonymous mounts, retaining the named image cache and claims. Separate receipt-verified fixture-owner cache resolution permits public retirement. |
| Independent guest | `guest/verdict-guest.md`: green against the same bundle. Real Redis/data readback, failing Tiltfile ignored with no marker execution, repeated cleanup, own PID stop with unchanged live peer, unreceipted Compose refusal twice, exact owner resolution, and forbidden hook keys in base/selected/unselected profiles. Guest did not read implementation/diff/author evidence. It did not run the replacement race or Kubernetes. |

The wrapper in the race forwards every other call to real Docker. Pausing after
physical parent removal exposes the reviewed interleaving; no Docker/Tilt contract
is mocked. Earlier focused green output has its own embedded digest and is only
supporting evidence; the final all-suite qualifies the stated bundle.

## Failed probes and their resolution

`all-suite.log` stopped on the old inherited cleanup expectation: the producer's
failed capture left no receipt, and cleanup now returns NAME_CONFLICT rather than
attempting capture again. Objects and claims were preserved. The expectation
changed to the ratified refusal contract; data-preservation assertions remain.
Fixture teardown now unwinds dependencies in reverse creation order. Recorded
borrower/donor IDs were verified and removed with their volumes, then the owned
named fixture volume was resolved; raw recovery logs retain the operations.

That project's retirement first refused port 49154, then port 49155. The first
occupant was not established; the guest's recorded live peer used port 49155.
No listener was stopped by the author. After the guest stopped its own peer,
`inherited-retire-after-guest.log` shows retirement.
Independent disposable account domains share the host's kernel ports; subsequent
live experiments were coordinated sequentially.

`all-timestamp-precondition.log` failed the old same-second fixture precondition
before safety assertions: Docker timestamps crossed a second while receipt writes
were inside the window. The fixture now persists the original real creation
result after its timing-sensitive replacement setup. The timestamp equality and
all preservation assertions remain; final VMowsW observes equal real timestamps.

`example-first-probe/` records a probe error: public status retains historical
receipt tombstones, so absence cannot be inferred from an empty resource list.
The probe was corrected to query exact physical parent IDs; its repeated example
passes with contemporaneous source/digest receipts. No runtime repair was needed.
The initial stdin recovery launcher also failed before executing; the subsequent
file-based recovery and final retirement logs identify the actual successful run.

## Evidence completeness and closeout

Round 4's missing historical raw logs were present locally but ignored by a
host-global `*.log` rule. The repository now explicitly includes evidence logs;
those existing files are retained without reconstruction under
`../container-scoped-volumes/`. That README marks its superseded behavior, and
its earlier claims verdict is qualified as a local-file check, not Git membership.
Current raw outputs, event streams, explicit race barrier files and launch scripts
are included here. Private account databases, generated env/lock/kubeconfig files,
downloaded binaries and dependency caches are excluded.

`audit.json`, at 2026-11-06T01:30:43.963Z: author 54 and guest 4 projects were
generation 0, with zero claims, active resources or operations. All 150 recorded
Docker handles and 1,252 recorded PID/group numbers in that scoped fixture audit
were absent. Its own active auditor
group was excluded, then checked absent in `audit-final-group.txt`. Later hook,
record and push process closeout belongs to the handoff. Shared images/build
caches and every unrecorded object were preserved. This is a recorded-handle audit,
not a host-wide absence claim. Installed dependencies and hooks remain for the
coordinator under the lane rule; task scratch teardown is recorded in the handoff.

Not checked: matching specialist round 5, native Mac/APFS/account/process/fsync
modes and final Intel/Apple Silicon 1.0.0 artifacts; hosted CI, real host cutover,
lost completion facts, arbitrary transient containers before capture or delayed
external producer effects; external Kubernetes, alternate/remote engines/drivers,
and every instruction-level daemon interruption. No new waiver. Historical
unattributed Mac volumes remain untouched. This record grants no merge, release,
production adoption or retrospective ownership of those objects.
