changes required

Reviewed head `3d94c7fa6d38eb95f7fc08c7aa55f8f37cad7867`. This session had no shell, so I could not run `git rev-parse`. `.git/HEAD` holds that detached SHA, and the session's Git snapshot reports a clean tree. Executable inputs as recorded: runtime `d9628d1`, source plus rehearsal `77e3d68`, CLI SHA-256 `b14266a4…` (`all-final.log:1`, `source-teardown-audit.txt:1-3`).

I read the head tree for down, ownership, k3d, tilt, the lease store, owned commands, the executor, up, ci, prepare and allocation, plus the config hook schema, SPEC.md, docs/commands.md, the changeset, the round-5 evidence README, the red/green race logs, the gates, and the example and guest records. I could not produce `git diff fd710d9d..3d94c7f` or read the a7359a4 source, so I judged the delta from the head tree and its callers. This verdict applies the supplied trusted-local threat model and the human's 2026-11-05 decision to delete by recorded IDs only.

The round-4 blocker is fixed: down no longer has any project-wide teardown authority, and I found no path that deletes a peer's or replacement object. The remaining blockers are different. In normal Compose and k3d flows, Silo cannot record what its own Tilt creates. Cleanup then refuses permanently with claims kept: safe, but the documented up/down contract is broken.

## Round-4 findings

1. **Resolved — unfenced project-wide Compose teardown.**
   - `src/commands/down.ts:32-37` now calls only `deleteOwnedContainers`/`deleteOwnedNetworks` and the optional `deleteCluster`. `src/backends/tilt.ts:1-26` has no teardown entry, and no `tilt down`, `compose down`, prune or k3d delete remains in `src/`. The author's audit shows the a7359a4 references as a positive control (`source-teardown-audit.txt:5-14`).
   - The only removal leaf is `src/backends/ownership.ts:273-285`: `docker {container|network} rm` on a receipt whose ID must be Docker's full 64-hex ID (`src/core/lease_types.ts:77-81`, tests at `src/core/lease_types.test.ts:10-19`). It is re-verified by ID and creation identity right before (276) and right after (280). Docker never reuses IDs, so a replacement Q is always a different target.
   - The regression I asked for exists (`scripts/allocation-rehearsal.ts:694-756`). The wrapper performs the real removal of P and then pauses (701). The script asserts P and its data are gone (711-713), recreates Q/W through real Compose (714), and resumes.
   - It fails on the a7359a4 artifact: Q deleted, W left, claims `[]` (`compose-replacement-red.log:1,17,22`). On b14266a4 it preserves Q, W, the data readback and all claims, refusing at the network delete while Q is attached (`all-final.log:353,357`). Retirement follows exact fixture-owner removal of Q (`all-final.log:359,403`).
   - Down hooks are rejected by the strict schema (`src/core/config.ts:25-30`).

2. **Resolved — missing raw logs.**
   - `.gitignore:31-32` re-includes `evidence/**/*.log`.
   - The index at this head contains every log r4 listed as absent under `container-scoped-volumes/`: same-second-red, paused-delete-red, parent-volumes-red, retry-crash-red, retry-red, retry-green, source-gates, commit-source, local-bare-source-push, all-final and checksums-verified. The round-5 logs are there too.
   - `paused-delete-red.log:7-10` shows the replacement volume being removed and recreated before the paused baseline `down --clean` returned, so the barrier was reached. That closes the gap I noted in r4.
   - `recorded-id-teardown/source-gates.log:191-194` records 139 pass, 0 fail and 356 `expect()` calls.
   - I checked membership by searching the index file, not with `git ls-tree`, and I sampled the logs rather than reading all of them.

## Findings

