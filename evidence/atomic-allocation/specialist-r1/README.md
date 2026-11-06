# Specialist round 1 correction evidence

The [verdict](verdict-specialist-r1.md) is **changes required** at
`5344574fd4f380c86f625a84bcd7ccb6d2918643`, executable source `d6590a5`.
This record supplies author corrections and evidence, not a new specialist
verdict. The [review response](../../../review-response.md) answers every finding.

Allocation source: `6ffaa5bf18c0f33a828dad36d61e7d9cd60fa4c7`, artifact
`ef71f2449f772d52dc3a47e3dc81490756dc95f59bb3268dd61ad6d972c88a75`.
The native all-suite rehearsal began from that exact source tree and it was
committed unchanged with passing hooks. Current executable source
`4b0a9323f65fef62dfa82936d292110ef6714d40` changes only the CI --force help
sentence; artifact
`2675670dc14c3db290a18956f0fdd57f443d7e062b82b2b65e79b64e22e0318e`.
The unchanged allocation observations and guest remain applicable; built help,
the fresh full example and local pre-push hooks were driven at the latter head.
Later document/evidence-only commits reuse these inputs.
The [build identity record](build-identity.json) retains a successful rebuild
and matching digest at the unchanged executable source. The full-example
stdout log lacks a per-run command/hash prologue: its attribution uses the
author's pre-invocation hash/command observation, unchanged bundle bytes and
the retained result. The later identity record is not presented as a prologue
captured during that earlier run.

## Environment, scope and approval

ae-dev Linux x86_64, ext4; Bun 1.4.4 / SQLite 3.53.4; Janitor 0.3.1; Docker
29.9.2, engine `86f30b48-26b3-4a5b-8f5c-8c97fe963463`, local Unix socket;
k3d 5.9.0 / k3s 1.35.5-k3s1; Tilt 0.37.8-fork.20261009.g753c01455.
[Environment capture](environment.txt). `stat -f` names the ext family;
the host's `findmnt -T` reported ext4.

The canonical account home was resolved natively inside disposable filesystem
views. `/tmp` was a bind of the lane's owned `-tmp`, and `/home/ae` a bind of
its private author or guest account directory. The package was mounted at
`/mnt`. No release/runtime store override or real account store was used.
Docker was shared; only newly created, recorded fixture handles were mutated.

The threat model remains trusted local users/agents, accidental collisions,
crashes, deletions and non-silo squatters. Config, hooks, installed tools and
OS are trusted. No malicious local attacker, containment of arbitrary shell,
real host cutover, or peer cleanup is in scope. Plan basis remains Kimi r3's
conditional approval, r5's stop/recreate contract and the owner's recorded
stop/recreate and procedure-A decisions. Addenda 1/2 authorize these corrections
and local commits, with the coordinator performing the proposal push.

## Checks and author observations

| Surface / input class | Observation | Record |
| --- | --- | --- |
| Pre-fix allocation source at 5344574 | Six contract cases fail: dropped role, folded-key/path retarget, publish sync retry, delete sync retry, short append, interrupted append retirement. 21 neighboring cases pass. | [before-fixes.log](before-fixes.log) |
| Corrected native SQLite/filesystem boundary | All 27 lease cases pass, including the six distinguishing cases. Tests inject only the named filesystem failure; the store, other file effects and successful fsync are real. | [file-obligations.log](file-obligations.log) |
| Required Bun suite and tools | 129 tests pass; typecheck, lint, knip and jscpd pass (zero clones). Build succeeds. Commit hooks pass. Local pre-push hook runs all its commands successfully, without a Git network operation. | [tests.log](tests.log), [pre-push-local.log](pre-push-local.log), [code hooks](commit-code.log), [help hooks](commit-help.log) |
| Author's built public CLI: concurrent A/B, live/lock-only ownership, crashes, squatter, failed teardown, aliases, legacy/cutover and native k3d | Full all-suite result pass, followed by zero-exit cleanup for every fixture. Includes the genuine old paused writer, post-cutover old-client limits and pre-grant/post-rename crashes. These were repeated because the generation-release and recovery changes can affect them. | [linux-native.log](linux-native.log) |
| Author's k3d enabled-to-disabled flow | Real owned cluster and kubeconfig published; exact backend deletion retains snapshots; forced role removal refuses with old bytes/path/generation/claims unchanged. Recorded-target cleanup removes the old kubeconfig despite the config edit; disabled allocation has no old file claim; final claims empty. | Native commands 121–130, [raw captures](native-captures/), aggregate scenario/hash in linux-native.log |
| Pinned baseline 0.9.0 same-name cluster | Different root's CI succeeds using the original node ID and creation identity, then that root's down deletes the original cluster. Deliberate red observations; owned fixtures only. | [baseline-controls.log](baseline-controls.log), [selected captures](baseline-captures/) |
| Pinned old-client peer deletion | 0.5.9 deletes the peer reservation when its lock snapshot is absent. 0.9.0 preserves the entry and hash in the same schedule; its reader lacks that GC class. The saved owner lock is restored before its own old down. | baseline-controls.log |
| Fresh guest using the package | Both changed transitions pass, with repeated refusals, early SIGINT attempts, actual byte/claim preservation, edited-config cleanup and final empty claims. An unrelated sentinel survives and is cleaned by its own owner. | [green verdict and captures](guest/verdict-guest.md) at 6ffaa5b / ef71f244 |
| CI --force help | Built help now says “Reconfigure only stopped, reconciled state.” Copy-only follow-up to the guest observation; no behavioral guest re-run is claimed. | [help-ci-after.txt](help-ci-after.txt) at 4b0a932 / 2675670d |
| Fresh full example and normal CI append | Original example inputs pass CI in generation 2. Web/API deployments available, real service-proxy responses identify atomic-r1-example. Export contains the complete generation-2 environment, no uncertain sink remains, and original public down --delete-cluster --clean retires the generation. | [example run](example/example-r1-second.log), [health](example/example-r1-health.txt), [web](example/example-r1-web.html), [API](example/example-r1-api.json), [checks/mounts](example/example-r1-second-checks-mounts.jsonl), [clean](example/example-r1-second-down.log) |

