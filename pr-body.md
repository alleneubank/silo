## What

Reserve each project's ports, final resource names and physical file targets
in one durable account-scoped SQLite transaction. Bind exports, gated tool
groups, backend receipts and cleanup to the project generation. Refuse old
JSON/root-lock state read-only; owner stop/recreate replaces migration.

## Why

The 0.9.0 allocator can commit duplicate lock-only ports, overwrite an escaping
output, reuse/delete another root's same-name cluster, and report successful
clean after failed Tilt teardown. Retained native controls demonstrate these
failures. Shared-host resource ownership and the breaking CLI/file contract
make this high risk.

## How

- One claim constructor, project operation fencing and receipt-bound file
  capabilities; no peer GC or expiry reclamation.
- Gated Janitor process groups and immutable executor completion facts;
  uncertain external requests keep claims.
- Exact engine/resource identities and physical file targets; leftovers refuse
  instead of adoption/deletion. Terminal proof precedes generation release.
- One generation-release boundary requires every old file obligation to be
  transferred or discharged. Removed roles and changed path spellings require
  clean first; failed directory sync remains pending; short/interrupted CI
  append remains uncertain through reallocation and retirement.
- Version-2 consumer snapshots, stopped-only force, native account lookup,
  matching packaged docs/skill and Bun 1.4.4 / Janitor 0.3.1 prerequisites.

## Rollout

**Draft; do not merge, mark ready or release.** Intended semver: **1.0.0** via
the included major changeset; package/plugin remain 0.9.0. Feature-branch
pushes/PRs are proposals. Main tracks the Changesets workflow: after explicit
approval, review its Release PR and version sync; merging that Release PR
publishes npm through OIDC. No version/tag/release/publication occurred here.

Before a host's first new allocation: announce cutover, upgrade or retire
every permitted old invocation, and drain every old operation, including
commands paused before registration. Each owner stops and recreates its
ephemeral projects. No data, ports, clusters or volumes carry over. This PR
authorizes no real-project cutover or peer stop/cleanup; S1 adoption stays held.

## Risk

A defect could affect peer local resources or reservations. Config/hooks/tools
are trusted and must consume generated names/ports. Old clients after cutover
can take new lock-only numbers; the fixture observed that unsupported limit
without changing SQLite claims. Visible legacy state blocks new commands but
cannot undo an old invocation. Non-silo binders can still win a socket race;
startup must fail safely without killing them or renumbering exported ports.

## Verify after deploy

Only after the owner-led cutover, inspect each generation with `status --json`,
drive its Tilt/service endpoints and use explicit owned teardown. Qualify the
final versioned artifact on supported native Linux and macOS environments
using `macos-rehearsal.md`. Never delete peer ownership metadata to clear a scan.

## Rollback

Prefer a forward fix. Old binaries cannot manage the SQLite domain. Before an
authorized downgrade, owners must stop/reconcile every new generation and
coordinate all permitted invocations. Never mix old/new allocators or replace
the store with empty state. This proposal authorizes no downgrade or deletion.

## Evidence

Current executable source: `a21f710896528aeaed5a6c142abc13a80895f1ba`, CLI
SHA-256 `40fd990ead9815f2f679b43e16eb65fc111fe0a798e08988e9a85667206e43a6`.
Container receipts now retain exact anonymous mount identities after parent
deletion. Clean removes recorded Compose anonymous children; explicit cluster
deletion removes its recorded children through the same exact receipt path,
without Docker's implicit --volumes removal or pruning. Retirement and forced
replacement require every recorded child absent. Named or explicitly supplied
mounts confer no child deletion authority; in-use/replaced children keep claims.
The earlier crash-completion probe correction and supervisor diagnostics remain.

Author environment: ae-dev Linux x86_64/ext4, Bun 1.4.4 / SQLite 3.53.4,
Docker 29.9.2, k3d 5.9.0, Janitor 0.3.1, Tilt 0.37.8 fork. The built public CLI
used native account discovery in disposable filesystem account views; shared
Docker mutations were limited to new exact fixture handles.

