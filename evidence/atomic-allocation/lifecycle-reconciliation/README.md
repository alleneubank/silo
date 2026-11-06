# Lifecycle reconciliation qualification

Historical record: round 6 approved with conditions at 6c942863. The current
author repairs, qualification and pending matching review are indexed in
[producer-recovery](../producer-recovery/README.md). Statements below retain
this record's original inputs and then-pending gates.

Verified Linux proposal; matching specialist round 6 and native Mac qualification
remain required. No lane merge or release. Addendum 7 directs the repairs to the
round-5 findings while retaining the human's recorded-ID-only deletion boundary.
The unchanged rejected verdict is in `verdict-specialist-r5.md`.

Qualified source: `a94bfd50723cb1d61c52006c5e10acb651d8da1f`.
CLI SHA-256: `4c50596b5171ecda81912351d98c28f28f1b791aeee1a7aac31422648f8befc5`.
Record-only descendants preserve these executable inputs. The coordinator handoff
`pr-ops.md` seals the exact proposal ref and actual network push result; this
record infers no hosted PR or CI state.

## Changed behavior and construction

Previously, ci/down/ci recreated the same names with new IDs but name-keyed
receipt tombstones rejected them permanently. Receipts now preserve ID history
and allow a new live ID only after the old one is proven absent. Historical
anonymous mounts remain auditable. The unreleased SQLite store is format 2;
format 1 requires matching-old-proposal drain and owner-led recreation, with no
schema migration or reset. Clean format-1 byte preservation is tested. SQLite
may perform native rollback recovery before application schema validation.

Failed CI and live up stopped by down previously left their finished producers'
objects unrecorded. Finished, terminal owned workloads/hooks now use the same
capture provenance as successful launches and seal capture before deletion.
Reconciled producers never grant fresh cleanup-time capture on a retry. Startup
hook phases use that boundary before the next k3d preflight. Unknown creates,
missing non-delete completion facts and unsupported provenance still refuse.

Exact-ID delete requests carry a typed immutable target. Once their process
group is terminal, reverified target absence atomically reconciles matching
requests and tombstones that ID. A missing completion becomes an explicit
`resolved` / `target-absent` fact with unknown exit code; no exit success or
process-start fact is invented. No generic command can use that proof.

Down still stops only verified recorded processes and deletes only receipted
container/network IDs. No Tilt down, Compose down, selector deletion, hook or
Tiltfile evaluation runs. Anonymous data can be removed only with its exact
parent; volume names grant no product deletion authority. Named cache resolution
in these fixtures belongs separately to the fixture owner.

## Author run and evidence

The author drove the built public CLI with native Docker, Tilt, k3d and Janitor
on onyx Linux x64. `environment.txt` records versions and local engine
`114f4194-e27d-4d0b-82fc-201ecd0e9997`. Disposable account filesystem views exercise
native account discovery; HOME alone does not isolate the store. Only newly
created, recorded synthetic fixture resources were mutated. Downloaded k3d and
published legacy artifacts have checksum receipts. Launchers and one-off probe
sources are retained as text; account databases, generated env/lock/kubeconfig,
binaries and dependency caches are excluded.
Expired synthetic k3d token values in full-inspect captures are redacted;
`redactions.json` lists the files/counts and archived hashes. IDs, creation
identity, provenance and outcomes are otherwise retained.

