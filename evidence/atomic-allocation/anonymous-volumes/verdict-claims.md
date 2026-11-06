# Addendum 5 claim verification

Claims supported, with wording corrections recorded below. This is a fresh
disinterested claim check under `sitrep`'s verification floor, not the
coordinator-owned implementation specialist review or merge approval.

Scope: `report.md`, `pr-body.md`, `review-response-addendum5.md`, the current
top section of `specialist-request.md`, and this directory's `README.md`.
The reviewer inspected retained captures and read-only local refs and queried
PR #58 through HTTPS. No author sessions or implementation reasoning were
supplied; no implementation review, build, test run, Git network operation,
resource mutation or credential change was performed. The only authored
artifact is this verdict. Checks occurred on 2026-11-04, after the retained
23:18:56Z audit and before final records-only closeout.

## Per-claim verdicts

| Material claim | Verdict and direct evidence |
| --- | --- |
| Current executable source and artifact | Supported. Local branch HEAD is `a21f710896528aeaed5a6c142abc13a80895f1ba`; `rehearsal-head.txt`, the guest's `source-head.log`, and actual source-push received ref agree. An independent read-only SHA-256 of the existing `dist/cli.js` equals `40fd990ead9815f2f679b43e16eb65fc111fe0a798e08988e9a85667206e43a6`, matching `artifact-sha256.txt`, the all-suite environment event and guest `build-sha256.log`. |
| PR remains open/draft and new runtime is unpushed | Supported as observed. Live `gh pr view 58 --repo alleneubank/silo --json number,state,isDraft,headRefOid,baseRefOid,mergedAt,reviews,statusCheckRollup` returned OPEN, draft true, no merge, head `5d2c870ed38757a73e3e005c9673a6b0bd39b56a`, base `9882041aa7d1f798d6cdb44c5cab1cec8d0acd9a`, reviews empty. Existing successful hosted checks belong to that older head; they do not qualify a21f710. |
| Actual baseline leak at 5d2c870 | Supported. `baseline-summary.json`, four entries in `baseline-all-mounts.json`, `baseline-clean.json`, and `baseline-leaked-volume.json` show successful public clean, generation 0/empty claims, and Redis's exact anonymous `/data` child surviving. `baseline-exact-cleanup.json` separately records its later exact-identity, all-current-container-user-checked removal. |
| Seven baseline mounts; six k3d mounts absent and Redis remains | Supported. `baseline-summary.json` identifies seven distinct names: one named images volume, four image-declared k3s children, one registry child and Redis. Its per-name post-clean results show only Redis remaining. The named images volume itself is not claimed to be anonymous. |
| Earlier six-volume audit did include anonymous children but excluded Redis | Supported within historical scope. `../crash-completion/audit.json` has six distinct mount-volume names (the images name appears more than once in object checks), with five hash-shaped child names. Its retained resource ledger attributes the children to the backend fixture; this is a backend mount audit, not complete copied-example Redis coverage. The native baseline independently captures the four k3s image declarations and registry declaration. |
| Regression fails first on the leaked volume | Supported. `regression-red.log` records real Redis CI and successful public clean, followed by the explicit leaked `/data` assertion failure. Its old CLI digest is `9965e0b2...`, consistent with the unchanged old runtime at 5d2c870. |
| Final focused risk scenarios pass | Supported as observed, not a proof of every possible path. `identity-and-retry.log` ends with volumes suite pass and records exact cleanup/repeat, parent-gone retention and force refusal, in-use refusal/retry, explicit named/borrowed-data preservation, and different-creation-time replacement refusal/recovery. `all-suite.log` repeats these on the final artifact. |
| Immutable child receipts and retained parent history | Supported by observed status receipts in the focused/all-suite and guest captures: exact child name, creation time and destination remain available after original parent deletion. Clean/reallocation refusals and exact retries are observed. Universal caller coverage, immutable construction, inherited-provenance refusal, and all deletion-path claims remain the implementation specialist's obligation; this claim check does not confer that approval. |
| Required gates: 130 tests / 335 assertions, lint, typecheck, knip, jscpd, build | Supported. `gates.log` records 130 pass / 0 fail / 335 expect calls, typecheck, zero lint warnings/errors, knip continuing successfully, zero clones, and successful build. `commit-code.log` shows normal lint/typecheck hooks and the source commit. These are retained author runs, not reviewer reruns. |
| Complete all-suite passes across 234 invocations | Supported with corrected wording. `rehearsal/events.jsonl` contains exactly 234 command records, including 67 nonzero refusal/control outcomes; `all-suite.log` reports suite all pass. All 17 final cleanup invocations, commands 218–234, exit zero. The count includes Docker commands and genuine old-client controls as well as candidate public CLI invocations. |
| Same-artifact full copied example and complete mounted-volume cleanup | Supported. `example-fixed/commands.jsonl` records successful CI, web/API availability and both health calls; saved health JSON says status ok. Retained-k3d clean is an expected exit 1; explicit deletion succeeds. `parent-mounts.json` and `removed-mounts.json` name four parents and seven distinct mounted volumes and record all absent; final status is generation 0/empty claims. `example-fixed.log` reports pass. |
| Fresh guest is green, including data and peer preservation | Supported. `guest/verdict-guest.md` explicitly excludes source/diff inspection and identifies the exact head/digest. Underlying failure status captures each preserve generation 1 and 15 claims; before/after env and lock hashes match. `main-reopen-data.log` reads back both explicit Redis markers and shows the fresh implicit Redis volume lacks its old marker. Retry and both final unallocated status captures support successful cleanup. |
| Closing audit counts and absence | Supported as a retained point-in-time audit, not a fresh reviewer survey of every running system. Recounting `audit.json` yields 24 + 2 projects, all generation 0/tokens null, zero claims/active resource rows in both stores, 621 numeric PID/same-number-group checks, 122 object entries and 59 volume entries. Both absence result flags are true. Never-created guest candidates remain absence checks, not creations. |
| Disposable filesystem account view rather than real store | Supported by `sandbox.sh.txt`: bwrap binds task-owned account storage over `/home/ae` and task scratch over `/tmp`. The audit's `/home/ae/.silo/leases.sqlite` is a path inside that view, not evidence the real account store was used. The guest records its separate isolated account view. |
| Failed first retry ordering and recovery disclosed | Supported. `retention-and-peer.log` records unresolved-request failure after the in-use scenario; `retry-ordering-recovery.json` and `retention-and-peer-fixed.log` retain recovery and corrected pass. The final focused/all-suite captures supersede the earlier simple green run. No pre-existing/flaky classification is used. |
| Guest APP_HOST setup mistake | Supported by the guest's independent verdict and bundled-doc captures. It is correctly scoped as fixture setup, not a product failure. The initial unused-export knip failure is an author-reported development observation; the final successful knip/gates result is directly retained. |
| Specialist and Mac status | Supported with historical scoping. `../crash-completion/verdict-specialist-r2.md` approves with conditions only at fd710d9 and states its exact older executable source. The supplied Mac `~/.handoffs/boss-mobile-release/silo-macos/report-4.md` qualifies 5d2c870's driven scenarios and explicitly cannot attribute two anonymous volumes. Neither record qualifies a21f710; round 3 and new native Mac remain pending. |
| Publish, version and release statements | Supported in the observed scope. Package and `.claude-plugin/silo/plugin.json` remain 0.9.0; `.changeset/atomic-project-allocation.md` requests major. `.github/workflows/release.yml` tracks main, creates a Changesets Release PR, and has OIDC permissions plus a publish command. A feature-branch push remains a proposal. No merge/publication authority is implied. Negative claims about actions during the author's lane are bounded author reports, consistent with current refs/PR; this reviewer cannot prove absence of every external action from repository evidence. |
| Actual local-bare source push | Supported. `local-bare-source.log` records the real push, successful knip/jscpd/test pre-push hooks, 130 tests/335 assertions and received branch update. `local-bare-source-ref.txt` is exactly a21f710. It is not a final records-only head receipt and not a GitHub push. |
| Final head, final records-only push and task scratch removal | Future closeout only. During this check HEAD is still a21f710 with uncommitted records, and task `dist` and addendum5 scratch exist. No final-head push or scratch-removal completion is attested here. Corrected documents frame those receipts and exact final coordinator operations as future closeout. |
| Threat model, plan basis and remaining gaps | Consistent with the supplied addendum-5 directive and historical specialist charter. The top specialist request names the new receipt-clean goal, confines authority to trusted local/cooperating tools, and lists unqualified neighbors. It requests review rather than claiming it. No new waiver is represented. Absence of DDL/version migration, timeout changes or weakened assertions is not independently code-reviewed here; source-correctness assurance remains outside this claim check. |

