# Addendum 4 independent claim check

**Verdict: supported for the stated local qualification, with closeout still pending.**
The premature final-head, hook and scratch-removal claims found in the first
draft were corrected before this verdict. This is a fresh claim audit, not
a product specialist review or a merge/release grant.

The reviewed source head is `cf0b2b21117a4ddf1dd60f77313dd1803401e4bb`.
Scope: `report.md`, `pr-body.md`, addendum 4 of `review-response.md`, this
directory's `README.md`, and `macos-rehearsal.md`. The audit inspected their
current working copies, source/diffs, retained logs/status/probe sources and
the expressly cited coordinator-supplied Mac report/evidence. It did not read
the author's session or treat an earlier review as a fresh audit.

## Material claims

| Claim | Verdict and evidence |
| --- | --- |
| Listener drain does not establish durable executor completion; status does not reconcile it. | Supported. `src/core/executor.ts:49-52` awaits the tool before publishing; `src/core/lease_store.ts:273-299` reads a snapshot; `:321-337` publishes the immutable fact; `:339-349` separately applies it. `SPEC.md:42-65` agrees. The controlled statuses below demonstrate both relevant intermediate states. |
| The Mac assertion observed no completion, but the same launch later had an exit-0 fact. | Supported. `mac/78-status.json` has generation 4, phase running, granted launch `00009f98-3ef9-4f8a-8241-6565c7276b00`, and no completions. `mac/late-completion.json` contains that launch/project/generation/group's exit-0 fact at `2026-11-04T22:02:21.368Z`. Both and the selected state summary compare byte-for-byte with their supplied Mac originals. This disproves loss for that observed launch; it does not prove immunity to lost facts generally. |
| This was a probe synchronization defect, repaired without changing the product runtime. | Supported within that observed failure. `git diff fd710d9 cf0b2b2` changes only the rehearsal and Mac runbook. Runtime files and packaged product inputs are unchanged since `80f4974`; the only subsequent `src` change is a test. Independently hashing the available `dist/cli.js` yields `9965e0b2fde3397eadc7c507ae2e7afafd7f0a4b3accfdc84411fba803185894`. No rebuild was performed by this auditor. |
| The corrected probe retains old assertions and waits for the exact fact, with provenance/peer checks. | Supported by `scripts/allocation-rehearsal.ts:129-160` and its diff. The original claim and nonempty-completion assertions remain; the added wait checks project/generation/claims, then leader/group/started and B's logical state/HTTP identity. `until` retains its 30,000 ms default. The new completion wait has its own invocation of that deadline; this is not a claim that the whole crash scenario has one shared 30-second budget. |
| Original Linux live run passed without naturally reproducing the Mac schedule. | Supported by `live-before.log`: live-suite pass followed by successful cleanup. It is correctly presented as a Linux pass, not a failing timing control. |
| A controlled hold demonstrated absent completion after tool exit, followed by publication, cleanup and unchanged B. | Supported by `probes/hold-completion.ts.txt`, `probes/timing-probe.ts.txt` and `timing-probe2.log`. The preload holds the real INSERT after the executor has reached publication, then releases it. This is scheduling instrumentation; the documents correctly exclude native delayed-write/fault-recovery qualification. |
| Corrected live suite waited across two missing-fact reads, then passed. | Supported. `controlled-live.log` names commands 26 and 27. Their retained statuses have unchanged generation/claims and no fact; command 28 contains the exact completion while phase/launch still read running/granted. `controlled-live-suite.log` records the completion scenario, live-suite pass and successful final cleanup. |
| Full native Linux all-suite passed at cf0b2b2, including final fixture cleanup. | Supported by `rehearsal-head.txt`, `allocation-final.log`, resource record and inspected harness. The log has exactly 177 command records and one all-suite pass; cleanup commands 164-177 all exit zero. Its recorded scenarios support the stated legacy/cutover, concurrent roots, squatter, crash, alias, teardown, k3d, volume, role-removal and engine-refusal observations. These remain author-run observations, not independent reruns. |
| Required checks, normal commit hooks and an actual local-bare push passed. | Supported by `gates-final.log`, `gates-head.txt`, `commit-fix.log`, `push-fix.log`, and `local-bare-ref.txt`. Gates record typecheck/lint/knip/jscpd/build, zero clones, 130 tests, zero failures and 335 assertions. The push records the normal three pre-push commands and successful ref creation; a read-only check of the owned bare repository resolves `refs/heads/verified` to exact cf0b2b2. No final records-only-head hook result is claimed in the corrected report. |
| Scoped teardown audit found 28 retired projects, zero claims/resources and absent recorded handles. | Supported as the retained audit result at `2026-11-04T22:21:39.214Z`, not a newly repeated live audit. `audit.json` has 28 rows, all generation 0/operation null, zero claims/live resources, 408 distinct PID numbers checked for both PID and same-number group absence, 16 object checks and six captured mount names. `probes/audit.ts.txt` validates complete Docker namespaces against known-present controls and issues only signal 0 for process checks. Sixteen checks need not mean sixteen distinct objects. |
| Disposable filesystem view preserves native discovery and excludes the real account store. | Supported for the recorded invocations by `probes/sandbox.sh.txt`: the owned account tree covers `/home/ae`, scratch covers `/tmp`, and checkout is `/mnt`; no alternate product account-discovery implementation is injected. Real tool versions/engine are recorded in `environment.txt`. Current read-only OS/filesystem checks confirm Linux x86_64/ext4. This does not qualify a separate OS account or macOS. |
| Legacy artifact digests matched; first standalone timing attempt failed before allocation and cleanup was a no-op. | Supported. Independently hashing the two available scratch tarballs matches `legacy-digests.txt` and the runbook. `timing-probe.log` preserves INVALID_CONFIG for missing APP_HOST and both changed:false/null-project cleanup results. |
| Mac native PATH/preflight, 130 tests and actual hook push passed before the later assertion failure. | Supported by newly retained `mac/02-tests.log`, `06-hook-probe.log`, `09-hook-push.log`, paths and driver excerpt. The three logs compare byte-for-byte with the supplied originals. The test/push logs record their stated results. The inherited Bun-function observation is explicitly sourced to the supplied Mac report; this auditor did not independently reproduce that shell condition or attribute the historical shim failure. |
| Round-2 specialist was approve with conditions, with no blocking/should-fix findings; runtime remains unchanged. | Supported by the retained exact-head verdict and runtime diff. Its Mac, cutover and final artifact/decision conditions remain unfulfilled. This claim check grants no specialist-round waiver and claims no new guest, CI, merge or release approval. |
| Existing baseline/guest/example observations may be reused only for unchanged inputs. | Supported with their stated provenance limits. Inspected baseline controls distinguish 0.9.0 peer preservation from 0.5.9 deletion and record same-node adoption/deletion. Prior guest records name their source/artifact. Obligation red/green logs retain six failures followed by passes. Example health and child cleanup records support their narrow observations; `build-identity.json` expressly lacks a per-run hash/command prologue. The proposal discloses that limit and preserves the first example's failure. This audit does not renew the product specialist's conclusions. |
| PR remains draft; semver/version/release holds are unchanged. | Supported. Fresh `gh pr view 58 --repo alleneubank/silo --json headRefOid,isDraft,state,url` returned OPEN, isDraft:true, head fd710d9. Package/plugin are 0.9.0; the changeset is major. `.github/workflows/release.yml` tracks main and invokes Changesets publishing with OIDC permission. Nothing in the local rehearsal qualifies final 1.0.0 artifacts, actual cutover or release authorization. |

