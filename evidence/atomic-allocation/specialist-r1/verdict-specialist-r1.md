changes required

Reviewed exact head `5344574fd4f380c86f625a84bcd7ccb6d2918643`; executable source is `d6590a5bb129cb90cb50bb1617bfe3ac966d907b`, and the later commits change records only. I compared `9882041aa7d1f798d6cdb44c5cab1cec8d0acd9a` to that head, read the changed allocation/lifecycle callers, and inspected the retained Linux evidence. The findings below are demonstrated code paths unless expressly described as evidence gaps; I did not execute them in this read-only review.

## Blocking

1. **Reconfiguration can disown a kubeconfig snapshot and release its file claim without deleting it.** `src/core/allocation.ts:29-40`, `src/core/lease_store.ts:436-465`, `src/core/lease_store.ts:673-687`.

   Start with a stopped, reconciled generation that has a published kubeconfig, after its owned cluster has been explicitly deleted. Reconfigure with `--force` to a supported profile/configuration with `k3d.enabled = false` (or no `k3d` block). `fileTargets` then omits the kubeconfig role. `commitAllocation` validates only roles present in the new target list, while its transaction deletes every claim from the old generation. The new generation consequently has neither a kubeconfig receipt nor its file-target claim.

   A subsequent `down --clean` examines only current-generation receipts, so it can remove env/lock, return success, and release the remaining claims while the old kubeconfig still exists. The owner no longer has a capability with which to clean that snapshot; another project that wants the path receives an unreceipted-file conflict. This is the same disown-before-cleanup outcome that the owned-file design and the existing same-role path-change refusal are intended to prevent.

   Preserve or safely retire every previous file role before dropping its claim, or refuse role removal until the recorded snapshot has been cleaned. Add a public k3d-enabled-to-disabled reconfiguration test that checks the actual old kubeconfig bytes/path and the final claims. Neither the current tests nor the native rehearsal exercises that transition.

2. **A failed parent-directory `fsync` is forgotten on the next file recovery, allowing a false completed export or cleanup.** `src/core/owned_file.ts:57-77`; claim release consumes this state at `src/core/lease_store.ts:673-687`.

   For a pending publish, suppose the rename succeeds but `synchronizeParent` throws. The receipt remains pending. On the next `recover`, the target already matches the pending inode/hash, so the branch containing both rename and parent synchronization is skipped and the receipt is checkpointed as published without retrying `fsync`. Pending deletion has the same defect: if unlink succeeds and parent synchronization fails, the next call sees an absent target and checkpoints the deletion without another synchronization attempt.

   Thus an `EIO`, `EINVAL`, or unsupported-directory-`fsync` result can be converted into success by retrying the command, even though the required directory durability was never established. Cleanup can then release claims on that unproven state. This also means Linux success cannot establish the macOS directory-`fsync` behavior named in the request.

   Keep the pending receipt until parent synchronization has succeeded, synchronizing before checkpoint even when the rename/unlink is already observable. Add one-failure fault tests for both publish and delete proving that a retry performs the parent sync rather than merely clearing the receipt. No retained test injects this failure.

## Should fix

3. **A short `GITHUB_ENV` append is treated as complete rather than uncertain.** `src/core/owned_file.ts:132-136`.

   `writeSync` returns the number of bytes written, but that result is ignored. If it writes fewer bytes than the encoded content without throwing, `completeSink` deletes the uncertainty receipt and claim and the CLI reports success with a truncated runner environment file. Check the byte count and finish only after the complete content is appended; otherwise retain the uncertain sink receipt. Add a short-write fault test alongside the existing sequential/concurrent append tests. This was not observed on the host; it is a demonstrated unhandled API result.