## Wording corrections

1. Resolved after reread: the report and README formerly said final-head push
   and scratch-removal receipts were already retained; they now say these
   will be retained at closeout. The PR now names the already-completed
   a21f710 source push instead of an unperformed final-head push.
2. Resolved after reread: the report no longer says final addendum-5 operations
   already exist in the handoff's still-historical addendum-4 `pr-ops.md`.
3. Resolved after reread: the 234-command success claims now identify expected
   refusals and all 17 zero-exit final cleanup commands. The addendum-only
   response now describes the guest and closing audit as complete.
4. Resolved after final reread: the README now calls the 234 entries recorded
   command invocations; older PR rows are explicitly labelled historical and
   the 177-command suite now identifies expected refusals. These corrections
   do not change the supported outcomes.

Evidence-hygiene follow-up: the author disclosed that an original full-example
node inspect capture included an ephemeral bootstrap token, after the exact
fixture cluster had already been destroyed by public cleanup. The retained
four inspect payloads (`example-fixed/6.stdout` through `9.stdout`) were
projected to identity, Config image/labels/volume declarations, relevant mount
sources and Mounts; direct key inspection confirms none has Config.Env. The
README now discloses this projection and the retained driver applies it.
Parent/mount counts and exact cleanup evidence remain available. This check
does not attest token handling before the projection or universal secret
absence in every historical artifact.

Official Docker documentation also supports the explanatory statement:
[Compose down](https://docs.docker.com/reference/cli/docker/compose/down/)
leaves anonymous volumes by default and exposes explicit volume removal;
[container rm](https://docs.docker.com/reference/cli/docker/container/rm/)
documents anonymous-child removal with `--volumes`. These docs explain the
observed class; they do not establish ownership of the historical Mac volumes.

This verdict does not rerun runtime tests, inspect implementation, qualify
macOS, approve merge/release, or claim final records-only closeout complete.
