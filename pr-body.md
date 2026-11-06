## What

Atomically reserve project ports, names and physical file targets in an account
SQLite store, fencing lifecycle effects to a generation. Cleanup stops verified
recorded processes and deletes only recorded immutable Docker container/network
IDs. Completed history yields cleanup capacity; finite creating tools record
known failed outputs before reporting failure. JSON receipts expose tombstones.
Only the finished cluster create that requested the registry can vouch for it.

## Why

Legacy 0.9.0 allocation can collide with peers and overwrite escaping outputs.
The earlier proposal's delegated project teardown could delete replacements;
recorded-ID-only cleanup removed that authority. Round 6 resolved the prior
restart/finished-Compose/delete-absence findings, then required two availability
repairs: accumulated launches exhausting cleanup and known failed k3d/network
creates remaining unretirable. Round 7 approved with conditions and asked that
registry provenance come only from the k3d create, not from any finished
producer such as a pre-up hook. This revision addresses all three without
widening Docker deletion authority.

## How

- Transactional claims, generation fences, owned-file capabilities, verified
  Janitor groups and durable completion facts retain ownership after uncertainty.
- At 1024 launch records, terminal reconciled launch/completion history compacts
  transactionally. Unresolved facts and resource/mount history remain. Capacity
  filled entirely by unresolved effects still refuses; retries are bounded.
- All finite create/hook/workload callers use one producer runner. It captures
  known completed outputs or absence with existing provenance, seals recording,
  then reports failure. Down uses the same boundary after completion import.
- k3d's registry has no Silo labels. Capture attributes it only when the pending
  set holds the finished cluster create whose recorded command passed
  `--registry-create` for that exact registry, whatever its exit. A hook-started
  same-name container is refused with `NAME_CONFLICT` and preserved.
- One deletion leaf accepts full immutable container/network IDs. Anonymous data
  disappears only with its exact parent. Volume names grant no product deletion
  authority; named caches and ambiguous/orphaned data require independent owners.
- JSON receipts have deleted true/false for recorded tombstone/active state,
  not a fresh presence query. Qualified restart has down between runs; in-place
  Compose recreate and transient parents before capture remain unqualified.

## Rollout

**Keep draft.** Versions remain 0.9.0; the existing major changeset targets 1.0.0.
Human addendum 6 ratifies recorded-ID cleanup; addenda 8 and 9 direct the author
conditions. Round 7 approved with conditions at a6841309. Matching specialist
round 8 (delta), then native Mac and final artifacts, remain required for this
revision.

Owners announce cutover, drain legacy clients/every old operation and format-1
proposal stores using their matching old build, then recreate their projects.
Even removing a drained real store is data-bearing deletion requiring explicit
owner authority. Format 2 is unchanged here; no schema migration/reset exists.
SQLite can perform native rollback before application schema validation. Do not
mix allocators or replace ownership state with empty state. Feature pushes are
proposals; main's Changesets workflow can publish npm. This lane grants no merge,
cutover, release or S1 adoption; the coordinator handoff seals actual transport.

## Risk

High risk: durable state, breaking public contract and shared-host cleanup can
affect peer reservations/data. The model trusts local users, installed tools and
config and defends against accidental concurrency, replacements, crashes and
squatters. It does not sandbox malicious same-account writers or arbitrary shell.
Unknown create completions and delayed external effects can retain claims. The
pending-capture provenance window and read-only executor-validation hot-journal
window are unchanged; no generic request cancellation is promised.

## Verify after deploy

After separately authorized cutover, inspect status --json, drive Tilt/services,
then ordinary and explicit cluster cleanup. Verify same-generation restart,
known failed create recovery, cleanup with accumulated history, retained ready
Kubernetes and replacement/foreign data preservation. Use macos-rehearsal.md;
never prune or remove peer state to clear errors.

## Rollback

Prefer a forward fix. Old clients cannot manage the SQLite domain; downgrade
requires owner reconciliation and coordinated clients. No downgrade is authorized.

## Evidence

Qualified source `a885d6afadbdbf6a56d10ddafa2b823df95dc86a`;
CLI SHA-256 `492be5fec07d54662c51d2c11645eeedb81a54435b40d62946513b0553c56e5b`.
Record-only descendants preserve executable inputs. The author drove the built
CLI on onyx Linux with real Docker/Tilt/k3d/Janitor in disposable account views.
[This round's record](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/registry-provenance/README.md);
[round 7's producer-recovery record](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/producer-recovery/README.md)
covers the unchanged guest and earlier diagnostics. These URLs are publication
targets; hosted reachability and state were not queried.

| Check / scenario | Observation |
| --- | --- |
| Required gates | 147 tests / 397 assertions, typecheck including the harness, lint, knip, zero duplicate blocks and build pass. Normal commit hooks and an actual local-bare pre-push-hook push pass. |
| Registry-provenance red | On the exact round-7 artifact 2e4f0501, a pre-up hook's same-name `k3d.cluster`-labelled container was receipted during ci. After a real 300 s hook timeout, `down --delete-cluster` receipted it and deleted it by ID. |
| Registry-provenance green | At 492be5fe, both ci and down refuse `NAME_CONFLICT`. The squatter's inspect output is unchanged and claims are kept. After the fixture owner removes it, public clean retires the generation. |
| Full author suite | `--suite all`: 534 recorded commands, including expected refusals and fault probes. All 41 final commands, including 35 public cleanup calls, exit 0. The existing safety, lifecycle and producers cases and the new registry-provenance suite pass. |
| Copied example | CI and web/API health pass, and ordinary down keeps both Kubernetes deployments ready. Exact cleanup removes anonymous mounts but keeps the cache and claims; fixture-owner cache resolution then permits retirement. |
| Round-7 guest | Unchanged paths reuse round 7's guest records. No guest was run for this refusal-only delta. |

Noticed: the first red attempt's squatter did not publish the assigned
registry port. It was refused by publication validation, not by provenance, so
it is kept but labelled as not the distinguishing red. Round 7's two
unattributed failures (the registry-advertise timeout and the load-balancer
restart) did not recur in this round's runs. They remain unattributed.

Not checked: matching round-8 specialist approval; native Mac (APFS, account,
process, fsync) and the final Intel/Apple Silicon artifacts; hosted CI; real
cutover and mixed clients; unknown create facts; the pending-capture and
validation windows; delayed or transient effects; in-place Compose recreate;
external Kubernetes; alternate or remote engines; every interruption boundary.
Round-7 notes 1-4 are unchanged. No new waiver. Historical unattributed Mac
volumes remain untouched. Requests: specialist-request-r8.md and
macos-request.md.