1. **Blocking (public CLI contract and availability; not peer deletion) — a recreated same-name object can never be recorded again within a generation, so the ordinary stop/restart loop wedges.**

   Source-demonstrated path:
   1. A Compose project records P (`<compose>-redis-1`) and N (`<compose>_default`) when `silo ci` succeeds or `silo up` exits (`src/backends/ownership.ts:222-229`).
   2. An ordinary `silo down` removes both by ID and tombstones their rows (`ownership.ts:277,283`; `src/core/lease_store.ts:607-611`). The generation stays reserved (`down.ts:56,65`).
   3. The next `silo up` or `silo ci` with the same config reuses that generation (`src/core/allocation.ts:66`). The pre-launch check looks only at live receipts (`src/commands/prepare.ts:39`), so it passes, and Compose recreates P2/N2 under the same deterministic names with new IDs.
   4. The post-Tilt capture (`src/commands/ci.ts:21`, `src/commands/up.ts:58`) matches the tombstones by name (`ownership.ts:205-208`) and throws `NAME_CONFLICT` (211). The store would refuse too (`lease_store.ts:600-601`): the resources table's primary key is `(project_id, generation, kind, name)` (`lease_store.ts:77`).
   5. Every later `down` sees the unreconciled Tilt launch, checks names against the tombstones (`down.ts:27-30`), and throws `NAME_CONFLICT` (`ownership.ts:170-173`). `up` and `ci` refuse at `prepare.ts:30-32`, and `--force` refuses at `allocation.ts:70-71`.

   The same thing happens in two more flows:
   - Tilt recreates a recorded service in a later session, for example after an image rebuild or config change: same name, new ID.
   - In k3d, after `down --delete-cluster` followed by `up` or `ci`, the network is recreated at `src/backends/k3d.ts:60` and its capture conflicts with the old network's tombstone.

   Outcome: P2/N2 keep running, claims stay held, and no Silo command can recover. The owner has to delete Silo's own containers by hand, which invites the project-wide `docker compose down` this decision was meant to remove from the workflow.

   Containers and networks have immutable IDs, so name-keyed, single-use receipts add no safety. Tombstones are needed for anonymous-volume audit; they are not a reason to reject a fresh exact-ID receipt once the earlier object is proven absent.

   No test drives this loop:
   - Every Compose fixture runs `ci` once per generation (`allocation-rehearsal.ts:380,407,444,564,696`; example driver line 60; guest row 7).
   - The k3d suite moves to a new generation before recreating anything (`allocation-rehearsal.ts:291-321`).

   Distinguishing check: on `composeProject`, run `ci` → `down` → `ci` with the same config → `down --clean`, and expect the second run to record the new IDs and then retire. Repeat with k3d (`ci` → `down --delete-cluster` → `ci`). The current source predicts `NAME_CONFLICT`, with the objects running and claims held.

   The name-keyed tombstone predates this round, and I could not establish how a7359a4 behaves, so I am not claiming a regression from r4. I did not raise this in r3 or r4.

2. **Blocking unless the owner ratifies it (contract) — objects created by a failed `silo ci`, or by a live `silo up` that `silo down` stops, are never recorded, and every later cleanup refuses.**

   (a) Failed `ci`:
   - `ci.ts:20` calls `runOwnedCommand`, which throws on a nonzero exit (`src/core/owned_command.ts:139`), so `ci.ts:21` never records anything.
   - `prepare.ts:74-79` then marks the generation cleanup-required.
   - Any Compose objects Tilt created before failing (a test or readiness failure, or a timeout) stay unrecorded, and `down` throws `NAME_CONFLICT` on every run (`down.ts:27-30`, `ownership.ts:171`).

   (b) `down` stopping a live `up`:
   - `up` releases its operation once Tilt starts (`prepare.ts:80`). `down` takes the operation (`down.ts:17`) and stops Tilt (22).
   - The `up` process then tries to reopen, gets `BUSY`, and returns without recording (`up.ts:45-50`). If it reopens later instead, it sees the phase is no longer running and returns (`up.ts:55`).
   - Its comment "down owns reconciliation" no longer holds, because down no longer captures anything (`source-teardown-audit.txt:58-59`; evidence README:19-20). The result is the same as (a).

   Likely regression: the README's failed-probe note (README:63-66) shows cleanup-time capture existed before this round, so (a) and (b) look like regressions from a7359a4. I could not confirm that from source.

   Disclosure gap: SPEC.md:170-172 and the changeset (`.changeset/atomic-project-allocation.md:36-41`) only disclose an "interrupted producer". A `ci` run that completed with a failure was not interrupted, and `docs/commands.md:12` presents `down` as the way to stop Tilt and remove Compose containers.

   Coverage gap: no evidence drives either path.
   - The live up/down tests use `local_resource` only (`allocation-rehearsal.ts:84-89,131-160`; guest row 10).
   - The copied-example harness works around a failed `ci` by importing the internal capture function (`example-rehearsal.ts.txt:61-64`). That branch did not run in the final pass (`example-summary.json:3`).

   Scope challenge, stated explicitly: the human's decision limits deletion authority. It does not say that a completed or Silo-stopped producer must go unrecorded. Recording the generation's own finished launch before any deletion uses the same provenance as the success path (`ownership.ts:222-225`). That is a different boundary from the r4 race, which happened after the exact parent had been removed. Whether to restore that recording or ratify the limit is the owner's call.

   Distinguishing checks; the current source predicts `NAME_CONFLICT` in both, with containers running and claims held:
   - (a) A Compose fixture whose Tiltfile brings the service up and then fails a resource, followed by `down --clean`.
   - (b) A background `silo up` on a Compose fixture: wait for the container, then run `down --clean` from another process.

   The expected contract in both is stop, exact-ID removal and retirement.

