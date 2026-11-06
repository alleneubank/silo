# Specialist round 8 request (delta)

The coordinator owns this review. Use one profile-free specialist with a
read-only shell and charter:
/home/ae/.codex/plugins/cache/agent-profile/agent-workflows/16.2.0/skills/done/references/specialist.md.
Return verdict-specialist-r8.md. Do not change code or launch another reviewer.

Scope is the delta a6841309166d0e4a77bae76563d1b904ad21d97d..HEAD, which round 7
approved with conditions. Its only executable change is a885d6a:
- `src/backends/ownership.ts`: `CaptureProvenance`, `K3D_CLUSTER_CREATE_KIND`
  and the registry branch of `captureOwnedResources`;
- `src/backends/k3d.ts`, which uses the shared kind;
- SPEC.md:153-157;
- the new `registryProvenance` scenarios in `scripts/allocation-rehearsal.ts`,
  plus `--force` on the harness's fixture-container cleanup, which runs only after
  exact identity checks.

Later commits are records only. Confirm the reviewed ref. Handoff pr-ops.md
seals the exact proposal ref and push.

Question: does registry provenance now require the finished cluster create
that requested the exact registry, and nothing else? Check that:
- exit-code independence is kept;
- no deletion authority is widened;
- every other producer path (hooks, workloads, network/volume creates, registry
  advertise, Tilt) records exactly what it did at a6841309, apart from the
  registry.

Threat model, the human decisions (addendum 6: delete recorded IDs only, stop
verified recorded processes) and the coordinator's recording call are unchanged
from round 7.

Evidence: evidence/atomic-allocation/registry-provenance/README.md, raw red and
green logs, gates, the full suite and the copied example. review-response-r7.md
maps the finding and notes 1-4. Notes 1-4 are unchanged, and the response says
why note 3 is not a one-line ordering fix.

Neighbors not driven are unchanged from round 7:
- native Mac and the final artifacts;
- cutover and mixed clients;
- pending-capture and read-only-validation windows;
- unknown or late create effects, transient parents, Compose in-place
  recreate, external Kubernetes, alternate engines and interruption points;
- the two unattributed earlier failures.

New for this round: a squatter that never publishes the assigned registry port
is refused by publication validation (`PORT_BIND_CONFLICT`) before provenance
applies. The distinguishing check therefore publishes that port. Keep PR #58 a
draft.
