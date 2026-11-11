# Container-scoped anonymous-volume cleanup

Historical round-4 record, superseded by the recorded-ID teardown record in
`../recorded-id-teardown/`. The round-4 specialist rejected delegated Tilt
teardown; this document describes the behavior and observations at 20997dc,
not approval of that behavior. Raw `.log` files cited here were present in the
lane but excluded from a7359a45 by a host-global ignore. They are now included
unchanged in this evidence set, with a repository exception for qualification
logs. The earlier
claims verdict checked local files; it did not establish their Git membership.

Verified local proposal; this lane performed no merge. Live GitHub state was
not queried. Source is
`20997dc740bd1df00c351cb4db6b4ba20734e47b`, built CLI SHA-256
`90a44fcc8641b959544e2cb9e9525d469b8749ea8abc680ababe87b7329e7e0f`.
The coordinator owns proposal publication, specialist round 4, native Mac
qualification and release decisions. No matching specialist approval is claimed.

The human's 2026-11-05 02:21Z decision in silo-redesign addendum 1 replaces the
unique-name design: remove anonymous volumes with their recorded parent, never
by name. Receipts retain mount handles for audit. Leaked/replaced names and
retained named volumes block clean/reconfiguration with claims intact. This
conservative refusal policy is recorded in SPEC.md; it does not waive cleanup
or external-review gates.

## What changed

Built-in Docker deletion accepts only container/network targets. Compose
parents are removed by exact ID with `--force --volumes` before Tilt teardown;
explicit k3d deletion uses the same parent path, then exact network IDs. The
name-based anonymous-volume leaf is removed. Named volumes are preserved.

