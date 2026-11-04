## What

Reserve each project's ports, final resource names and physical file targets in one durable account-scoped SQLite transaction. Bind exports, gated tool groups, backend receipts and cleanup to the project generation. Refuse all old JSON/root-lock state read-only; stop/recreate replaces migration.

## Why

The 0.9.0 allocator can commit duplicate lock-only ports, overwrite an escaping output, and clean after a failed Tilt teardown. Deterministic native controls reproduced those failures. Shared-host cleanup and the public CLI/file contract make this high risk.

## How

- One claim constructor, per-project operation fencing and receipt-bound file capabilities; no peer GC or TTL reclamation.
- Janitor process-group-only execution gates and immutable executor completion facts; uncertain creates or missing completion keep claims.
- Exact engine/resource identity and physical file-target checks; leftovers refuse instead of adoption/deletion. Successful exact delete retries reconcile completed failures.
- Version-2 consumer snapshots, stopped-only force, protected output paths, canonical native account lookup, matching docs/skill and pinned Bun 1.4.4 / Janitor 0.3.1.

## Rollout

**Draft; do not merge, mark ready or release.** Intended semver: **1.0.0** via the included major changeset. The feature branch/PR is a proposal. Main tracks the release workflow; after explicit approval, Changesets normally opens the Release PR, whose merge publishes npm via OIDC. No version/tag/release/publication happened here.

Before a host's first new allocation: announce cutover, upgrade or retire every permitted old invocation, and wait for every old operation to become terminal—including an old command paused before registration. Each owner stops and recreates its ephemeral projects. No data, ports, clusters or volumes carry over. No actual ae-dev cutover or peer stop/cleanup is authorized by this PR.

## Risk

A defect could affect another project's local resources or reservations. Config/hooks/tools remain trusted and must consume generated identities/ports; this is cooperative allocation, not arbitrary shell containment. Old clients after cutover can allocate the new lock-only numbers; the rehearsal observed that limit with unchanged SQLite claims. A later legacy entry blocks new commands but cannot undo the old invocation.

## Verify after deploy

Run the portable rehearsal in a disposable native account on Linux and macOS, as specified in `macos-rehearsal.md`. On an actual host, owners must first complete the cutover precondition; then inspect each new generation with `status --json`, drive its Tilt API and service endpoints, and use explicit owned teardown. Never remove peer metadata to obtain a clean scan.

## Rollback

Prefer a forward fix. An old binary cannot manage the SQLite domain. Before any deliberate downgrade, every new generation must be stopped/reconciled by its owner and all permitted invocations coordinated; never run old/new allocators together or replace the store with empty state. This PR authorizes no downgrade or data deletion.

## Evidence

- Source: `e4e77aa978cca4aa8210b0695123a7b8e7fa402d`; built artifact SHA-256 `6e5e0848141659a58a316071623bc63eb05716cc8f16d68bb4bcdb8eb325b8d0`. Evidence-only commits reuse unchanged observations; a later executable correction and its fresh qualification are recorded below.
- Author drove the built public CLI on ae-dev/Linux x86_64, ext4, Bun 1.4.4/SQLite 3.53.4, Docker 29.9.2, k3d 5.9.0, Janitor 0.3.1 and Tilt 0.37.8 fork. Native Docker was shared; only owned fixtures and a disposable filesystem account view were mutated.
- `typecheck`, `lint`, `check` (knip/jscpd), 123 Bun tests, build, packaged-skill validation, portable native rehearsal and full example passed. Source-commit hooks were observed passing by the author; retained gate outputs and the later evidence-commit hook record are linked from the index. Injected-store tests do not qualify Docker/canonical completion; the public rehearsal covers them separately.

