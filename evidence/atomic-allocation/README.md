# Atomic allocation evidence

Candidate artifact SHA-256:
`6e5e0848141659a58a316071623bc63eb05716cc8f16d68bb4bcdb8eb325b8d0`.
The implementation commit containing this record is the source revision;
later evidence-only commits reuse observations while covered inputs stay
unchanged. The package remains 0.9.0 until the approved 1.0.0 changeset runs.
No versioning, release or actual host cutover occurred.

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
The implementation specialist and native Mac qualification remain pending;
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
