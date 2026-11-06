## What

Atomically reserve project ports, names and physical file targets in a canonical
account SQLite store, and fence lifecycle effects to a project generation.
Cleanup stops verified recorded processes and removes only recorded immutable
Docker container/network IDs. It never delegates teardown to Tilt/Compose or
adopts matching objects during cleanup. Owners drain old clients and recreate
projects; there is no migration.

## Why

The 0.9.0 client can duplicate reservations, overwrite escaping outputs, reuse
peer objects and report success after teardown failure. Specialist round 4 also
showed that the prior proposal's final Tilt down could delete a service another
agent recreated after exact-parent removal, leaving unreceipted data and releasing
claims. The recorded-ID design removes that delegated authority.

## How

- Transactional claims, generation fences, owned file capabilities, gated Janitor
  groups and durable completion facts retain ownership after uncertainty.
- One deletion leaf consumes full immutable container/network IDs. Anonymous
  mounts are removed only with their exact parent through `rm --force --volumes`;
  volume names remain audit data. Named caches, shared/orphaned/replaced names
  and ambiguous inherited provenance retain claims for independent owner resolution.
- Down ignores Tiltfile and rejects pre-down/post-down hooks in base and profiles.
  Kubernetes workloads remain with a retained cluster. Explicit cluster deletion
  uses recorded IDs. Unreceipted objects from interrupted producers are refused.
- Durable successful exact-delete retry facts reconcile earlier matching failures,
  including recovery after caller death. No arbitrary source/artifact checker or
  new waiver was added.

## Rollout

**Keep draft.** Intended release is 1.0.0 via the major changeset; versions remain
0.9.0. Human addendum 6 ratifies recorded-ID cleanup and the fifth specialist
round. Matching round 5, then native Mac/final-artifact qualification, remain
required. Round 4 required changes at a7359a45; no current approval is claimed.

Before first new host allocation, owners announce cutover, upgrade/retire old
clients, drain all old operations including paused writers, and stop/recreate
their own projects. Do not mix old clients with the SQLite domain. Feature-branch
pushes propose this change; main's Changesets workflow can publish npm. This
proposal grants no merge, cutover, release or S1 adoption. The coordinator handoff
records the exact proposal ref and actual push outcome.

## Risk

A defect can affect peer data/reservations. The threat model is trusted local
users and cooperating tools/config on one shared host, defending against
accidental collisions, replacements, crashes and squatters; it does not contain
hostile same-account writers or arbitrary shell code. Missing receipts and lost
completion facts can require independent owner resolution. Retaining data and
claims is an intentional availability cost of refusing unsupported authority.

## Verify after deploy

After owner-led cutover, inspect `status --json`, drive Tilt/service endpoints,
and use explicit owned teardown. Confirm ordinary down retains Kubernetes,
foreign/recreated data and uncertainty retain claims, and only an attributed
owner resolves leftovers. `macos-rehearsal.md` and `macos-request.md` specify the
native qualification; never remove peer metadata or prune to clear an error.

## Rollback

Prefer a forward fix. Old clients cannot manage the SQLite domain. Any approved
downgrade first requires owner reconciliation and coordinated clients; never mix
allocators or replace the store with empty state. No downgrade is authorized here.

## Evidence

Runtime source `d9628d1fe8ec47ca401998e35a8786a85bb0ebe6`; final source and
rehearsal `77e3d68f9b8dffff2aec9c31bc2833349c36c3f3`.
CLI SHA-256 `b14266a4564fa89dd7440d5cce5de08f51dd587173a9b3ee475b49b2743c2e53`.
Record-only descendants reuse these inputs. The author drove the built CLI on
onyx Linux with real Docker, Tilt, k3d and Janitor in disposable account filesystem
views. [Raw evidence and scenario details](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/recorded-id-teardown/README.md).
This link is the intended publication target; the evidence is local until the
proposal push, and hosted reachability was not queried.

| Check / scenario | Observation |
| --- | --- |
| Required gates | 139 tests / 356 assertions, typecheck, lint, knip, zero duplicate blocks and build pass. Normal commits and a real local-bare push run hooks. |
| Red at a7359a45 / corrected | Pause after exact P removal, recreate Q/W via real Compose, resume. Baseline deletes Q and releases claims while W remains. Corrected CLI preserves Q/W/data and claims and refuses; exact fixture-owner Q resolution enables retirement. |
| Full author CLI rehearsal | All-suite passes: 371 recorded commands and all 24 final fixture cleanup commands exit 0. Includes legacy/cutover controls, peer/crash/file cases, native k3d, all volume scenarios and retry/crash reconciliation. |
| Copied full example | CI and web/API health pass with contemporaneous head/digest receipts. Ordinary down removes the physical Compose parent and keeps two Kubernetes deployments ready. Exact cluster cleanup removes all six anonymous mounts while named cache/claims remain; separate owner cache resolution permits clean. |
| Fresh independent guest | Green at the same bundle: Redis/data, failing Tiltfile ignored, repeated clean, verified own-process stop with unchanged live peer, unreceipted Compose refusal twice, owner recovery and forbidden hook keys in base/profiles. |
| Scoped closeout | At 2026-11-06T01:30:43.963Z, fixture audit observed author 54 / guest 4 projects at generation 0 with no claims, active resources or operations; 150 recorded Docker handles and 1,252 recorded PID/group numbers absent. Later record/hook/push handles close out in handoff. |
| Evidence repair | Historical cited raw logs are included despite the host-global log ignore; their README marks round-4 behavior as historical. Current race barrier files and raw outputs are retained. |

Noticed: an obsolete inherited refusal expectation and a same-second fixture
precondition needed harness corrections; assertions protecting data/claims remain.
A copied-example probe initially confused historical receipts with physical
presence; direct exact-ID queries corrected it. All failed outputs remain in the
record. A live guest listener caused safe retirement refusal until its owner
stopped it. Guest hook errors remain verbose schema diagnostics.

Not checked: matching specialist round 5, native Mac/APFS/account/process/fsync
and final Intel/Apple Silicon 1.0.0 artifacts; hosted CI, actual cutover, lost
executor facts, arbitrary transient containers before capture or delayed producer
effects, external Kubernetes, alternate/remote engines/drivers, and every daemon
interruption boundary. No new waiver. Historical unattributed Mac volumes are
preserved. See `specialist-request-r5.md` for the review scope and neighbors.
