# Current qualification

The lifecycle reconciliation proposal and its current Linux observations are
indexed in [lifecycle-reconciliation](lifecycle-reconciliation/README.md).
The earlier [recorded-ID teardown](recorded-id-teardown/README.md) was rejected
by specialist round 5; its source identities and observations are historical. Earlier
records below retain their original source identities and superseded behavior;
they are not matching specialist approval of the current candidate.

# Historical atomic allocation evidence

Current proposed cleanup source: `20997dc740bd1df00c351cb4db6b4ba20734e47b`,
CLI SHA-256 `90a44fcc8641b959544e2cb9e9525d469b8749ea8abc680ababe87b7329e7e0f`.
The [container-scoped cleanup record](container-scoped-volumes/README.md)
documents the human-approved removal of anonymous data with exact parent
containers, audit-only mount receipts, leak/named-cache refusal, native
replacement/crash regressions and current qualification. Fourth specialist
review and corrected native Mac qualification remain required. The records
below qualify their named historical inputs, not this complete artifact.

Earlier cleanup correction: `a21f710896528aeaed5a6c142abc13a80895f1ba`, CLI SHA-256
`40fd990ead9815f2f679b43e16eb65fc111fe0a798e08988e9a85667206e43a6`.
The [anonymous-volume record](anonymous-volumes/README.md) supersedes the
former Compose cleanup limitation: copied-example Linux baseline leaks Redis's
image-declared anonymous child; parent-bound receipts and exact clean remove
it. Full gates, all-suite and full-example Linux checks pass. Specialist round
3 and native Mac qualification of this changed runtime remain pending.

Historical executable source before that correction: `80f4974d0f9e2db056ceb7ba771fe12597d5afad`;
artifact SHA-256 `9965e0b2fde3397eadc7c507ae2e7afafd7f0a4b3accfdc84411fba803185894`.
The [owner-crash observation correction](crash-completion/README.md) records
the Mac timing failure, a controlled Linux reproduction of its ordering,
the exact-completion wait at cf0b2b2, full gates and a fresh uninstrumented
Linux all-suite pass. Product source and built bytes are unchanged.
The retained [round-2 verdict](crash-completion/verdict-specialist-r2.md)
is approve with conditions at fd710d9; native Mac qualification, host cutover
and final release approvals remain open.
The [real-push investigation](prepush/README.md) records the Linux shim
failure, supervisor-error regression, fixture-directory preflight, native
public-CLI rehearsal and actual local-bare push with 130 passing tests.
The historical Mac push cause was not attributed by that Linux record; the
later native Mac run passed its real local-bare push and failed at the separate
crash probe described above. The launch change retains
diagnostics after the existing drain and leaves the grant/claim paths intact.

The [specialist-round correction record](specialist-r1/README.md) contains the
whole-class audit, all four review responses, six retained pre-fix failures,
129 passing tests, fresh Linux rehearsal, missing baseline controls, fresh
guest and full example, preserved failures and scoped teardown. Round 1 was
**changes required** at 5344574; round 2 at fd710d9 resolved those findings
with owner-only qualification and release conditions.

The records below are historical qualifications at their named source/artifact,
including `4b0a932`, `6e5e0848` and `1a09c981` artifacts. Evidence-only commits
reuse observations while covered inputs stay unchanged. The package remains
0.9.0 until the approved 1.0.0 changeset runs. No versioning, release or actual
host cutover occurred. Historical unattributable anonymous volumes are
preserved by the coordinator's settled addendum-1 decision.

## Environment and approval

Author: lane silo-impl on ae-dev, Linux 6.8.0-147-generic x86_64, ext4;
Bun 1.4.4 / SQLite 3.53.4; Docker client/engine 29.9.2, local Unix endpoint,
engine `86f30b48-26b3-4a5b-8f5c-8c97fe963463`; k3d 5.9.0 / default k3s
1.35.5-k3s1; Janitor 0.3.1 (`f9d8de4`); Tilt
0.37.8-fork.20261009.g753c01455. Rehearsals used a disposable filesystem
account view with the public CLI's native account lookup, never a runtime
store override or the real account's `.silo` state. Docker was the native
shared engine; only newly owned fixture objects were mutated.

High-risk basis: Kimi's r3 plan verdict `approve with conditions` at plan SHA
`0226cebaa39b2ef50a390f828be57781c72c343907315f60c8cfa99997f2aadf`, the owner's
23:3xZ stop/recreate choice, and the r5 refusal revision SHA
`a205fbf98d130573daca1927b95944ac9bfc32386e725e8d3cbc5011a3bb8b4f`
with the owner's 00:4xZ choice A: all permitted old invocations upgraded or
retired and every old operation terminal before the first clean scan/allocation.
The final plan-review verdict still requested that precondition; the owner
closed it explicitly. No standalone r5 approval is claimed.
Original approval records are in the coordinator's boss-mobile-release handoff.
Corrected-head specialist approval and native Mac qualification remain pending;
this record is not approval to merge or release.

