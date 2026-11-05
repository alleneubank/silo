## What

Reserve each project's ports, resource names and physical file targets in one
account-scoped SQLite transaction. Bind lifecycle effects and cleanup to its
project generation; refuse legacy JSON/root-lock state read-only and require
owners to stop/recreate ephemeral projects.

Anonymous volumes are removed only with exact receipted container IDs using
Docker's container removal operation. Built-in cleanup never deletes a volume
by name. Surviving names are audit evidence, not cleanup authority.

## Why

The 0.9.0 allocator can duplicate reservations, overwrite escaping outputs,
reuse peer resources and report success after failed teardown. The prior
candidate's anonymous-volume cleanup also allowed a same-second or
post-inspection replacement to be deleted by name. These are shared-host
ownership and breaking public-contract changes.

## How

- One transactional claim constructor, generation/operation fencing, owned-file
  capabilities, gated Janitor groups and durable executor completion facts.
- Exact Docker container/network identities. Compose parents are removed with
  anonymous mounts before Tilt can discard the handles; explicit k3d deletion
  uses the same container path. Mount receipts survive for audit only.
- Named/explicit mounts and volumes still used elsewhere survive. Ambiguous
  inherited volumes-from provenance refuses before removal. Leaked/replaced
  names block clean/force with retained claims until their owner resolves them.
- k3d's required named image cache also survives cluster deletion. Its owner
  must resolve it independently before clean can release claims. The native
  harness's cache removal is separate fixture-owner teardown.
- Recovery folds a durable successful exact deletion retry over earlier matching
  failed intents; an earlier success cannot reconcile a later failure.

## Rollout

**Keep draft.** Intended release is **1.0.0** through the included major
changeset; package/plugin versions remain 0.9.0. No migration or reuse of old
project state. Before the first new host allocation, owners announce cutover,
upgrade/retire old clients and drain all old operations, including paused old
writers, then stop/recreate their own projects.

The human approved container-scoped removal on 2026-11-05 at 02:21Z and a fourth
specialist round. That review and corrected native Mac/final-artifact
qualification remain required. Feature-branch pushes are proposals; main's
Changesets release workflow can publish npm. This lane ran no GitHub write,
network push, merge, tag, release, npm publication, real cutover or S1 adoption.

## Risk

A defect can affect local peer data/reservations. The threat model is trusted
local users/agents and cooperating config/tools on one shared host: accidental
collisions, replacements, deletions, crashes and squatters, not malicious local
writers. No private runtime/proxy or arbitrary shell containment is promised.

A missing parent or shared anonymous mount can leak data. Silo reports it and
keeps claims; repeated clean cannot delete an orphan by name. The retained
named k3d cache requires independent owner resolution. These availability costs
preserve the ownership boundary; no waiver narrows the replacement cases.

## Verify after deploy

After owner-led cutover, inspect `status --json`, drive Tilt/service endpoints,
and use explicit owned teardown. Verify leaked names/named mounts keep claims
and that only their owner resolves them. Use `macos-rehearsal.md` for matching
native qualification; never remove peer metadata or prune to clear an error.

## Rollback

Prefer a forward fix. Old binaries cannot manage the SQLite domain. Before an
approved downgrade, owners must stop/reconcile new generations and coordinate
all permitted clients. Never mix allocators or replace the store with empty
state. This proposal grants no downgrade or data-deletion authority.

## Evidence

Executable source: `20997dc740bd1df00c351cb4db6b4ba20734e47b`.
CLI SHA-256: `90a44fcc8641b959544e2cb9e9525d469b8749ea8abc680ababe87b7329e7e0f`.
Later record-only commits reuse these unchanged runtime inputs.

Author drove the built public CLI on onyx Linux x64 with real Docker, k3d,
Tilt and Janitor in disposable account filesystem views. Native source and
raw observations are in [the cleanup evidence record](https://github.com/alleneubank/silo/blob/feat/atomic-allocation/evidence/atomic-allocation/container-scoped-volumes/README.md).

| Scenario / check | Observation |
| --- | --- |
| Red first at fff3083 | Same-second replacement and paused post-inspection replacement are deleted by baseline clean. Parent-scoped failure test leaves its parent. A real successful network-delete retry followed by CLI death strands the earlier failed request. All four distinguish the correction. |
| Required checks | 132 Bun tests / 343 assertions; typecheck, lint, knip, jscpd (zero clones), build and normal commit hooks pass. A real local-bare push runs every pre-push hook and receives exact source ref 20997dc. |
| Full author CLI rehearsal | All-suite passes across 339 recorded commands, including the prior legacy/cutover, crash/peer/file cases and current k3d/volume cases. All 22 final fixture cleanup commands exit 0. |
| Volume risk scenarios | Same-second and paused-boundary replacements survive with claims intact. Shared data survives parent removal; orphaned/replaced names block clean/force. Explicit named and borrowed data survive. Inherited provenance refuses, with native last-user behavior separately observed. |
| Real retry/crash recovery | First network delete fails on a real fixture endpoint. Retry succeeds and its exact executor completion is durable while the CLI remains stopped with a granted receipt. Killing that CLI then running public recovery retires without another deletion of the absent network. |
| Copied full example | CI and web/API health pass. All seven distinct mounted volumes have receipts: six anonymous names disappear with parents; the named cache survives and clean retains claims. Separate exact fixture-owner cache resolution permits public retirement. |
| Fresh guest | Green at source 20997dc / artifact 90a44fcc: real Compose/Redis, peer preservation, repeated clean, named/explicit data readback, shared/orphan/replacement preservation and owner-resolution recovery. |
| Scoped resource audit | Current author 20 and guest 5 project records have generation 0 and no claims/active resources/operations. All 153 recorded Docker handles and 1,086 recorded PID/group numbers are absent, including archived failed experiments. |

Plan basis: reviewed r3/r5 allocation design and human stop/recreate/procedure-A
choices, superseded for volumes by the 2026-11-05 container-removal decision.
Round 2 approved fd710d9 with conditions; round 3 required changes at fff3083.
**Round 4 is pending** over the full fd710d9d..proposal delta. No matching
specialist approval, merge readiness or release approval is claimed.

Noticed: force's existing ALREADY_RUNNING code covers stopped retained state;
the guest found the label mildly confusing. A discarded cache-disable attempt
failed pinned k3d tools-node creation; all its physical objects were removed,
but its archived test store deliberately retains failed-request uncertainty.
That experiment is not presented as a candidate pass or a pre-existing failure.

Not checked: corrected native Mac/APFS modes/account/process/fsync, final
Intel/Apple Silicon 1.0.0 artifacts, new hosted CI, actual cutover, lost executor
facts, arbitrary transient containers before capture, alternate/remote engines
or every daemon instruction-level interruption. No new waiver. Historical
unattributed Mac volumes remain untouched.
