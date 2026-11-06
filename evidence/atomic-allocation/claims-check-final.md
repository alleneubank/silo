# Final claim-audit follow-up

Verdict: the substantive corrections are supported. One prospective hook-record statement must become true or be reworded before publication. This is a claim audit, not an implementation or specialist approval. macOS and cross-provider specialist gates remain pending.

Inspected on 2026-11-04 at approximately 03:18–03:21 UTC. No network operations or product/ref/process/credential mutations occurred; the only write was this requested report. This follow-up checks the corrections to claims-check.md, without repeating implementation analysis or the unchanged native scenario audit.

## Exact inputs

- Source HEAD remains `e4e77aa978cca4aa8210b0695123a7b8e7fa402d`.
- `dist/cli.js` independently remains SHA-256 `6e5e0848141659a58a316071623bc63eb05716cc8f16d68bb4bcdb8eb325b8d0`.
- Proposed `-tmp/pr-body.md` SHA-256 `9fa3854c8d6f0e587ad1bcc64a2f2e550b6b2ae9aed0813f57f2140e75fb01fd` at capture.
- `evidence/atomic-allocation/README.md` SHA-256 `b1752e806134af4194dfc4894d99fb73cb039205e088fb12d09fffc7a3fb1878` at capture.
- Repeated `example-status.json` SHA-256 `147e80a550201edd062b82296895bbaa21f290e01d92aa3a120e9fb63712309d`.
- `guest/verdict-guest.md` SHA-256 `c4147ad0bd9c9a47221a3c12d95f7bf1905e4f4f379e9009fea0195c36005c3d`.
- `git diff --name-only -- src scripts package.json .github .claude-plugin` was empty; observed local changes were documentation/evidence/resource records. SPEC's additional copy change clarifies that the rehearsal/specialist requirements are release gates. Troubleshooting's addition explains stopped versus reconciled state.

## Corrections checked

| Correction | Result |
| --- | --- |
| r3/r5/owner plan basis | Supported and corrected. Body explicitly distinguishes r3 conditional approval, r5 refusal revision and owner choice A; it disclaims standalone r5 approval. |
| Signal failure diagnosis | Corrected. Body states failure, removal and repeated pass as an observed sequence; index explicitly avoids claiming a sole causal input. |
| Gate outputs | Fresh typecheck.log contains the tsc command without errors; lint.log reports zero warnings/errors; skill-validator.log reports valid. These now provide retained gate evidence, together with previously inspected tests/check logs and unchanged artifact. Historical source hooks are expressly author-observed in the body and final index paragraph. |
| Bun HOME observation | bun-account-home.log records runtime 1.4.4 with both home APIs returning the scrubbed HOME. This agrees with the direct exact-binary experiment in the first audit. |
| Exact built example | Supported. example-built.log starts with e4e77aa and the exact artifact digest. Replaced example-status.json is generation 4; every recorded executor uses `/mnt/dist/cli.js`, all seven launch exits are zero, and exact Compose/k3d receipts are retained. Matching health log records both deployments available and two proxy health responses; clean log records successful snapshot retirement/claim release. This resolves the former source/built snapshot ambiguity. |
| Selected raw native CLI output | Supported. native-refusals.json contains 50 command/cwd/argv/exit/stdout/stderr records, matching the native rehearsal's selected legacy, bind conflict, cleanup, live-force, path/name conflict and engine-unavailable commands. Body correctly calls these selected refusals and describes the main log as command/exit records plus asserted outcomes. |
| Guest green | Supported within the guest's stated scope. The verdict opens green and records legacy owner stop/recreate, separate live roots/profiles, live-force refusals, a stopped profile switch, native k3d retention and explicit cleanup. Read the named captures for refusal/old down/new allocation, actual Tilt API listings, force refusals, switch, native Ready node, retained refusal/clean, empty listing/unallocated state and preserved peer checksum. |
| Guest immutable build | Supported by guest/61-build.sha256 matching the exact artifact. Guest explicitly did not independently inspect source HEAD, consistent with its charter. |
| Guest limits | Correctly retained: no browser UI/application HTTP serving, valuable-data recovery, Mac or every failure mode. Body claims actual Tilt API/k3d observations, not application endpoint serving by the guest. The author's application endpoint observations remain separate. |
| Guest hesitation/docs response | Supported. Guest describes stopped status followed by restart refusal requiring down; captures show refusal/reconciliation. The new troubleshooting paragraph explains this distinction. This is a documentation response, not evidence that the status UX itself changed or was re-driven after the copy change. |
| Prospective URLs/raw-log staging | Still prospective and correctly understood as publication prerequisites. No remote branch or PR query was made. Exact ignored log files and all linked guest captures must be included in the evidence commit before pushing; this report does not certify a future commit or hosted link. |

## Remaining wording/record fold

At inspection no hook/commit log existed in `evidence/atomic-allocation/`. The body nevertheless says “the later evidence-commit hook record are linked from the index”; the index says later hooks “have a separate retained output.” Those are future facts, not facts supported at this capture.

Before publication either retain that successful hook output, add a real index link and confirm it is in the proposal commit, or use prospective wording: “Historical source hooks were author-observed; the evidence commit's hook output will be retained before push.” The earlier index sentence “The commit hooks ran lint, format and typecheck successfully” should include “author-observed” directly rather than relying on a qualification several paragraphs later. Adding explicit clickable links for the new gate outputs would also make the body's “linked from the index” wording precise.

The remaining original-audit limits are unchanged: no independent global proof of absence of npm publication/remote release, no host-wide census proving only owned objects ever changed, and no implementation correctness verdict. Historical lane-action statements remain author attestations with bounded local supporting records. No waiver was added.
