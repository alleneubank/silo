# d659 claim-delta audit

Verdict: the material new qualification and bounded cleanup claims are supported by the inspected records. Two minor wording folds below improve precision. This is a claim audit, not implementation approval or a substitute for the matching specialist. Mac, specialist and real host cutover remain pending.

Audited 2026-11-04 at approximately 03:48–03:52 UTC. No network calls, source changes, external writes, process signalling or credential changes occurred. Only this requested report was written. No full labels or kubeconfig contents were requested; inspection of the corrected node capture used its allowlisted identity/mount fields.

## Exact inputs

- HEAD `d6590a5bb129cb90cb50bb1617bfe3ac966d907b`.
- Independently hashed `dist/cli.js`: `1a09c9812329a16342f95b7c006ddd5d844f611c6dbb3b5febca6a0e21396abc`.
- `-tmp/pr-final-body.md`: SHA-256 `e5d5f91e99ee31d4fb53a5b5cf322f2c1353e58a23c847e7756680f20ee2712b`.
- `evidence/atomic-allocation/README.md`: SHA-256 `465a564531712131ab18e02cace3bc5d5b45cc30e5c0cac75dd81bcb77c8a713`.
- New inspected inputs: linux-native-final.log, volume-backend.log, volumes-tests/lint/check logs, github-checks-d659.json, guest-r2 verdict and named captures, proven-volume-cleanup-manifest.json, orphan-parent-captures.json and proven-volumes-cleanup.log. Read the bounded relevant source delta/harness and the two preserved hosted failure records. Original claims were not re-audited beyond their changed wording/context.

## New claims

| Claim | Result and evidence |
| --- | --- |
| Current source/artifact d659/1a09 | Supported by local HEAD and independent artifact hash. Current executable is clearly distinguished from original e4e77aa/6e5e qualification in the appended section. |
| Exact container removal now asks Docker to remove anonymous children | Supported as a source-description claim: k3d.ts exact-receipt removal includes `--volumes`; fixture removals do too. This audit makes no broader cleanup-safety judgment. |
| Full final native suite passed at current artifact | Supported: linux-native-final.log starts with exact d659 and its environment records exact artifact SHA; suite all ends pass, followed by zero-exit cleanup commands for every recorded project and final evidence record. Volume handles are recorded before deletion and each exact handle has a failed subsequent inspect. |
| Separate volume backend qualification | Supported: volume-backend.log records attached named/anonymous handles, successful owned deletion, subsequent exact inspect failures, backend suite pass and successful final cleanup. |
| Lint/check/123 tests green | Supported by volumes-lint.log (zero warnings/errors), volumes-check.log (knip/jscpd, zero clones) and volumes-tests.log (123 pass/0 fail). These remain bounded local gates, not specialist approval. |
| Hosted CI and example passed at d659 | Supported by retained github-checks-d659.json: exact headRefOid, isDraft true, both completed SUCCESS with the two named run URLs and timestamps. This audit inspected the fetched record rather than making an independent live GitHub request. Terminal job outcomes are accurately quoted. |
| Two previous hosted failures and fixture-only corrections | Supported by preserved first failure naming missing GITHUB_ENV for old 0.5.9 and second failure's Docker inspect comparison; harness removes GITHUB_ACTIONS and now retains parsed fields with passthrough, sorts only Mounts by Destination, and deep-compares. Existing preservation assertions remain; attached-volume assertions were added. The published artifact's changed deletion behavior is explicitly separated from the earlier CI-marker harness correction. |
| Refreshed deletion guest green at exact artifact | Supported: guest-r2/verdict-guest.md opens green; captures/build.txt matches 1a09. Guest's scope is bounded deletion behavior, not all lifecycle scenarios or security review. Original guest is correctly retained for unchanged flows. |
| Four node anonymous volumes disappeared | Supported by safe node-mounts-before capture (server's four anonymous mounts; load-balancer's named images mount), volumes-after.txt exact no-such-volume responses, explicit-clean exit 0 and unallocated/empty ownership state. |
| Unrelated named control metadata/sentinel unchanged | Supported by control-comparison.txt and independent byte comparisons: both metadata JSON files identical, both sentinel files identical. Guest later removes only its control fixture, as clearly stated. |
| Twenty-five exact old anonymous children attributed and removed | Supported within captured provenance: manifest has 25 unique names; all 25 parent IDs/creation times and mount names match one of ten parent captures; cleanup log contains exactly the same 25 removed names and final removed=25/pass. These are exact captured children, not a census of all historical volumes. Successful non-forced removal and the author's retained verification support the bounded unused-fixture claim. No current host resource mutation or census was performed by this audit. |
| Older mount IDs missing/events gone; unknown volumes untouched | The provenance gap is correctly explicit and consistent with the bounded manifest. Event-window exhaustion and never-retained IDs are historical author attestations, not independently established by current Docker queries in this audit. No claim that all historical children are absent is made; the body expressly disclaims it. |
| Private guest token exposure corrected; retained capture allowlisted; cluster destroyed | Guest explicitly reports the inspection mistake; retained node-mounts-before.txt contains IDs/names/mounts plus only Silo project/generation fields. Exact node/volume/network absence captures and successful owned cleanup support destruction of that fixture. Replacing a capture does not erase earlier tool traffic; body correctly describes this as a private capture correction, not a claim that no exposure occurred. |
| Product status receipts filter labels | Supported as existing source behavior/observed status shape; it is separate from the guest's direct Docker inspection error. No broad secret-absence guarantee follows. |
| Draft and release holds unchanged | Retained GitHub snapshot says draft; new body explicitly preserves Mac/specialist/cutover holds and requests no waiver/release/merge. No implementation verdict is implied by hosted tests or guest green. |

## Wording folds

1. README's earlier correction paragraph says the deletion path “requires refreshed guest coverage” while its following current-state paragraph correctly records green guest-r2. Make the former historical: “required refreshed guest coverage; the completed run is recorded below.” The earlier failed full rerun is already correctly described as a failure, followed by a distinct passing final run; preserve that distinction.
2. “No credential value is included in this PR evidence” / “No credential value is retained in this repository's evidence” are broader than this bounded audit can establish. Prefer the precise supported statement: “The retained node-inspection capture contains only allowlisted identity/mount fields and Silo project/generation labels; the exact fixture cluster was destroyed.” No full evidence-wide secret scan was performed, and none should print possible matches into tool traffic.

Files/URLs introduced by the pending evidence update remain prospective until its exact commit/push. Before publishing the appended body, include every referenced new record and guest capture in that proposal commit. The historical host-cleanup gap must remain visible in the PR and coordinator report; neither the green guest nor label/name audits close it. No waiver was added by this audit.