| Check / scenario | Observation and raw evidence |
| --- | --- |
| Required findings, red at 3d94c7fa | `lifecycle-red.log`, baseline bundle b14266a4: all five distinguishing cases fail: Compose and k3d restart, failed CI, down-stopped live up, and failed delete followed by external exact-ID absence. The baseline account's unresolved metadata was preserved, not converted to success. |
| Same-name restart | `all-recovery.log`: same-generation Compose ci/down/ci and k3d ci/delete-cluster/ci record fresh IDs, retain history, and retire after exact cleanup and fixture-owner cache resolution. |
| Finished failed/live producers | `all-recovery.log`: failed Tilt CI records its created objects; down stops a live workload, captures once, removes exact IDs and retires. |
| Partial-cleanup replacement | `all-recovery.log`: after exact P removal, real Compose recreates Q/W. Cleanup and retry preserve Q/W/data and claims; no old producer adopts Q. Owner resolution permits retirement. |
| Failed delete and missing completion | `all-recovery.log`: external exact network removal resolves the earlier failed request. A real executor kill after physical deletion/before completion recovers as target-absent with null exit. Unknown creates remain unresolved. Supporting earlier probes are `lost-fact-red.log`, `lost-fact-recovery.log`, `lost-fact-native-green.log`; their embedded source/digest and patch identify intermediate inputs. |
| Hook boundary | `prehook-red.log` reproduces pre-up Compose creation conflicting with k3d preflight on an intermediate head. The final lifecycle suite passes with that real pre-up hook. |
| SQLite interruption | `hot-journal-red.log`: the earlier read-only preflight blocks supported recovery with SQLITE_READONLY_ROLLBACK. `hot-journal-public-green.log`: a real killed SQLite writer leaves a hot journal; read-only status refuses, public down recovers the rollback, removes snapshots and retires with no claims. The uncommitted spill table is absent afterward. |
| Gates | `recovery-gates.log`: 146 tests / 393 assertions, typecheck, lint, knip, zero duplicate blocks, build. `recovery-commit.log` and `local-bare-recovery.log`: normal commit and actual local-bare pre-push hooks pass. |
| Source inspection | `source-teardown-audit.txt`: baseline-positive delegated teardown references, current no-match search and current exact deletion/capture/absence call sites. Standard one-off source inspection, no new permanent checker. |
| Full CLI rehearsal | 478 recorded commands; all 36 final commands, including 30 public down cleanup calls, exit 0. Counts and fixture index are in `rehearsal-summary.json`; `all-recovery.log` and `fixtures/` retain each command, output, event and handle. Includes legacy/cutover, peer/live/crash/file cases, k3d, volume replacement/inheritance, retry/crash and lifecycle cases. |
| Copied full example | `example-summary.json` and before/after provenance bind the run to this source/bundle. CI and web/API health pass. Ordinary down removes Compose and keeps two Kubernetes deployments ready. Exact cluster cleanup removes anonymous mounts, preserves named cache/claims, then independent fixture-owner cache resolution permits retirement. No internal failed-CI capture workaround remains. |
| Guest | `guest/` retains the fresh CLI/docs-only confirmation; `guest/post-recovery/verdict-guest.md` passes all six rows at the qualified bundle, with seven roots retired and exact object/mount/PID absence checks. `guest-initial/` retains an earlier green result qualified by reading an author rehearsal document outside its entry points; it is not the uncontaminated confirmation. |

`all-final.log`, `source-gates.log`, the first guest confirmations and the
supporting example under `supporting-bfaba/` qualify bfaba97c / 8dce2b5e, before
the SQLite recovery correction. Earlier focused green probes have their own
embedded inputs. They are supporting history, not final qualification.
The real Docker wrapper forwards all calls except the explicit fault barrier;
Docker/Tilt/Compose behavior is not mocked.

## Limits and closeout

`audit.json` is the time-bound audit of recorded Docker and PID/group handles,
validated against complete engine listings and a known-present bridge control.
At 2026-11-06T04:18:40.022Z, author 67 / initial guest 6 / confirmation guest 13
projects had zero active generations, claims, resources or operations. All 426
recorded Docker handles were absent. Of 2,236 recorded PID/group numbers, 2,235
were absent; one previously proven-absent number was recycled as an unrelated
UID-0 sox daemon thread, with no matching old group. It was preserved without a
signal. `audit-numeric-reuse-first.log` and `audit-recycled-number-probe.log`
retain the audit's initial refusal and attribution; the final auditor's own
group was then checked absent in `audit-final-group.txt`.
The format-1 red account intentionally retains one generation and 21 claims
with no live receipted objects or operation; the disposable fixture owner's
physical cleanup is separate from that unresolved product metadata. This is
not a host-wide absence claim. Later hook/push handles and scratch teardown are
sealed in the handoff. Shared images/cache and unrecorded resources are preserved;
installed dependencies and hooks remain under the amended lane rule.

Noticed: the initial guest exceeded its entry-file boundary; its result is
qualified above. The first clean confirmation logged Docker events immediately
to the canonical handoff ledger but copied its own secondary event log only at
closeout. Its follow-up tees container events immediately; the label-filtered
stream omitted Compose network events, whose exact status/inspect identities
were appended later. The k3d row added an immediate name/type observer. The
follow-up verdict discloses this timing limitation. Guests reported verbose duplicate
env/lock progress and no completion summary; these remain outside this repair.

Not checked: matching round-6 specialist approval; native Mac/APFS spelling,
account/process/fsync modes and final Intel/Apple Silicon 1.0.0 artifacts; hosted
CI, actual host cutover or mixed old clients after cutover; arbitrary transient
containers before capture, delayed external producer effects, unknown create
completion loss, external Kubernetes, alternate/remote engines/drivers and
every instruction-level daemon/database interruption. No new waiver.
Historical unattributed Mac volumes remain untouched. This proposal grants no
merge, release, cutover or S1 adoption.