| Scenario / check | Observed |
| --- | --- |
| Anonymous service volume defect / baseline | The copied full example at 5d2c870 records all four parents' Mounts, then public clean exits zero and releases claims with Redis's anonymous /data volume still present. The new native regression fails on that leaked volume before the fix. Six k3d mounted volumes disappear; they were the scope of the earlier six-volume audit, which did not cover Redis. |
| Anonymous child cleanup / author run | At a21f710 the full Linux suite passes across 234 recorded commands, including expected refusals; all 17 final fixture cleanups exit zero. The full copied example passes web/API health and removes all seven distinct mounted volumes, including Redis's /data. Exact parent/child handles are retained. |
| Anonymous risk scenarios | Plain down retains data and historical parent receipts; reallocation refuses unchanged claims. A fixture borrower makes clean fail without deleting or signalling it; exact owner removal allows successful retry after the original parent is gone. Explicitly borrowed anonymous and named sentinel snapshots survive. A replacement child identity refuses with unchanged claims and replacement. Repeated clean is a no-op. |
| Fresh cleanup guest | Green at a21f710 / 40fd990e: real Compose/Redis retention, clean/repeat, second root preservation, two in-use failures with unchanged claims/receipts/snapshot hashes, successful retry, and explicit-volume data readback after reopening. |
| Cleanup closing audit | 26 retired projects across two disposable stores, zero claims/active resource rows; 621 recorded PID/group handles and 122 recorded object handles absent, including 59 volume names. Never-created guest candidates count only as absence checks. |
| Current required gates | 130 tests / 335 assertions, typecheck, lint, knip, jscpd (zero clones), build and normal commit hooks pass at a21f710. Actual local-bare push of a21f710 passes all pre-push hooks; the received ref is retained in the anonymous-volume record. |
| Historical qualification at earlier sources | The following retained rows qualify their explicitly named earlier inputs; they do not replace the current-head cleanup observations above. |
| Crash-completion synchronization | Native Mac fd710d9 status had no completion immediately after listener drain; its retained store later contained the same fact. A controlled Linux scheduling hold independently demonstrated that allowed ordering with real Tilt/Janitor. The corrected live probe waited through two missing-fact status reads and then passed after publication. Status remains read-only; owner reconciliation is separate. |
| Fresh full Linux qualification at cf0b2b2 | Full gates pass: 130 tests / 335 assertions, typecheck, lint, knip, jscpd and build. The uninstrumented suite passes across 177 recorded commands, including expected refusals, and final fixture cleanup. A scoped audit finds 28 retired fixture projects, zero claims/undeleted resources, and absent recorded processes and object/mount handles. |
| Required checks | 130 Bun tests, typecheck, lint, knip, jscpd (zero clones), build and commit hooks pass. Actual `git push` of committed 80f4974 to an owned local bare repository runs every pre-push command successfully. No Git network call was made by this revision lane. |
| Real-push failure investigation | With an unconfigured mise Janitor shim, actual local-bare push reproduces all three handshake failures; stderr identifies missing runtime configuration. Plain native-gate tests also fail in that PATH. The unchanged bf51f59 source passes real local and locally emulated SSH-transport pushes with native Janitor 0.3.1. This establishes the reproduced Linux environment failure, not the original Mac cause. |
| Supervisor refusal regression / author run | New diagnostic case fails before the source change and passes after; tool sentinel remains absent and claims retained. Built public CLI with actual unconfigured mise shim reports the underlying error, exit status and launch identity, with no hook execution or changed claims/env bytes. Restored native Janitor completes real Tilt CI and public clean; final fixture claims are empty and recorded launch PIDs absent. |
| Fresh supervisor-error guest | Green at 80f4974 / 9965e0b2: repeated text/JSON refusals preserve claims and both snapshot hashes; native CI runs the hook exactly once; public/repeated clean and invalid-profile checks leave no ownership. Guest fixture removed. |
| Applicable baseline controls | 9882041 duplicate lock-only ports/output escape and 0.9.0 failed-teardown controls retained. New 0.9.0 public control adopts an unchanged same-name fixture node, then a different root deletes it. 0.5.9 deletes a peer reservation with absent lock; the same 0.9.0 control preserves it, so that GC class is absent there. |
| Six correction cases | Dropped role, capitalization-only retarget, publish/delete parent-sync retry, short append and interrupted-append retirement all fail on pre-fix 5344574 and pass on the correction. Actual SQLite/filesystem effects remain real except the named injected failure. |
| Author's full Linux rehearsal | Pass with zero-exit fixture cleanup: concurrent lock-only/live A+B; legacy/cutover and paused old writer; squatter; pre-grant/post-rename crashes; peer preservation; aliases; failed teardown/retry; exact k3d create/retain/delete and child-volume removal. |
| Changed public role-removal flow | Real k3d enabled-to-disabled force refuses with original kubeconfig bytes/path, generation and claims intact. Recorded-target clean succeeds despite edited config; disabled allocation/final cleanup has no old snapshot or claims. |
| Fresh guest | Green at 6ffaa5b / ef71f244: both role removal and capitalization changes, repeated/interrupted attempts, exact byte/claim preservation, documented cleanup, unrelated sentinel preservation and final empty claims. Help-only follow-up was driven from the built CLI. |
| Fresh full example | At 4b0a932 / 2675670d, original inputs pass CI, web/API availability and identities, complete GITHUB_ENV append with no uncertain sink, and public owner cleanup. |
| Scoped closeout | Both disposable stores have zero active generations; no recorded object/mount handle or launched PID remains. Historical unattributable volumes and shared caches are preserved. |

