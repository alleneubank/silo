# Response to specialist round 1

All four findings are **supported**. The reviewed proposal was
`5344574fd4f380c86f625a84bcd7ccb6d2918643` (executable source `d6590a5`).
The implementation correction is `6ffaa5bf18c0f33a828dad36d61e7d9cd60fa4c7`.
`4b0a9323f65fef62dfa82936d292110ef6714d40` changes only CI help copy after the
allocation guest. Current executable source
`80f4974d0f9e2db056ceb7ba771fe12597d5afad` additionally preserves supervisor
startup diagnostics and adds a native-test dependency preflight. Its allocation,
grant and retirement paths remain unchanged; later test/records-only changes
leave that executable unchanged.
This response requests re-review; it does not claim specialist approval.

| Finding | Disposition and observed evidence |
| --- | --- |
| 1. Reconfiguration drops a published kubeconfig role | **Supported; fixed.** Both reallocation and retirement now pass through the same generation-claim release boundary. It enumerates every previous file receipt, requiring either transfer of the exact path and completed receipt or prior owner cleanup. An omitted role cannot silently disappear. The built public CLI created a real k3d cluster, deleted its exact backend objects while retaining snapshots, then refused forced k3d-disable reconfiguration with the original kubeconfig bytes, path, generation and claims unchanged. `down --clean` used the recorded path despite the config edit; disabled allocation and final cleanup ended with no claims. The [native record](evidence/atomic-allocation/specialist-r1/linux-native.log) and [fresh guest](evidence/atomic-allocation/specialist-r1/guest/verdict-guest.md) include the transition. |
| 2. Parent fsync failure is forgotten on retry | **Supported; fixed.** Recovery synchronizes the parent before checkpointing even when the recorded rename/unlink is already visible. Pending receipts therefore survive directory-sync failure. One-failure native filesystem cases for publish and delete retain claims, refuse transfer, and observe a successful real parent fsync on retry before the receipt clears. Both distinguish the pre-fix source. [Before](evidence/atomic-allocation/specialist-r1/before-fixes.log), [after](evidence/atomic-allocation/specialist-r1/file-obligations.log). Native macOS directory synchronization remains unqualified. |
| 3. Short GITHUB_ENV append reports completion | **Supported; fixed.** Completion requires the returned byte count to equal the UTF-8 byte length. A short append fails with INCOMPLETE_EXPORT and retains its uncertain sink and generation claims. Short-write and interrupted-write cases preserve the exact partial/full bytes and reject both reallocation and retirement; a peer cannot append through the retained claim. The normal built-CLI CI append completed with no pending sink in the [fresh example](evidence/atomic-allocation/specialist-r1/example/example-r1-second-checks-mounts.jsonl). |
| 4. Applicable baseline reds are missing | **Supported; supplied.** The pinned public 0.9.0 CLI successfully ran CI in a second root against the first fixture's unchanged node, then the second root's down deleted that original cluster. The public 0.5.9 reader deleted a peer JSON reservation after its lock snapshot was temporarily removed. The same 0.9.0 peer-read control preserved the entry and its hash: this class does not apply to 0.9.0, whose peer reader is read-only. [Control commands/results](evidence/atomic-allocation/specialist-r1/baseline-controls.log) and [selected captures](evidence/atomic-allocation/specialist-r1/baseline-captures). These supplement the earlier duplicate-port, output-escape and failed-teardown controls; candidate-only assertions are not presented as baseline reds. |

## Obligation-class audit

The audit covered generation replacement, retirement, file publish/remove and
recovery, CI sink completion, and the callers in env/up/ci/down. The detailed
scope and observations are in the [evidence record](evidence/atomic-allocation/specialist-r1/README.md).

- **Additional supported defect: retirement discarded an append-uncertain sink.**
  The old retirement path deleted sink rows and every claim even though the
  corresponding append could not be undone or proved complete. Retirement and
  reallocation now use the same obligation boundary; neither can discard that
  sink. The interrupted-write test reaches this old retirement failure and
  fails on the pre-fix source, then passes with unchanged sink/claim inspection.
- **Additional supported defect: capitalization-only retargeting.** The old
  same-role check compared only the folded target key. A changed leaf spelling
  could keep that key while losing the original path. Transfers now require
  the exact recorded path as well. A native test distinguishes the old source;
  the fresh guest repeated and interrupted the public refusal, followed the
  documented clean-first path, and found no stale output or claims.
- The sole whole-generation claim deletion now lives behind that common
  boundary. Config receipts bind read-only input; they grant no file mutation.
  Snapshot receipts clear only after their recorded effects and parent sync.
  The remaining individual sink release is reached only after a complete
  append, file fsync and unchanged identity. Backend/executor absence proofs
  still precede generation release. No schema conversion, expiry reclamation,
  uncertainty acknowledgement or deletion grant was added.

## Qualification and remaining gates

130 Bun tests, typecheck, lint, knip, jscpd, build, commit hooks and an actual
local-bare push of 80f4974 passed. The author drove the full native Linux public-CLI
suite at the corrected allocation source; the later help-only change reuses
those unchanged observations. The fresh example at `4b0a932` passed CI, web/API
availability and identities, complete CI export, and public retirement. The
guest is green at the corrected allocation artifact, including repeats and
interruption; its stale CI-help observation was corrected and the built help
was driven afterward.

## Addendum 3: actual push and supervisor failure

The three handshake failures are reproduced on Linux by a real local-bare
push when PATH resolves the existing unconfigured mise Janitor shim. Temporary
diagnostics reveal `No version is set for shim: janitor`; the same PATH also
fails outside Git. With the actual Janitor 0.3.1 binary selected, unchanged
bf51f59 passes both real local transport and Git's SSH transport to a locally
executed receive-pack. No network connection is used. The original Mac
failure's cause remains **unresolved**: the Linux result does not attribute it.

The supported diagnostic defect is fixed at the launch boundary: an early
supervisor exit retains its stderr/status and the original cause, without
changing the durable grant or cleanup ordering. The new contract case fails
before that correction and passes after, with its tool sentinel absent and
claims retained. Native tests now fail before allocation if Janitor cannot
run from their fixture directory. Selecting the installed binary on PATH
corrects the reproduced tool environment without global configuration edits.

The author drove the built public CLI with actual mise/native Janitor and
Tilt: refusal preserves bytes/claims and runs no hook; restoring PATH allows
real CI and public cleanup. A fresh guest independently passes repeated text/
JSON refusals, native CI and final empty claims. Its ANSI-in-JSON observation
is retained as polish, not a new correctness or specialist approval claim.
See [records and limitations](evidence/atomic-allocation/prepush/README.md).

The first extra example hit a k3s bootstrap/API failure and its original Tilt
teardown also failed. Those failures remain captured; they are not called
pre-existing or flaky. Exact owned fixture teardown and a fresh generation
preceded the successful example. A captured anonymous Redis child survived
Compose teardown; it was individually verified unused and removed under the
synthetic-fixture grant. This is separate from automatic k3d child-volume
removal and does not authorize any historical anonymous-volume cleanup.

Keep PR #58 draft. A matching profile-free cross-provider specialist verdict,
native macOS/APFS and architecture qualification, explicit merge/release
approval, the final versioned artifact qualification, and the real owner-led
host cutover remain open. Historical unattributable anonymous volumes are
preserved as settled by addendum 1. No waiver, Git network call, merge, tag,
release, npm publication or real-project recreation occurred in this revision
lane. Only explicitly owned local-bare Git refs were pushed for verification.
