# Response to specialist round 3

Candidate runtime: `20997dc740bd1df00c351cb4db6b4ba20734e47b`, artifact
`90a44fcc8641b959544e2cb9e9525d469b8749ea8abc680ababe87b7329e7e0f`.
The requested fourth review is pending; this response is not an approval.

1. **Blocking: same-second replacement and inspect/delete race — supported,
   addressed by the human-approved redesign.** The 02:21Z 2026-11-05 decision
   replaces unique-name deletion with removing anonymous data only through its
   exact recorded container ID. Built-in deletion accepts container/network
   targets, never volume names. Parent/mount receipts remain audit data. A
   missing parent or surviving mount name is reported and blocks clean/force
   with claims intact. No timestamp/label comparison grants volume deletion.
   Native same-second and paused-boundary tests both fail against fff3083 and
   pass at this runtime; a fresh guest independently preserves replacement
   identity and readable data. Exact parent removal also removes anonymous data
   before a deliberately failed later Tilt teardown. Named mounts survive.

   Docker may remove an inherited anonymous volume when its last user is
   removed; the implementation therefore refuses ambiguous volumes-from
   provenance before removal. Native donor/borrower tests confirm both the
   shared-reference preservation and last-user behavior. The named k3d image
   cache is retained for its owner, not deleted through an exception.

2. **Should fix: successful retry crash strands the earlier failed receipt —
   supported, fixed in common recovery.** Completion import folds durable
   successful exact-delete facts through the common reconciliation rule,
   bounded to earlier matching intents. It does not infer success from an
   empty listing or resolve a later failure from an older success. The narrow
   store regression fails before the fix. A real public-CLI network-delete
   case also fails on fff3083: the first delete fails on an endpoint, its retry
   succeeds, the executor fact becomes durable while the CLI is stopped, and
   that CLI is killed before importing it. Corrected recovery retires with
   empty claims and no repeat deletion of the absent network. Earlier-success
   versus later-failure and ordinary retry cases also pass.

3. **Note: missing raw qualification files — supported.** The current evidence
   record retains the red-first logs, current 132-test/static/build gates,
   actual local-bare hook push, complete 339-command all-suite outputs, copied
   full-example mount/status/health/cleanup outputs, guest logs and scoped
   closing audit. No missing historical file is presented as current evidence.

Evidence: [container-scoped cleanup record](evidence/atomic-allocation/container-scoped-volumes/README.md).
All native final fixture cleanups pass. Private account/env/lock/kubeconfig
files are excluded from committed evidence. Shared caches, unrecorded objects
and historical unattributed Mac volumes are preserved.

Unchanged holds: matching fourth specialist review, corrected native Mac/APFS
and final release-artifact qualification, owner-led cutover and coordinator
release decisions. No new waiver or publication by this lane.