## Corrections checked and closeout boundary

The first draft's `report.md:5-6`, `:45-46` and final sentence claimed final
proposal/head-hook/cleanup receipts already existed; `README.md` said dist and
scratch were removed. Those claims were premature: HEAD is cf0b2b2, the final
records are uncommitted, PR still has fd710d9, and both task dist and scratch
exist. The revised report makes final SHA/operations and cleanup receipt
closeout requirements and removes the final-head hook claim. The revised
README calls dist/scratch teardown targets. Those corrections are sufficient;
do not convert them back to completed claims until their receipts exist.

Dependencies and generated hooks have 05:50Z timestamps; inspected sibling
scratch entries also predate this run. Preserving them is consistent with the
reported cleanup scope. The completed fixture teardown/audit is distinct from
the pending deletion of task scratch/build output. No final proposal push,
PR-body update, records commit or scratch removal was performed or verified by
this audit.

## Limits

No tests, build, public CLI flow, Docker/k3d/Tilt operation, process signal or
cleanup was run by this auditor. No credentials or live real-account store
were accessed, and no Git state or external message was changed. The only
network query was the specified read-only PR view. The only written file is
this verdict. No waiver was added.

Native corrected macOS/APFS/architecture qualification, final versioned
artifacts, hosted CI, actual host cutover, lost completion behavior and the
other explicitly excluded crash/engine/data scenarios remain unchecked.
Retained audit results are evidence of their recorded time, not a guarantee
about later resource state. Later changes to product/rehearsal inputs or
material claim text need a corresponding fresh check; records-only commit
identity changes do not invalidate the evidence inspected here.