3. **Should fix — a failed exact-ID delete whose target later disappears can never be reconciled.**

   At `ownership.ts:276-283`, when the `rm` exits nonzero, `runOwnedCommand` throws (`owned_command.ts:139`) before the reconcile at 281 and the forget at 283. If the target then disappears without a successful Silo retry, nothing can resolve the failed request. Realistic ways that happens:
   - This round's own replacement flow: the network delete fails because Q is attached (`all-final.log:353`), and the owner clears Q with a project-wide Compose down that also removes N.
   - Another agent accidentally runs `docker rm` on P between lines 276 and 277, so Silo's rm fails with "No such container".
   - The rm times out or is killed but the daemon completes it anyway, including one stopped by a recovering `down` (`down.ts:22`).

   On the next `down`, `verifyResource` returns false, so the receipt is forgotten (283) without running any command. Only exit-0 deletes reconcile earlier failures (`lease_store.ts:351,364-383`), and `down.ts:44` skips failed deletes. So `down.ts:48-50` throws `CLEANUP_REQUIRED` on every run, and reallocation refuses (`lease_store.ts:441-444,656-659`). The rehearsal only retires because N survived (`all-final.log:359,403`).

   Now that every target is a full immutable ID, a late effect of that failed request can only touch the same, already-absent ID. Docker resolves a full ID before an exact name, and a container deliberately named with another container's ID is outside the threat model. Once exact absence is proven, the rule holds claims without protecting anything.

   Claims stay held, which is the safe direction, so this is should fix rather than blocking. The behaviour comes from the earlier retry design; I did not raise it in r4.

   Distinguishing check: in `retryCrash`, after the failed network rm, remove the blocker and then the network by exact ID outside Silo, and run `down --delete-cluster --clean`. The current source predicts `CLEANUP_REQUIRED` indefinitely.

4. **Note — check-then-signal window when stopping Tilt by PID.** `owned_command.ts:155-160` verifies the supervisor's uid, that its process group equals its PID, its start time to the second, and that its command line contains the launch UUID, then sends `kill(-pid)`. A PID reuse inside that window would need a new same-user group leader, started in the same second, with that UUID in its arguments. That isn't credible under this threat model, so I accept it. A pidfd-based signal would close the window if Janitor or Bun exposes one.

## Construction checks that held

- **Owner-only deletion.**
  - There is a single removal leaf, IDs are branded, and each delete is verified exactly before and after. k3d uses the same leaf (`k3d.ts:88-95`), and there is no product volume deletion.
  - Docker's `rm --volumes` removes only that container's anonymous mounts that no other container still references. While P exists, Docker won't remove its volumes, so the exact-parent route can't reach a replacement name; inherited provenance is refused first (`ownership.ts:136`).
  - That is Docker's documented contract, as stated in SPEC.md:148-154. The borrowed and inherited fixtures (`allocation-rehearsal.ts:411-441,576-623`) are consistent with it; I did not re-derive it from the daemon source.