4. **The retained evidence does not satisfy the requested red-on-baseline matrix for every applicable failure class.** `evidence/atomic-allocation/baseline-red.log:1-14`, `evidence/atomic-allocation/README.md:63-69`, `scripts/allocation-rehearsal.ts:236-291`.

   The retained baseline controls demonstrate duplicate lock-only ports, escaping-output overwrite, and successful old cleanup after failed Tilt teardown. The same-name/leftover runs in the portable harness are candidate-only assertions. There is no retained baseline red observation for same-name cluster adoption/deletion or for peer-entry deletion where that class applies to the selected old client. New `ProjectOperation` unit tests cannot themselves go red on the baseline, which lacks those modules.

   Add the missing owned baseline controls for the acceptance items whose failure exists in that baseline/old client, and identify precisely any item for which no such baseline behavior exists. The current evidence index accurately limits its controls to three cases, but the implementation brief requested coverage of each applicable invariant; passing candidate assertions do not close that evidence requirement.

## Evidence assessment and notes

- The core construction otherwise has the intended main elements: a non-null `(domain, resource)` SQLite key and immediate transaction, prefix-overlap checks, operation/generation fencing, gated launch records and immutable completion facts, exact backend identities, owner-labelled scope refusal, receipt-bound files, and terminal-resource proof before retirement. Legacy refusal runs before store creation and does not issue deletion commands.
- The final Linux record at the stated executable source/artifact is substantial: it covers concurrent lock-only and live projects, three legacy locations and all five refusing commands, the operational paused-writer drain, unsupported old-client limits, a real squatter, pre-grant and post-rename crashes, real k3d create/retain/exact-delete, synthetic stopped foreign containers, failed Tilt teardown and retry, and anonymous-volume deletion. It ends with a passing all-suite result and zero-exit fixture cleanup (`evidence/atomic-allocation/linux-native-final.log:173-188`). Those runs do not reach the two blocking cases above.
- Linux does not establish native account lookup through `dscacheutil`, Darwin PID/group behavior, APFS case/Unicode aliases, directory-`fsync` behavior, or Intel/Apple Silicon distributed-artifact behavior. The Mac run remains pending (`macos-rehearsal.md:1-4`), and both case-insensitive and case-sensitive native filesystem runs are required (`macos-rehearsal.md:108-116`).
- I did not independently verify a live third-party Docker request that completes after its executor fact is lost, real data-bearing foreign k3d topology, actual endpoint drift/remote-engine refusal, Docker IPv6 publication races, or Tilt's independently selected internal API-listener failure. The source retains claims on missing completions and failed namespace queries, but those unexecuted neighbors are not passes.

## Conditions only the owner can satisfy

1. **Supply and accept native macOS qualification at the corrected merging/release head.** This must cover both native APFS case modes, the relevant Intel/Apple Silicon distributed artifacts, native account/process behavior, and directory synchronization. Linux evidence and this review cannot waive that release hold.
2. **Authorize and perform the real host cutover as procedure A.** The owner and affected project owners must announce it, upgrade or retire every permitted old invocation, stop all old silo use and drain every old operation before the clean scan/first new allocation, and recreate their own ephemeral projects. No actual ae-dev cutover or pin retirement was reviewed here, and no peer cleanup is authorized by this verdict.
3. **Resolve the historical anonymous-volume disposition.** `report.md:1-10` asks whether to preserve unattributable old fixture volumes or require authoritative provenance for any further action. Preserve them unless the owner supplies an exact authorized alternative; this review grants no deletion authority.
4. **Keep the PR draft pending corrected code/evidence and explicit merge/release approvals.** Requalify the final versioned artifact after the 1.0.0 version sync. This verdict is not merge, ready-transition, tag, npm publication, or S1 adoption approval.

## Review limits

This was a read-only source, diff, and retained-evidence review. I ran no Bun tests, built no artifact, sent no process signals, performed no Docker/k3d/Tilt operation, and did not inspect or mutate live host/project state. I did not run a macOS rehearsal or independently reproduce the author's Linux observations. I did not assess BOSS scripts, non-silo process behavior, or safety between old clients. No repository file was changed; only this requested verdict was written.