## Author run

The author drove the built public CLI through the portable harness in
`scripts/allocation-rehearsal.ts`. [linux-native.log](linux-native.log) records
its artifact digest, each real command/exit status, scenario observations,
exact created resource IDs, and successful cleanup. It ends with suite pass
and zero-exit cleanup for every fixture. The same command is given in
[macos-rehearsal.md](../../macos-rehearsal.md).

| Risk/input class | Observation and verifier |
| --- | --- |
| Concurrent lock-only and live allocation | Two CLI roots have disjoint claims/ports; real Tilt services answer distinct identities. Killing A preserves B's exact public state and endpoint. |
| Peer mutation and stale generations | Native SQLite/filesystem tests preserve peer claims/bytes through owner retirement; physical root aliases share one mutex; finished/stale capabilities refuse. |
| Name and physical-file conflicts | Prefix overlap and equal names refuse; public nested/case-folded outputs refuse unchanged. Filesystem tests cover cross-role alias, hardlink/symlink, traversal, changed config/parent and replaced snapshots. |
| Legacy state | Real published 0.9.0 env leaves lock-only entries in each of the three locations. All five commands refuse in old and unrelated roots, with listing and unchanged trees/store bytes. Malformed pre-registry lock refuses too. |
| Cutover precondition | Genuine old artifact paused before registration; procedure waits for it to finish, old down retires it, then new allocation succeeds. No automatic process drain was claimed. |
| Old clients after cutover | Published 0.9.0 and 0.5.9 both allocate the new lock-only numbers; SQLite bytes/claims remain unchanged and visible JSON blocks new status. Recorded as unsupported limits, not isolation passes. |
| Launch gate and crash | SIGKILL before durable grant executes no hook and drains the actual child group; serving-owner crash retains claims and durable child completion permits owner-only down recovery. Failed checkpoint test also leaves its canary absent. |
| Export interruption | Real CLI SIGKILL after rename/before receipt checkpoint; owner recovery recognizes only its journaled inode. Separate filesystem test refuses an unrelated replacement. |
| Squatter | Ordinary server binds after reservation; real Tilt CI fails PORT_BIND_CONFLICT; listener survives and ports/claims stay fixed until it stops. Native port tests cover IPv4, IPv6 and UDP. |
| Backend leftovers | Native network/volume and synthetic stopped k3d server/registry containers refuse unchanged; unreceipted env/kubeconfig/version-2 lock refuse unchanged. No live foreign cluster or foreign data was deleted. |
| Backend lifecycle | Real k3d creates exact nodes/registry/network/volume and kubeconfig. Retained clean refuses; explicit deletion verifies recorded IDs absent. Owner-labelled out-of-namespace object refuses without gaining cleanup authority. Unreachable Docker refuses. |
| Failed teardown | Real invalid Tiltfile makes down fail and retain claims/snapshots; successful exact retry reconciles completed deletes. Unknown/missing completion and failed creating requests stay retained in focused tests. |
| Actual example | Real example CI, available web/API pods, native service-proxy health, Compose container/network and k3d receipts; explicit teardown. See example-status/health/clean records. |

[tests.log](tests.log): 123 passing Bun tests, no failures. `typecheck`, `lint`,
`check` (knip and jscpd, zero clones), build, and the packaged skill validator
passed. Injected-store tests do not qualify Docker or the canonical child
completion path; the public native rehearsal covers those separately.

## Baseline and noticed failures

At origin/main `9882041`, the deterministic native control observed duplicate
48127 reservations and an escaping output overwriting its literal peer canary
([baseline-red.log](baseline-red.log)). The pinned 0.9.0 public control also
reports successful clean despite failed Tilt teardown, in linux-native.log.
These controls prove those named failures, not all old-version behavior.

Preserved failures and corrections:

- First serving-owner crash left a local server alive. The repeat passed after
  redundant executor signal forwarding was removed. Both records are retained;
  this sequence does not isolate it as the only possible causal input.
