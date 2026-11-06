## What

Atomically reserve project ports, names and physical file targets in an account
SQLite store, fencing lifecycle effects to a generation. Cleanup stops verified
recorded processes and deletes only recorded immutable Docker container/network
IDs. Finished failed or stopped workloads can be recorded once before deletion;
restarts retain ID history and recoverable exact-delete failures can retire.

## Why

The 0.9.0 allocator can collide with peers and overwrite escaping outputs.
The earlier proposal delegated project teardown after exact-parent removal;
recorded-ID-only cleanup removed that authority. Round 5 then exposed ordinary
same-generation restart and failed/live producer cleanup becoming permanently
wedged. This revision repairs those flows without widening deletion authority.

## How

- Transactional claims, generation fences, owned-file capabilities, verified
  Janitor groups and durable facts retain authority after uncertainty.
- ID-keyed receipts preserve tombstones; a fresh same-name ID requires proof of
  prior absence. Finished producer capture is sealed before deletion and never
  renewed by cleanup retry. Startup hook phases seal before k3d preflight.
- Typed exact-ID delete targets permit terminal target-absence reconciliation;
  missing completion remains an explicit unknown-exit resolution. Unknown creates
  and nonterminal requests cannot use that proof.
- One removal leaf consumes immutable container/network IDs. Anonymous mounts
  disappear only with their exact parent; volume names grant no deletion
  authority. Named caches and ambiguous/orphaned data require independent owners.
- Down ignores Tiltfile and rejects teardown hooks. It allows native SQLite
  rollback recovery without creating a missing allocation. Read-only status can
  refuse a hot journal until a writable lifecycle command recovers it.

## Rollout

**Keep draft.** The major changeset targets 1.0.0; versions remain 0.9.0.
The human's addendum-6 decision ratifies recorded-ID cleanup; addendum 7 directs
these lifecycle repairs. Matching specialist round 6, then native Mac and final
artifact qualification, remain required. Round 5 required changes at 3d94c7fa.

Owners must announce cutover, drain/retire old clients and every old operation,
and recreate their projects before new allocations. Unreleased store format 2
refuses format 1 before application mutation; no schema migration/reset exists.
SQLite may first recover an interrupted transaction. Do not mix allocators or
replace ownership state with an empty store. Feature pushes are proposals;
main's Changesets workflow can publish npm. This lane grants no merge, cutover,
release or S1 adoption. The coordinator handoff seals the actual proposal push.

## Risk

High risk: durable state, breaking CLI contract and shared-host cleanup can affect
peer data/reservations. The model trusts local users, installed tools and config;
it defends against accidental concurrency, replacements, crashes and squatters.
It does not sandbox hostile same-account writers or arbitrary shell code.
Unknown creates and delayed external effects can retain claims indefinitely.

## Verify after deploy

After owner-led cutover, inspect `status --json`, drive Tilt/service endpoints,
then ordinary and explicit cluster cleanup. Verify same-generation restart,
failed/live producer cleanup, retained ready Kubernetes, and replacement/foreign
data preservation. Follow `macos-rehearsal.md`; never prune or remove peer state.

## Rollback

Prefer a forward fix. Old clients cannot manage the SQLite domain. A downgrade
requires owner reconciliation and coordinated clients; no downgrade is authorized.

## Evidence

Qualified source `a94bfd50723cb1d61c52006c5e10acb651d8da1f`;
CLI SHA-256 `4c50596b5171ecda81912351d98c28f28f1b791aeee1a7aac31422648f8befc5`.
Record-only descendants preserve executable inputs. The author drove the built
CLI on onyx Linux with real Docker/Tilt/k3d/Janitor in disposable account views.
[Scenario record and raw evidence](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/lifecycle-reconciliation/README.md).
The URL is the proposal publication target; hosted reachability was not queried.

| Check / scenario | Observation |
| --- | --- |
| Required checks | 146 tests / 393 assertions, typecheck, lint, knip, zero duplicate blocks and build pass; normal commit and actual local-bare pre-push hooks pass. |
| Requested red controls | At 3d94c7fa/b14266a4, all five requested checks fail: Compose/k3d restart, failed CI, stopped live up, failed delete followed by external exact-ID absence. |
| Author native CLI | The final all-suite covers restart, failed/live producer cleanup, sealed partial-cleanup replacement/retry, exact-absence and lost-delete completion, plus existing legacy/peer/crash/file/k3d/volume checks. Logs and counts are in the scenario record. |
| SQLite recovery | A real killed writer leaves a hot rollback journal. Earlier schema preflight refuses supported recovery; final public down rolls back, removes snapshots and releases claims. |
| Copied full example | CI and web/API health pass; ordinary down preserves two ready Kubernetes deployments. Exact cleanup removes anonymous mounts but preserves named cache/claims; independent fixture-owner cache resolution permits retirement. |
| Guest | Fresh CLI/docs-only guest and follow-up at the final bundle exercise the public flows. An earlier guest that read author rehearsal material is retained with that limitation. |
| Closeout | Time-bound recorded-ID/PID audit and baseline uncertainty are in the scenario record; later hook/push groups and scratch teardown are sealed in the coordinator handoff. |

Noticed: a supported hot-journal recovery gap and startup-hook/k3d ordering issue
were reproduced and repaired during qualification. The first clean guest's
secondary Docker event log was copied at closeout while canonical recording was
immediate. Its follow-up tees container events immediately but appended omitted
Compose network event identities later from status/inspect; the k3d row used
an additional immediate name/type observer. Duplicate env/lock progress and
missing completion summary remain guest feedback outside this repair.

Not checked: matching round-6 specialist approval; native Mac/APFS/account/process/
fsync modes and final Intel/Apple Silicon 1.0.0 artifacts; hosted CI, actual
cutover/mixed old clients, arbitrary transient containers before capture, delayed
producer effects, unknown create completion loss, external Kubernetes,
alternate/remote engines/drivers and every daemon interruption boundary.
No new waiver. Historical unattributed Mac volumes are preserved. Review scope:
`specialist-request-r6.md`; native qualification: `macos-request.md`.