Docker preserves explicit named mounts and volumes still referenced by another
container. Inherited anonymous volumes can be removed when their last user is
removed, even if that user inherited them. Silo therefore retains its inherited
provenance refusal before removal. These behaviors were driven against real
Docker, not inferred from labels. Sources: [Docker container rm](https://docs.docker.com/reference/cli/docker/container/rm/),
[Docker volumes](https://docs.docker.com/engine/storage/volumes/).

k3d 5.9.0's named image cache remains after explicit cluster deletion. Clean
refuses until its owner resolves it independently. A native attempt to disable
that cache failed tools-node creation; the final proposal retains the supported
configuration, never a name-delete exception. The native backend/full-example
harness independently removes only its own recorded synthetic cache after
verifying its creation identity, project and generation; that is fixture-owner
teardown, not Silo cleanup. [Pinned tools-node source](https://github.com/k3d-io/k3d/blob/v5.9.0/pkg/client/tools.go#L389)
and [cluster creation](https://github.com/k3d-io/k3d/blob/v5.9.0/pkg/client/cluster.go#L57)
explain the observed dependency.

Recovery imports durable successful exact-delete facts through the shared
reconciliation rule. Only earlier matching intents can be resolved; an older
success cannot cancel a later failure. No schema migration, timeout reduction,
assertion weakening, source/artifact checker or waiver was added. Existing unit
assertions remain. Native volume expectations changed only where addendum 1
changes the contract: shared/orphaned names are preserved, and named-cache
cleanup belongs to the fixture owner.

## Red first

Baseline runtime: `fff3083dc1974f1856835a5ed8424c7f26ebb19a`, artifact
`40fd990ead9815f2f679b43e16eb65fc111fe0a798e08988e9a85667206e43a6`.

| Scenario | Baseline observation | Corrected observation / evidence |
| --- | --- | --- |
| Same-second same-name replacement | Original/replacement CreatedAt seconds match. Public clean deletes replacement and retires. | Replacement and claims preserved; clean/force refuse. `same-second-red.log`, final all-suite and raw fixture command results. |
| Replacement at paused name-delete boundary | Transparent Docker wrapper pauses after inspection; fixture replaces volume; resumed baseline deletes replacement and retires. | Built-in name deletion is absent, so the unsafe pause is never reached. Clean reports the orphan/replacement and preserves it and claims. `paused-delete-red.log`, final all-suite. |
| Parent removal with its anonymous data | Intentional Tiltfile teardown failure leaves the baseline parent present. | Exact parent and anonymous data already absent before the later Tilt failure; restored Tiltfile recovers. `parent-volumes-red.log`, final all-suite. |
| Successful retry followed by caller crash | Real network deletion first fails on a fixture endpoint. Retry succeeds; executor completion is durable while CLI is SIGSTOPped. CLI is then SIGKILLed. Baseline recovery strands the earlier failed deletion despite network absence. | Public recovery retires and releases claims, without deleting the absent network again. `retry-crash-red.log`, `retry-crash-green.log`, final all-suite. |
| Durable completion import, unit boundary | Narrow lease-store test fails before the recovery change. | Passes after, together with ordinary retry and earlier-success/later-failure cases. `retry-red.log`, `retry-green.log`, `source-gates.log`. |

The two replacement fixtures seed the real creation-result boundary using
Docker's returned identities and the product's receipt capability, then run
the built public CLI. Capture/startup itself is covered separately by the real
Compose/k3d/example and guest runs. The scheduling wrappers forward every
other command to real Docker. The narrow unit test injects a persisted
completion fact; the native retry/crash row above uses an actual executor fact.

Focused green logs such as `retry-crash-green.log` are earlier supporting runs
with their own embedded artifact digests, not qualification of the complete
90a44fcc artifact. Current behavioral qualification is the final all-suite at
90a44fcc, the source gates/hook push, guest run, and the example run with its
contemporaneous before/after provenance receipts.

The first timestamp probe missed the same-second precondition; its failure is
retained in `same-second-precondition-failure.log`. The fixture was changed to
record Docker's creation results directly inside the timestamp window, rather
than measuring full CLI startup speed. No safety assertion was relaxed.

## Candidate qualification

Environment: onyx, Linux x64, Bun 1.4.4, SQLite 3.53.4, Janitor 0.3.1,
Docker 29.9.2/API 1.56, pinned/checksummed k3d 5.9.0, native Tilt fork
0.37.8-fork.20261009.g753c01455. Account stores are disposable filesystem views
of native account discovery; the real account store and production cluster
were untouched. `environment.txt`, `checksums-verified.log`, `artifacts.txt` and
`source-head.txt` give the inputs. Rehearsal commands use native Bun/Janitor
before mise shims; wrapper sources are retained as text.

- `source-gates.log`: **132 tests / 343 assertions**, typecheck, lint, knip,
  jscpd (zero clones), build. Normal source commit hooks pass in
  `commit-source.log`.
- `local-bare-source-push.log`: an actual push runs every pre-push hook;
  `local-bare-source-ref.txt` is the exact received source ref. No network Git
  operation or credential change ran.
- `all-final.log`: the full public-CLI all-suite passes across **339 recorded
  commands**, including expected refusals, legacy/cutover controls, live peer
  isolation/crash completion, file aliases, k3d create/retain/delete, all volume
  cases, inherited refusal and the durable retry/crash case. All **22 final
  fixture cleanup commands** exit 0. `rehearsal-summary.json` indexes scenarios;
  raw stdout/stderr/events/handles are under `fixtures/`.
- `example-summary.json`: the copied full example passes CI and web/API health.
  `example-provenance-before.json` and `example-provenance-after.json` bind that
  run to clean runtime source 20997dc and artifact 90a44fcc contemporaneously.
  Every mounted Docker volume has a receipt: **six anonymous mounts plus one
  named cache**, with no missing or unmatched handle. The six anonymous names
  are absent after exact parent deletion. The named cache remains; public clean
  refuses with unchanged claims. Separate exact fixture-owner cache resolution
  then permits public retirement to generation 0/empty claims. Mount snapshots,
  before/retained/after status and all command outputs are retained.
- `guest/verdict-guest.md`: fresh independent guest is green at this exact
  artifact, including real Redis CI, peer status preservation, ordinary/repeated
  clean, named/explicit data readback after reopening, shared/orphaned data and
  replacement preservation, repeated refusals, owner resolution and retirement.
  The guest did not read implementation, diff, PR or author sessions. Its raw
  logs and exact ledger are retained beside the verdict.

No stated onyx inotify/firewall limit blocked these driven scenarios. This
observation does not qualify untested networking or a different host.

The first example run supported its behavior but lacked a contemporaneous
artifact identity receipt. Only the example was repeated to close that gap;
its earlier outputs remain under `example-historical/`. No runtime source was
changed, and unrelated passing evidence was reused.

## Failures, cleanup and limits

The earlier `all-suite.log` records the discarded `--no-image-volume` attempt,
not a pass at this candidate. Its physical partial resources were individually
attributed and removed by exact container IDs with volumes and exact network
ID (`no-image-volume-partial-*.json`). Its archived disposable store retains
one unresolved failed creation, 24 claims and one historical active resource
row; the referenced physical network is absent. The uncertainty was not
silently reconciled. The final author and guest stores are separate from that
archived experiment.

A first volume run exposed a retained-state code expectation mismatch. Its
failure is `volumes-green.log`; the fixture was recovered using exact
snapshot-verified owner cleanup, and subsequent native cases pass. The existing
ALREADY_RUNNING code also covers retained/uncertain state; the guest found
that mildly confusing but observed no unexpected code or safety failure.

`audit.json`: author **20** and guest **5** project records are all generation
0, with zero claims, active resource rows or operations. Across current and
archived runs, all **153 recorded Docker handles** and **1,086 recorded numeric
PID/group handles** are absent. Shared images/build cache and every unrecorded
object are preserved. The audit is scoped to recorded handles, not a host census.
Private env/lock/kubeconfig/account files are excluded from committed evidence.
Scratch/build/dependency teardown and any final proposal-ref hook push are
recorded in the coordinator handoff after the record commit.

Not checked: matching specialist round 4, native Mac/APFS account/process/fsync
and case modes, final Intel/Apple Silicon 1.0.0 artifacts, new hosted CI, real
host cutover, lost executor facts, arbitrary transient tool containers before
capture, alternate/remote engines/drivers and every instruction-level daemon
interruption. No new waiver. Preserve historical unattributed Mac volumes;
this work grants no deletion authority for them.

Statements about this lane's absent publication/network actions are lane
attestations, not live GitHub-state verification.
