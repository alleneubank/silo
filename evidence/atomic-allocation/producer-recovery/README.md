# Bounded history and finished-producer recovery

Verified Linux proposal; matching specialist round 7 and native Mac remain
required. Round 6 approved with conditions at 6c942863; its unchanged verdict is
retained here. Addendum 8 directs these author repairs. The human's recorded-ID
Docker deletion and verified recorded process boundary is unchanged. No lane PR
edit, merge, release, cutover or S1 adoption occurred.

Final qualified source: `3f87992621a06888ec32c55afe46ec9b71211005`.
CLI SHA-256: `2e4f0501ccc6423900d902a70623a629917153cc7c0a772b6eef3cb779741ec6`.
Initial repair source 73114d2 / CLI 4601b51c is supporting history. Record-only
commits preserve the final executable inputs. Handoff pr-ops.md seals the actual
final ref and transport result. No hosted PR/CI state is inferred. Versions
remain 0.9.0; the major changeset targets 1.0.0.

## Construction

At 1024 records, terminal reconciled launches and their completion facts compact
in the transaction that plans another launch. Unresolved facts and resource/mount
history remain. Successful restart history cannot consume cleanup capacity;
capacity filled entirely by unresolved effects still refuses. Retries are bounded.

Every finite production create/hook/workload caller uses one producer runner;
the nonproducer runner's type permits none/delete only. A private capture
capability requires a started producer with known exit. Outputs or absence are
recorded with existing namespace/label/root provenance, then reconciliation seals,
then failure is reported. Down uses the same boundary after importing completion
facts or stopping live Tilt. Registry cluster/name provenance is identical for
zero and nonzero known exits; missing completion cannot grant capture. Reconciled
history cannot renew capture on retry.

Deletion still consumes only immutable receipted container/network IDs. Anonymous
data can disappear only with its exact parent. Named-cache resolution below is
a separate fixture-owner action. JSON deleted true/false denotes recorded
absence/active receipt, not a fresh presence query. Restart qualification has down
between runs; in-place Compose recreate remains outside that loop. Store format 2
is unchanged; no schema migration or reset.

## Author and guest observations

Onyx Linux x64, native Docker engine `114f4194-e27d-4d0b-82fc-201ecd0e9997`,
Bun 1.4.4, Janitor 0.3.1, Tilt fork and checksum-verified k3d 5.9.0. Environment,
checksum and qualification-input files bind the runs. Disposable filesystem
account views exercise native account lookup; HOME alone is not store isolation.
The author drove the built public CLI with real Docker/Tilt/k3d/Janitor.

| Check / scenario | Observation and raw evidence |
| --- | --- |
| Requested red controls | conditions-red.log: baseline 4c50596b at 6c942863 fails all three checks. Cleanup at 1023 records hits STORE_FULL after the first parent; a real API-port squatter leaves unrecorded k3d outputs; a real overlapping-IPAM network failure stays unresolved with no output. Individually recorded fixture objects are removed by their owner. |
| Initial repair | conditions-green.log and supporting-73114d2/all-qualified.log qualify the initial repair and unchanged neighboring paths. The initial full suite records 502 commands. They are not final-bundle qualification. |
| Registry-enabled failure | registry-failure-red.log at 73114d2/4601b51c shows the registry lacking io.silo labels and rejected after a known failed create. registry-same-state-recovery.log: final 3f87992 records the exact retained registry 9b68ba1e… from that same failure, deletes its ID/anonymous data, then retires after separate cache resolution. No manual registry deletion or store reset. The final permanent producers suite enables the registry and requires its receipt. |
| Remaining direct leaf | volume-red.log / volume-green.log: real Docker rejects an unsupported local-volume-driver option. Baseline 4c50596b strands the known failure; the initial repair records the existing network/absent volume and retires. Final producer mapping uses the same unchanged direct-create boundary. |
| Same-store recovery | same-store-recovery.log and volume-same-store-recovery.log retire the actual baseline known failed-create states through corrected public down in the same format-2 store. No empty-store replacement or invented success. |
| Required gates | registry-final-gates.log:147 tests / 397 assertions, typecheck including native harness, lint, knip, zero duplicate blocks and build pass. Both source commits run normal hooks. local-bare-push.log is a real pre-push-hook push of final source. |
| Final full author run | all-qualified.log:517 recorded commands, including expected refusal/fault probes; all 39 final commands, including 33 public cleanup calls, exit 0. rehearsal-summary.json and fixtures retain commands, outputs, events and handles. Existing legacy/peer/crash/file/k3d/volume/replacement/lifecycle and producer cases pass. |
| Observation wrapper | launchers/failure-observer-k3d.sh.txt forwards every argument to pinned real k3d, preserves its exit code, and records only owned node identities/logs on failure. Successful creates are unchanged. The final run's observed failures are intentional squatter cases; no daemon response is stubbed. |
| Final copied full example | example-summary.json and before/after provenance bind final 3f87992/2e4f0501. CI and web/API health pass. Ordinary down removes Compose while two Kubernetes deployments remain ready. Exact cluster cleanup removes anonymous mounts and retains cache/claims; independent cache-owner resolution permits retirement. |
| Receipt state / history | Receipt-cycle units and native lifecycle distinguish old deleted:true from fresh deleted:false IDs in the same generation. Resource/mount audit history survives launch compaction. |
| Guest | guest/verdict-guest.md passes four initial rows at 73114d2/4601b51c and live down/SIGINT retry. The unchanged input paths reuse that evidence. guest/registry-followup/verdict-guest.md passes the affected registry-enabled failure at final 3f87992/2e4f0501: exact registry/anonymous data removal, cache/22 claims kept, then owner resolution and clean/repeat. It does not claim to rerun the earlier rows on the final bundle. Learning used CLI/docs, no implementation/diffs/author evidence. |
| Authority inspection | source-authority-audit.txt records baseline cap/throw-before-capture controls, current no delegated teardown match, typed finished-producer/registry authority, compaction, JSON flags and exact-ID deletion sites. Standard one-off inspection, no permanent source/artifact checker. |

