# Round-7 response

The round-7 approve-with-conditions verdict at a6841309 has no blocking finding.
Addendum 9 directs should-fix 1 with the reviewer's remedy. Deletion authority
is unchanged: one leaf removes exact recorded container/network IDs.

## Should-fix 1: registry provenance from any finished producer

Supported and reproduced first on the exact a6841309 artifact
(CLI 2e4f0501…, the dist/ build qualified in round 7), with the reviewer's
distinguishing check driven through the public CLI on real Docker/k3d:

- `ci` variant. A pre-up hook starts a lone
  `docker run -d --name <registry> --label k3d.cluster=<cluster>` container that
  publishes the assigned registry port. At a6841309 the hook's capture receipted
  it (`squatterReceipted: true`), the preflight passed and the k3d create then
  failed on the name (`COMMAND_FAILED`). The first red attempt's squatter did not
  publish the port and was refused by publication validation
  (`PORT_BIND_CONFLICT`). That attempt is kept as
  `registry-provenance-red-unpublished.log`, but it is not the distinguishing red.
- Timed-out pre-up hook variant. The hook starts the squatter, then blocks
  until the real 300 s hook timeout. At a6841309,
  `down --delete-cluster` captured the pending hook, receipted the squatter and
  deleted it by ID (`owned-container-delete` exit 0 on c1cd1c61825f…). This is the
  deletion the reviewer predicted. The container was a recorded fixture.

Fix (a885d6a): `captureFinishedProducers` derives one `CaptureProvenance` value
from the pending set. `registryRequested` is true only when a pending launch has
kind `K3D_CLUSTER_CREATE_KIND` and a recorded command that passes
`--registry-create` with this allocation's exact registry identity. k3d.ts and
capture share the constant. Exit code still plays no part. Compose provenance
comes from the same value, so behaviour is unchanged there. SPEC.md:153 again
requires "the completed owned creation request", now naming the cluster create,
and states that hooks cannot vouch for a registry.

Green at a885d6a / CLI 492be5fe…: both variants refuse `NAME_CONFLICT`, and the
squatter stays byte-identical in `docker inspect` through ci and down. Claims are
kept. After the fixture owner removes the squatter by exact ID, public
`down --delete-cluster --clean` retires the generation. These scenarios are now
the permanent `registry-provenance` rehearsal suite, which runs under `all` and
`producers`.

## Notes

1. Timed-out create reconciling after capture: unchanged. This is the coordinator's
   accepted trade. A late daemon effect leaves an unrecorded object that the next
   claimant refuses. Nothing is deleted.
2. Repeated failed deletes filling capacity: unchanged. The reviewer's
   construction (supersede a failed delete whose target is re-verified present)
   is a separate edit and is not covered by this one.
3. Pre-up hook capture tombstoning k3d receipts before ensureCluster: unchanged,
   because it is not a one-line ordering fix:
   - Skipping the k3d capture for hooks would reopen round 6's finished-producer
     class. Hook-created, labelled outputs in k3d's namespace would go unrecorded.
   - Moving the retained-receipt check ahead of pre-up hooks splits ensureCluster's
     verification across prepare.
   The effect stays diagnostic only. The failure surfaces later, and recovery is
   ordinary `down --delete-cluster`.
4. More capture points per hook: unchanged.