| Scenario | Observed |
| --- | --- |
| Concurrent env/live A+B | Disjoint claims/ports, distinct real services; B's exact state and endpoint survive A owner SIGKILL/recovery. |
| Legacy/cutover | All five commands refuse in both roots for each of three legacy directories; unchanged trees/store bytes. Genuine paused old command drains before new allocation. Pre-registry lock refuses. |
| Gate/export crashes | SIGKILL before grant executes no hook; after rename/before checkpoint recovers only the journaled inode. |
| Squatter/failed teardown | Native Tilt bind failure preserves squatter and assignments; failed down retains snapshots/claims, exact successful retry recovers. |
| Leftovers/retention | Network/volume and stopped synthetic k3d node/registry residues refuse unchanged; unreceipted files refuse. Real owned k3d creation, retention, exact deletion and engine-unavailable refusal passed. |
| Files/aliases | Native SQLite/filesystem tests cover peer preservation, prefix overlap, physical aliases, traversal, cross-role targets, replacements, parent drift and CI sinks. |
| Example | Actual web/API availability and service-proxy health, Compose/k3d receipts and owned teardown passed. |

Record: [evidence index](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/README.md), with command/exit records, asserted outcomes, selected raw refusals, exact object IDs, failures and corrections. [Mac commands](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/macos-rehearsal.md). [Specialist request](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/specialist-request.md).

**Plan basis:** Kimi r3 `approve with conditions`; r5 stop/recreate refusal revision; the owner's 23:3xZ choice and 00:4xZ choice A resolve the remaining cutover precondition. No standalone r5 approval is implied. **Guest:** [green, with captures](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/guest/verdict-guest.md), against the immutable artifact above: legacy owner stop/recreate, separate live variants and profile switch, retained k3d refusal/owned deletion. Skill comparison was decision-only; both arms used current docs successfully and no causal effectiveness gain is claimed. **Specialist:** pending cross-provider review; no implementation verdict claimed.

**Noticed:** the first crash left a server alive; the repeat passed after duplicate executor signal forwarding was removed. Bun's account-home API followed HOME; k3d registry naming differed from the assumed prefix; Tilt's default Compose project ignored the generated name; successful delete retry initially left an earlier completed failure unresolved. The evidence preserves failures and corrected runs. The guest hesitated when `stopped` still required `down` before restart; a documentation clarification explains the remaining workload receipt.

**Not checked / release holds:** macOS/APFS and other architectures; live data-bearing foreign clusters; actual host cutover; Docker IPv6 publication races; Tilt's independently selected internal API listener failure; deliberately lost live daemon-request completion; every instruction-level crash timing. No waiver added. No tag, npm publication, release or merge was performed.

### Current executable qualification

Current executable source is `d6590a5bb129cb90cb50bb1617bfe3ac966d907b`, CLI SHA-256 `1a09c9812329a16342f95b7c006ddd5d844f611c6dbb3b5febca6a0e21396abc`. Exact owned-container deletion now asks Docker to remove its anonymous children. The final all-suite native run passed at this source/artifact, including captured volume-handle absence after cluster deletion. The [refreshed deletion guest is green](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/guest-r2/verdict-guest.md): all four node anonymous volumes disappeared and an unrelated named volume's metadata/sentinel remained unchanged. The original guest still covers unchanged lifecycle flows.

Hosted [CI](https://github.com/alleneubank/silo/actions/runs/41768909265) and [example](https://github.com/alleneubank/silo/actions/runs/41768909399) passed at d6590a5. Two earlier hosted failures are retained: a legacy fixture inherited the Actions CI marker, then a raw Docker-inspect comparison depended on Mounts ordering. The harness now isolates that environment and compares all fields structurally, normalizing only the unordered mount list. Assertions were not removed.

**Host cleanup boundary:** earlier experimental container removals omitted anonymous child removal. Native records proved ownership of 25 unused anonymous fixture volumes, which were individually verified and removed. Older real-cluster mount IDs were not retained and are outside the engine's event window. Unattributable anonymous volumes on this shared host are left untouched; the lane cannot attest that every historical child is removed. The coordinator report asks for preservation or authoritative provenance for any further owner-only cleanup. No wildcard/age-based cleanup is proposed.

The refreshed guest corrected a private inspection capture that initially included an ephemeral fixture token: the retained node capture contains only allowlisted identity/mount fields and the cluster was destroyed. The product's status receipts already filter labels.

Mac native qualification, matching specialist approval and the real host cutover remain pending. This PR remains draft; no waiver, release or merge is requested.
