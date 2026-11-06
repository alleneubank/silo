## What

Atomically reserve project ports, names and physical file targets in an account
SQLite store, fencing lifecycle effects to a generation. Cleanup stops verified
recorded processes and deletes only recorded immutable Docker container/network
IDs. Completed history yields cleanup capacity; finite creating tools record
known failed outputs before reporting failure. JSON receipts expose tombstones.

## Why

Legacy 0.9.0 allocation can collide with peers and overwrite escaping outputs.
The earlier proposal's delegated project teardown could delete replacements;
recorded-ID-only cleanup removed that authority. Round 6 resolved the prior
restart/finished-Compose/delete-absence findings, then required two availability
repairs: accumulated launches exhausting cleanup and known failed k3d/network
creates remaining unretirable. This revision addresses both without widening
Docker deletion authority.

## How

- Transactional claims, generation fences, owned-file capabilities, verified
  Janitor groups and durable completion facts retain ownership after uncertainty.
- At 1024 launch records, terminal reconciled launch/completion history compacts
  transactionally. Unresolved facts and resource/mount history remain. Capacity
  filled entirely by unresolved effects still refuses; retries are bounded.
- All finite create/hook/workload callers use one producer runner. It captures
  known completed outputs or absence with existing provenance, seals recording,
  then reports failure. Down uses the same boundary after completion import.
- One deletion leaf accepts full immutable container/network IDs. Anonymous data
  disappears only with its exact parent. Volume names grant no product deletion
  authority; named caches and ambiguous/orphaned data require independent owners.
- JSON receipts have deleted true/false for recorded tombstone/active state,
  not a fresh presence query. Qualified restart has down between runs; in-place
  Compose recreate and transient parents before capture remain unqualified.

## Rollout

**Keep draft.** Versions remain 0.9.0; the existing major changeset targets 1.0.0.
Human addendum 6 ratifies recorded-ID cleanup; addendum 8 directs these author
conditions. Round 6 approved with conditions at 6c942863. Matching specialist
round 7, then native Mac and final artifacts, remain required for this revision.

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

Qualified source `3f87992621a06888ec32c55afe46ec9b71211005`;
CLI SHA-256 `2e4f0501ccc6423900d902a70623a629917153cc7c0a772b6eef3cb779741ec6`.
Record-only descendants preserve executable inputs. The author drove the built
CLI on onyx Linux with real Docker/Tilt/k3d/Janitor in disposable account views.
[Scenario record and raw evidence](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/producer-recovery/README.md).
This URL is the publication target; hosted reachability/state was not queried.

| Check / scenario | Observation |
| --- | --- |
| Required gates | 147 tests / 397 assertions, typecheck including the harness, lint, knip, zero duplicate blocks and build pass. Normal source commit and actual local-bare pre-push hooks pass. |
| Red controls / repaired flows | Baseline 4c50596b fails cleanup at 1023 records and recovery of known failed k3d/network/volume creates. Corrected public CLI records outputs/absence and retires after exact cleanup and any separate cache-owner resolution. Actual baseline states recover in the same format-2 store. |
| Full author suite | 517 recorded commands, including expected refusals/fault probes. All 39 final commands, including 33 public cleanup calls, exit 0. Existing safety/lifecycle cases and new producers suite pass. |
| Copied example | CI and web/API health pass; ordinary down retains two ready Kubernetes deployments. Exact cleanup removes anonymous mounts but retains cache/claims; independent fixture-owner cache resolution permits retirement. |
| Fresh guest | Four requested rows and live down/SIGINT retry pass at initial repair 73114d2 / CLI 4601b51c. Targeted registry-enabled failed-create follow-up passes at final 3f87992 / CLI 2e4f0501; earlier rows were not rerun. Unchanged paths reuse evidence. CLI/docs learning only. |
| Scoped closeout | At 06:18:01Z, author 103 / guest 5 projects had zero active generations/claims/resources/operations; 476 recorded Docker handles and 2694 PID/group numbers were absent. Later hook/push and scratch closeout are sealed in handoff. |

Noticed: the registry-enabled red at initial repair exposed a remaining
success-only provenance fallback. The final typed finished-producer boundary
accepts known zero/nonzero exits with identical existing provenance. Public down
recovered the retained red registry by its original ID in the same store. The
red helper's missing setting and shortened-name cleanup omission are retained.

The initial repair's first full run timed out at registry advertisement. Exact
cleanup reconciled five known 143 exit facts and retained cache; an owned API/CI
diagnostic and later full run passed at unchanged initial inputs. The first
final-source full attempt failed its second same-generation k3d startup with a
restarting load balancer. A fresh-allocation diagnostic passed but did not repeat
that exact restart. The final full run used a transparent failure-only observer
and passed, followed by the final example. Both earlier failures remain
unattributed. Guest port timelines exclude overlap with the initial API window.
Guest clean safely held claims during TIME-WAIT. The initial guest lacked a
historical transient-tools ID; the follow-up captured it, but first learned the
registry ID from its receipt before independent inspection, rather than from a
create-time event. Neither record proves complete transient history.

The initial client-version probe outside the view emitted the host k3s wrapper's
default-config permission warning; it was corrected inside the disposable view.
Rehearsal API calls used owned kubeconfigs; no credential/system config changed.
Expired synthetic k3d token values are redacted with a file/count/hash manifest.

Not checked: matching round-7 specialist approval; native Mac/APFS/account/process/
fsync and final Intel/Apple Silicon artifacts; hosted CI, real cutover/mixed
clients, unknown create facts, pending-capture/validation windows, delayed or
transient effects, in-place Compose recreate, external Kubernetes,
alternate/remote engines and every interruption boundary. No new waiver.
Historical unattributed Mac volumes remain untouched. Requests:
specialist-request-r7.md and macos-request.md.