The published legacy tarball digests were verified again: 0.9.0
`34d4c96b6f7a21ec688aa66b561527cfa215633e0743d771261caa7e45dd5c6b`;
0.5.9 `bbbbe93f47b4bc537ee28e740d32ba78080a2e2cda82781cf959a269468281a2`.
Their built CLI digests appear in baseline-controls.log. The earlier retained
9882041 controls for duplicate ports, output escape and failed teardown remain
valid for those unchanged baseline inputs; they are not substitutes for the
new same-name/peer controls.

## Whole-class audit

The audit followed every whole-generation claim release and every snapshot or
sink completion, then the actual env/up/ci/down callers. `commitAllocation`
and `retire` are the only whole-generation release callers; both consume the
same private `releaseGenerationClaims` boundary. That boundary enumerates
previous receipts, not just incoming roles, and refuses any uncertain sink.
It checks exact-path/receipt transfers or discharged snapshots before deleting
claims inside the transaction. Config is a read-only binding, not a mutation
capability. Initial generation-zero allocation has no prior obligation.

`OwnedFile.recover` is the only place completing a pending publish/delete;
both branches now require parent synchronization even when the filesystem
effect is already visible. File deletion never consumes a newly resolved
config path. The successful CI sink path releases only its own key after a
full byte count, file sync and unchanged identity. The generation paths no
longer delete an append-uncertain row. Existing backend and executor absence
proofs remain ahead of release; the transaction still rolls back conflicts.

The audit additionally found and closed capitalization-only retargeting and
the previously reported append-uncertain retirement path. Both have retained
pre-fix failures and corrected observations. No further reachable file-
obligation drop was identified in this inspected scope. This is not a claim
that every instruction-level interruption or storage failure was exercised.

## Preserved failures and boundaries

The first extra example reached a k3s bootstrap failure: its logs report that
cloud-controller-manager cannot read a required configmap, then shuts down;
the exact node restarted and Tilt received API errors. Original public down
also failed on the unavailable API and retained ownership. See the first CI,
down, diagnostics and safe-error captures under [example/](example/). This
run is not called pre-existing, flaky, or a pass.

To dismantle that disposable fixture, exact container/volume/network receipts
were checked by name and creation identity before removal; captured mount
handles were then proved absent. A teardown helper first refused Docker's
plain-text network timestamp representation and succeeded using JSON's exact
timestamp. Only after all backend objects were gone was the fixture's Tiltfile
temporarily replaced for ownership reconciliation. Its port-free check
conservatively refused a remaining TIME_WAIT; after native free-port observation,
public cleanup succeeded. The original Tiltfile was restored before the fresh
generation's successful example. These operations qualify cleanup only, not
the failed example. Their logs are retained under example/.

The fresh example's Compose/Tilt teardown left one anonymous Redis /data
child. Its exact handle and parent container had been captured before teardown;
it was verified unused and individually removed under the synthetic-fixture
grant. [Cleanup receipt](example/redis-child-cleanup.json). This does not claim
automatic removal of arbitrary Compose anonymous children. Native k3d node/
registry anonymous-child removal remains separately observed. Historical
unattributable volumes and shared caches are untouched, per the settled
preservation decision; no age/name-based selection occurred.

Setup friction was isolated from product results: the shell Bun function
resolved Janitor through an unselected mise shim despite an assigned PATH.
Direct pinned binaries and a version preflight supplied the passing runs.
The guest's initial nonexistent /product mount was changed to existing /mnt;
the package bytes did not change. Full k3d JSON captures were reduced to
cluster/node names because runtime labels carry transient tokens; no such
token-bearing capture is retained. The control cluster was destroyed.

## Remaining gates and closeout

No corrected-head cross-provider specialist verdict, native Mac/APFS case-
mode/architecture qualification, new hosted CI, real host cutover or final
1.0.0 artifact qualification is claimed. The Mac instructions include the
changed transitions, native fault cases and exact old-client control commands.
PR #58 remains draft; merge, ready transition, versioning, tag, release and npm
publication are not authorized here. No waiver was added.

The [independent claim fact check](fact-check.md) supports the stated
observations with explicit provenance limits. It began at ec0df6e and checked
the linked-log correction at 2d99da8, then checked the later build identity
capture. This is not the required cross-provider implementation specialist
verdict. Its missing-log finding is closed; the final record commit also
tracks the subsequently inspected build identity file. The example's absent
per-run prologue remains disclosed above.

The [final scoped audit](final-audit-after.log) found both disposable stores
with zero active generations, no recorded remaining object/mount handle, and
no live recorded PID. The earlier audit caught the Redis child and is retained
as [final-audit-before.log](final-audit-before.log). Scratch, dependencies and
build output are removed after these records and the coordinator handoff are
committed. The coordinator applies the explicit proposal push/PR operations;
this lane makes no Git network call.
