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

Current executable source: `4b0a9323f65fef62dfa82936d292110ef6714d40`, CLI
SHA-256 `2675670dc14c3db290a18956f0fdd57f443d7e062b82b2b65e79b64e22e0318e`.
Its parent `6ffaa5b` contains the allocation correction; 4b0a932 changes only
one CI-help sentence after the guest. Later document/evidence commits reuse
unchanged behavioral inputs.

Author environment: ae-dev Linux x86_64/ext4, Bun 1.4.4 / SQLite 3.53.4,
Docker 29.9.2, k3d 5.9.0, Janitor 0.3.1, Tilt 0.37.8 fork. The built public CLI
used native account discovery in disposable filesystem account views; shared
Docker mutations were limited to new exact fixture handles.

| Scenario / check | Observed |
| --- | --- |
| Required checks | 129 Bun tests, typecheck, lint, knip, jscpd (zero clones), build and commit hooks pass. Local pre-push hook passes all commands; no Git network call was made by this revision lane. |
| Applicable baseline controls | 9882041 duplicate lock-only ports/output escape and 0.9.0 failed-teardown controls retained. New 0.9.0 public control adopts an unchanged same-name fixture node, then a different root deletes it. 0.5.9 deletes a peer reservation with absent lock; the same 0.9.0 control preserves it, so that GC class is absent there. |
| Six correction cases | Dropped role, capitalization-only retarget, publish/delete parent-sync retry, short append and interrupted-append retirement all fail on pre-fix 5344574 and pass on the correction. Actual SQLite/filesystem effects remain real except the named injected failure. |
| Author's full Linux rehearsal | Pass with zero-exit fixture cleanup: concurrent lock-only/live A+B; legacy/cutover and paused old writer; squatter; pre-grant/post-rename crashes; peer preservation; aliases; failed teardown/retry; exact k3d create/retain/delete and child-volume removal. |
| Changed public role-removal flow | Real k3d enabled-to-disabled force refuses with original kubeconfig bytes/path, generation and claims intact. Recorded-target clean succeeds despite edited config; disabled allocation/final cleanup has no old snapshot or claims. |
| Fresh guest | Green at 6ffaa5b / ef71f244: both role removal and capitalization changes, repeated/interrupted attempts, exact byte/claim preservation, documented cleanup, unrelated sentinel preservation and final empty claims. Help-only follow-up was driven from the built CLI. |
| Fresh full example | At 4b0a932 / 2675670d, original inputs pass CI, web/API availability and identities, complete GITHUB_ENV append with no uncertain sink, and public owner cleanup. |
| Scoped closeout | Both disposable stores have zero active generations; no recorded object/mount handle or launched PID remains. Historical unattributable volumes and shared caches are preserved. |

Records: [current evidence and class audit](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/specialist-r1/README.md),
[full evidence index](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/README.md),
[review response](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/review-response.md),
[fresh guest](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/specialist-r1/guest/verdict-guest.md),
[Mac commands](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/macos-rehearsal.md).

**Plan basis:** Kimi r3 conditional approval, r5 refusal revision, and the
owner's stop/recreate and procedure-A decisions. No standalone r5 approval is
implied. **Specialist:** round 1 is changes required at 5344574; all four
findings are supported and answered. Corrected-head cross-provider re-review
is pending; no new approval is claimed.

The [independent claim fact check](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/specialist-r1/fact-check.md)
supports the recorded observations with provenance limits. It is separate
from the required implementation specialist verdict.

**Noticed:** the first extra example's k3s bootstrap failed and original Tilt
down could not reach its API. Both failures and exact fixture teardown remain
captured. A fresh generation with the original inputs passed; this does not
establish a general reliability or pre-existing-failure conclusion. Compose
teardown left one captured anonymous Redis child, individually verified unused
and removed under the fixture grant. Automatic arbitrary Compose child-volume
removal is not claimed; native k3d child removal is observed separately.

**Not checked / release holds:** corrected-head specialist approval, new hosted
CI, native macOS/APFS case modes/account/process behavior/directory sync and
Intel/Apple Silicon artifacts; real data-bearing foreign topology, lost live
daemon completion, alternate/remote engines, Docker IPv6 publication races,
Tilt's internal API-listener failure and every instruction-level interruption;
actual host cutover and final 1.0.0 artifact qualification. No waiver added.
The extra full-example log has no per-run command/hash prologue; the
[separate identity record](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/specialist-r1/build-identity.json)
states its author-observed attribution and matching rebuilt bytes.
PR #58 remains draft pending these gates and explicit merge/release approvals.