- **Replacement and foreign objects are refused.**
  - At entry, names are checked against tombstones (`down.ts:30`).
  - On identity mismatch, verification throws (`ownership.ts:240`).
  - The network delete refuses while a replacement is attached.
  - The residual-namespace proof refuses before retirement (`ownership.ts:256-270`).
  - A matching but unrecorded object is refused and left unchanged (`all-final.log:370`; guest row 11).
- **Claims are released only after absence is proven.** `down.ts:57-61` goes through `prepareRetirement` and `verifyTerminalResources`. These require:
  - no live receipts;
  - every launch terminal and reconciled;
  - an absent backend: labelled scope, historical anonymous names, claimed names and historical IDs;
  - free declared ports.

  Mutation is sealed during the proof, and retirement is fenced by operation token and generation (`lease_store.ts:651-690`).
- **Generation fencing.**
  - Each project has one operation token, and `open` returns BUSY unless the holder is provably gone (ESRCH) (`lease_store.ts:241-260`).
  - Every mutation re-checks token and generation (385-407).
  - The executor re-validates its grant against the durable store before spawning (`executor.ts:42-45`; `lease_store.ts:303-318`).
  - Completion records are immutable and scoped to the generation (321-337).
- **Engine identity.** The endpoint and engine ID are revalidated (`ownership.ts:48-56`). With ID targets, even a Docker context switch between verify and rm can't hit another engine's object.
- **Ratified costs I accept as within the decision.** The k3d named image cache needs owner removal before clean; Kubernetes workloads stay with a retained cluster; interrupted or crashed producers leave objects that cleanup refuses.

## Conditions only the owner can satisfy

1. **Resolve findings 1 and 2, or record explicit waivers.**
   - Finding 1 is not plausibly an intended contract. Accepting it means documenting that a stopped Compose or k3d generation can't be restarted without `down --clean` plus manual deletion.
   - Finding 2 needs either a fix or a ratified, documented limit, including operator guidance that doesn't point users to project-wide teardown.
   - A corrected change needs matching specialist review.
2. **Supply and accept native macOS qualification at the actual merging/release head.** Include the compose-replacement boundary, the distinguishing checks above, and the earlier APFS case modes, native account/PID/group/fsync, real local-bare hook push, supported engine and architecture requirements. Linux and guest evidence doesn't qualify native macOS or the final Intel/Apple Silicon artifacts.
3. **Authorize and perform the real host cutover separately, as procedure A.** Drain old clients first; owners recreate their own projects. Historical unattributed Mac volumes and every peer object stay preserved. This verdict grants no migration, deletion or cutover authority.
4. **Keep PR #58 a draft.** This verdict is not a ready-for-review, merge, tag, npm-publication, adoption or cutover grant.

## What I did not check

- With no shell, I could not:
  - run `git rev-parse`, `git diff fd710d9d..3d94c7f`, `git show a7359a4:…` or `git ls-tree`;
  - confirm that the record-only commits after `77e3d68` leave `src/` and `scripts/` unchanged;
  - recompute the bundle digest;
  - read `pr-ops.md` to confirm the push outcome.
- I ran no tests, typecheck, lint, build or rehearsal, and performed no Docker, Tilt or k3d action, signal or Git mutation. Findings 1–3 are source-demonstrated paths, not reproduced failures.
- I assumed Compose's deterministic `<project>-<service>-N` and `<project>_default` names, which match `all-final.log:344,353`, and that Tilt leaves Compose services running when it exits.
- I sampled the 2,100+ evidence files rather than reading them all.
- I did not reopen file authority, legacy cutover or port allocation beyond the callers touched here.
- I did not check the author's listed unverified neighbors: native Mac/APFS/accounts/fsync, final artifacts, real cutover and mixed clients, lost executor facts, transient tool containers before capture, delayed daemon effects, external Kubernetes, alternate or remote engines and drivers, and every daemon interruption boundary.
- No checkout file was changed.
~~~