- Bun 1.4.4's userInfo home followed HOME in a direct experiment, despite the
  [documented API](https://bun.com/reference/node/os/userInfo). Native account
  queries and a scrubbed-HOME regression replace that runtime assumption.
- k3d's actual registry name lacks a `k3d-` prefix. Corrected claims/capture
  then passed native creation, retention and deletion.
- Tilt's directory-name Compose default created two owned fixture objects
  outside claims. The example now passes project_name explicitly, matching
  the [Tilt API](https://docs.tilt.dev/api.html#api.docker_compose); runtime
  attribution refuses owner-labelled scope drift. The exact two fixture
  objects were individually inspected/removed; no peer cleanup occurred.
- A failed delete initially remained unresolved after successful retry.
  [deletion-retry-failure.log](deletion-retry-failure.log) and its recovery
  record preserve that finding; the final harness includes the corrected flow.

## Verdicts and gaps

The packaged-skill comparison is a decision-only pilot; both arms used current
docs successfully. It establishes no causal effectiveness gain. The fresh
[guest verdict](guest/verdict-guest.md) is green against the same immutable
artifact, with real Tilt API and k3d observations and capture links. It does
not qualify browser UI, valuable-data recovery or the unchecked classes below.
No implementation specialist verdict ran; see the cross-provider request.

Not checked: macOS/APFS or other CPU architectures; real data-bearing foreign
clusters; real ae-dev cutover/pin upgrades; Docker IPv6 publication races;
Tilt's independently selected internal API listener failure; a live vendor
request deliberately losing its completion during daemon outage; every
instruction-level crash timing. These stay explicit gaps and release gates,
with no waiver. No BOSS repo, peer registry, existing project, shared builder,
credential configuration, tag, release, npm publication or merge was changed.

Source revision: `e4e77aa978cca4aa8210b0695123a7b8e7fa402d`. The author
observed its commit hooks pass lint, format and typecheck. The final public harness
also covers an actual owner SIGKILL before grant and a failed Tilt down retry;
both passed. Raw `.log` evidence is intentionally retained despite this host's
global log-ignore preference.

The final full example was repeated at e4e77aa and the exact artifact digest
above; example-built.log records both before launch. example-status.json now
contains that built run's `/mnt/dist/cli.js` identities, with matching health
and clean records. Selected raw native refusals are in native-refusals.json.
Fresh typecheck/lint/skill-validator outputs are retained. The historical
source-commit hook result is author-observed; later evidence-commit hooks have
a separate retained [output](commit-hooks.log). The guest's stopped/reconciliation hesitation was
addressed in troubleshooting copy only; executable source and digest stayed
unchanged.

The first hosted example workflow passed unit CI but failed its legacy 0.5.9
fixture: inherited `GITHUB_ACTIONS=true` made that old binary require the
intentionally empty GITHUB_ENV. The native harness now removes the Actions
marker from its fixture subprocess environment, alongside its explicit CI=false.
The published CLI artifact is unchanged. The corrective local run supplies
GITHUB_ACTIONS=true to the harness itself; allocation-actions.log records the
result. The initial hosted failure is retained verbatim.

## Anonymous-volume correction

A second hosted run exposed unordered Docker Mounts output in the fixture's
byte comparison. The snapshot now parses all fields and compares them deeply,
normalizing only Mounts order by destination. No identity/content assertion was
removed. That observation also showed the omitted anonymous-volume cleanup.
Exact owned k3d container removal now uses `--volumes`, delegating anonymous
child removal to Docker for that container ID. Named volumes remain separate
receipts; external named volumes are not removed by that option, per the
[Docker command contract](https://docs.docker.com/reference/cli/docker/container/rm/).

Corrected artifact SHA-256:
`1a09c9812329a16342f95b7c006ddd5d844f611c6dbb3b5febca6a0e21396abc`.
[volume-backend.log](volume-backend.log) records real container mount handles
before teardown and proves all fixture-attached named/anonymous volumes absent
after explicit cluster deletion. Typecheck, lint, check and 123 tests passed.
A full repeated local run safely refused clean when a declared port could not
be proved free; a fresh socket query later found it absent and ordinary owner
clean succeeded. This was not bypassed or graded as a passing full rerun.
Earlier full-flow evidence covers unchanged code; the corrected deletion path
has its separate native run; refreshed guest coverage was pending at that point
and is recorded below.

Historical cleanup gap: earlier experimental container removals omitted the
anonymous-volume flag. Exact old native inspect captures identified 25 unused
anonymous children; their parent identity, creation time, labels and absence
were verified before individual non-forced removal. The manifest and removal
log are retained. Older real-cluster anonymous volume IDs were not retained,
and the Docker event window no longer contains those mount records. Such
unattributable volumes cannot safely be selected or deleted on this shared
host; they remain untouched. The label/name audit proves only recorded scoped
objects absent and does not establish that every historical anonymous child
was removed. This host-cleanup limitation remains explicit for the coordinator.

Previous executable source: `d6590a5bb129cb90cb50bb1617bfe3ac966d907b`,
artifact `1a09c9812329a16342f95b7c006ddd5d844f611c6dbb3b5febca6a0e21396abc`.
[linux-native-final.log](linux-native-final.log) is a passing full all-suite run
at that source, after the external port became free. The refreshed
[deletion guest](guest-r2/verdict-guest.md) is green at that artifact, including
an unchanged named control-volume sentinel. Hosted CI and example jobs also
passed at that source; github-checks-d659.json records their exact run URLs.
The two earlier hosted failures remain retained and attributed.

The refreshed guest initially inspected full labels into a private capture,
which included an ephemeral fixture token. The capture was replaced with
identity/mount allowlisting and the exact cluster was promptly destroyed.
The retained node capture exposes only allowlisted identity/mount fields; the
fixture's destruction invalidated that token. This inspection mistake does not
change the explicitly stated host-cleanup provenance gap.