Records: [anonymous-volume correction and Linux qualification](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/anonymous-volumes/README.md),
[crash-completion investigation and fresh qualification](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/crash-completion/README.md),
[real-push and supervisor-error evidence](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/prepush/README.md),
[allocation correction and class audit](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/specialist-r1/README.md),
[full evidence index](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/README.md),
[review response](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/review-response.md),
[fresh guest](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/specialist-r1/guest/verdict-guest.md),
[Mac commands](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/macos-rehearsal.md).

**Plan basis:** Kimi r3 conditional approval, r5 refusal revision, and the
owner's stop/recreate and procedure-A decisions. No standalone r5 approval is
implied. **Specialist:** round 1 was changes required at 5344574; round 2 was
[approve with conditions at fd710d9](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/crash-completion/verdict-specialist-r2.md).
This product cleanup change requires round 3 of 3, launched by the coordinator;
no matching specialist approval is claimed yet. The native Mac 5d2c870 run
passed its rehearsed scenarios but left two unattributed anonymous volumes.
The Linux baseline reproduces the Compose leak; those historical Mac objects
remain preserved. Changed-runtime native Mac qualification, APFS modes,
final versioned artifacts and owner cutover/release gates remain pending.

The [independent claim fact check](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/specialist-r1/fact-check.md)
supports the recorded observations with provenance limits. It is separate
from the required implementation specialist verdict.
The [fresh addendum-4 claim check](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/crash-completion/verdict-claims.md)
supports the local correction and qualification claims, with final publication
and cleanup explicitly left to closeout.

**Noticed:** the supervisor-error guest observed raw mise ANSI escapes inside
the valid JSON diagnostic; no normalization guarantee is claimed. The first
extra example's k3s bootstrap failed and original Tilt
down could not reach its API. Both failures and exact fixture teardown remain
captured. A fresh generation with the original inputs passed; this does not
establish a general reliability or pre-existing-failure conclusion. Compose
teardown left one captured anonymous Redis child, individually verified unused
and removed under the fixture grant. That limitation is corrected for receipted anonymous children at a21f710;
arbitrary tool-managed transient containers before capture remain unqualified.
The first implementation of this correction exposed an in-use retry ordering
error; its failure and recovery are retained, without weakening assertions.

**Not checked / release holds:** new hosted CI, corrected native
macOS/APFS case modes/account/process behavior/directory sync and
Intel/Apple Silicon artifacts; real data-bearing foreign topology, lost live
daemon completion, alternate/remote engines, Docker IPv6 publication races,
Tilt's internal API-listener failure and every instruction-level interruption;
actual host cutover and final 1.0.0 artifact qualification. No waiver added.
The later native Mac run at 5d2c870 passed its native preflight, 130 tests,
actual local-bare hook push and corrected all-suite/full-example scenarios;
its two unattributed volumes prevented complete physical cleanup. This newer
cleanup runtime still needs native Mac qualification. The original Linux live
suite passed, so the natural Mac schedule was not reproduced here. The
first standalone scheduling fixture failed pre-allocation on missing APP_HOST;
that setup failure and the corrected run are retained separately.
The extra full-example log has no per-run command/hash prologue; the
[separate identity record](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/specialist-r1/build-identity.json)
states its author-observed attribution and matching rebuilt bytes.
PR #58 remains draft pending these gates and explicit merge/release approvals.