IPAM and unsupported-volume-option wrappers cause real daemon failures. Native
harness assertions use unmodified in-memory results; persisted output masks
synthetic token fields. redactions.json lists capture paths, counts and hashes
for those fields. IDs, creation metadata, nonsensitive provenance and outcomes
remain. One-off helpers are text. Private account stores, env/lock/kubeconfigs,
certificates, binaries and dependency caches are excluded.

## Failed runs and limits

The initial full run at 73114d2 (all-first.log) timed out in registry advertisement
before Tilt. Exactly five executor facts exited 143; down reconciled them, removed
exact parents/network and kept the cache. backend-failed-status.json retains the
facts. backend-diagnostic.log / numbered diag outputs then show an owned API 200,
node query and public CI success at unchanged 73114d2, followed by exact cleanup
and separate cache resolution. The initial timeout remains unattributed; guest
port timelines exclude overlap with that initial API window.

The first final-source full attempt (all-final-lb-failure.log) failed its second
same-generation k3d startup: the load balancer was restarting. The harness had
removed its nodes before logs could be collected. lb-diagnostic.log used a fresh
allocation at that root, reached the owned API and passed CI, with node logs
captured before cleanup; it did not reproduce the exact failed restart. The
bounded final full attempt added the failure-only observer above and passed,
as did the final example. The earlier restart failure remains unattributed.
Neither failure is labelled pre-existing or explained as a host limit.

The registry probe first lacked a registry-port setting. Its observer/fixture
helper then omitted the shortened registry name, and owner network removal
refused because that registry remained attached. The recorded instance was kept;
final public recovery removed it by its original ID. These setup/cleanup errors
are retained, not counted as clean red teardown.

Guest clean temporarily held claims while TCP TIME-WAIT was observed, then
succeeded. The first guest lacked a historical ID for a transient tools object.
The follow-up captured that tools ID, but its registry ID was first recorded
from the failed-create receipt and independently inspected before deletion,
rather than captured at create time. Both accounting limitations are explicit;
current namespace absence does not prove historical transient completeness.

The first capacity unit incorrectly used a never-granted intent, which retirement
correctly cancels; it was replaced with a started failed tool while keeping the
refusal assertion. A standalone typecheck used an unavailable library alias;
normal tsconfig typecheck includes the harness and passes. The first one-off
census parsed container-log pid=1 as a host handle; the corrected parser reads
host numbers only from explicit ledgers, grants and PID files. Failed probes stay.

The initial client-version probe outside the view emitted the host k3s wrapper's
default-config permission warning. environment-probe-note.txt records its repeat
inside the disposable view with explicit KUBECONFIG. Workload/API calls used owned
kubeconfigs. No credential or system configuration changed.

audit.json at2026-11-06T06:18:01.066Z: author 103 and guest 5 projects had zero active
generations, claims, resources and operations. All 476 recorded Docker handles
and 2694 PID/group numbers were absent. Auditor group was excluded, then checked
absent in audit-final-group.txt. Later record/push groups and scratch teardown
are sealed in handoff. Shared images/cache and unrecorded resources are preserved;
installed dependencies/hooks remain. The audit is scoped, not host-wide.

Not checked: matching round 7 approval, native Mac/APFS/account/process/fsync,
final Intel/Apple Silicon artifacts, hosted CI, real cutover/mixed clients,
pending-capture attribution and read-only executor-validation hot-journal windows
(notes 3/4 unchanged), unknown create completion loss, delayed daemon effects,
transient parents before capture, in-place Compose recreate, external Kubernetes,
alternate engines and every instruction-level interruption. No new waiver.
Historical unattributed Mac volumes are untouched; this proposal grants no merge,
release, cutover or S1 adoption.
