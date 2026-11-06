green

This is a targeted follow-up on source `3f87992621a06888ec32c55afe46ec9b71211005`, built CLI SHA256 `2e4f0501ccc6423900d902a70623a629917153cc7c0a772b6eef3cb779741ec6`, version 0.9.0. Only the registry-enabled k3d failed-create/cleanup path was rerun. The previous guest rows are not requalified for this build.

| Scenario | Result | Observed | Capture |
| --- | --- | --- | --- |
| Registry-enabled k3d create fails on its allocated API port | pass | Fresh root, declared K3D_REGISTRY_PORT, registry enabled/advertised. Own bounded HTTP listener on returned API port 49154 survived real k3d `PORT_BIND_CONFLICT`. Failed-create status recorded registry, server, loadbalancer, network, and named cache receipts. | `logs/allocated.json`, `logs/listener-ready.json`, `logs/listener-preserved.out`, `logs/ci-port-failure.out`, `logs/failed-resources-summary.json` |
| Public cluster deletion removes the recorded registry and anonymous data | pass | `down --delete-cluster` succeeded. Registry container `000679525aeb5f2b6cb48740f0899090cadb189dbdf3ba0d994f657b118d43a3` and anonymous `/var/lib/registry` volume `f182e84ec4e37f0f0002667d2b82314db13fd4e26600b736993b6b8b34fabcde` were independently absent. Server/loadbalancer/network and four server anonymous volumes were also absent. | `logs/down-delete.out`, `resources/independent-before-clean.jsonl`, `logs/after-delete-status.json`, `logs/exact-after-delete.jsonl` |
| Cache/claims retained until separate owner resolution; final cleanup retry | pass | Named cache survived cluster deletion, with 22 claims retained. Public clean refused while it remained. Owner independently verified original Name/CreatedAt/project/generation/cluster/no users, then removed that own cache. Public clean succeeded, released all claims and snapshots, and repeat clean returned `changed:false`. | `logs/clean-retained-cache.out`, `logs/retained-status.json`, `logs/cache-owner-verification.json`, `logs/cache-owner-removal.out`, `logs/clean-final.out`, `logs/clean-repeat.out`, `logs/final-status.json` |

No product failure was observed in this targeted follow-up. The intentional failed-create result was `PORT_BIND_CONFLICT`; the intentional pre-owner-resolution clean refusal was `CLEANUP_REQUIRED`.

What worked: The registry receipt includes its immutable container ID and anonymous-data audit receipt even after the known failed cluster create. Public deletion removed both physical objects. Cleanup retained the cache and claims until independent owner resolution, then became a repeatable no-op.

Papercuts: The named cache still needs a separate owner action, as documented. No additional recovery or cleanup retries were needed after that action.

Hesitations: The registry receipt has cluster/role labels rather than the Silo project/generation labels present on server receipts. Its physical name also lacks the `k3d-` prefix used by server/container names. The exact ID, creation time, role and cluster were enough to correlate the documented registry with its receipt.

Looks: CLI-only review. The JSON error includes long escaped ANSI k3d diagnostics; the stable error code and bind-address diagnostic are readable. No browser or rendered UI was tried.

Trust: The targeted failed-create recovery and data-parent cleanup behaved as documented. This supports the tested disposable development use case; successful registry advertisement and production-data safety were not evaluated.

First fix: None required by this follow-up.

Accounting and boundaries:

- Ran only through the existing supplied guest view, using built CLI help/docs and public generated state. No implementation source, diff, author evidence, harness or sessions were read. No additional agents were used.
- Docker event/inspect persistence uses an allowlist: immutable IDs, names, creation times, owner/cluster/role/Compose labels and mounts. Raw container Config/Env and token labels were omitted before writing; `k3d.cluster.token` and `K3S_TOKEN` values were not persisted by this follow-up.
- Live observers recorded exact network/cache/server/loadbalancer/tools IDs and mount handles. The initial registry name observer incorrectly expected a `k3d-` prefix, while its project-label observer did not match the registry labels. Therefore the registry immutable ID and data handle were first recorded from failed-create public status, then independently inspected before public deletion; they were not independently captured at the creation instant. A later corrected exact-name event query did not establish historical creation coverage. This timing gap is recorded rather than treated as a live create-event capture. `resources/receipt-ledger.jsonl` and `resources/independent-before-clean.jsonl` preserve the ID/creation/label/mount correlation used before deletion.
- The transient k3d tools container was captured this time: `cf5be144669bfea9d6a752952d99810c7083e3785dc67ba140ab2f5f096ccfc2`; its exact ID is absent at exit. No manual container/network deletion was performed.
- The squatter group was saved immediately and stopped only after UID 30033, matching PGID and exact command validation: `logs/listener-stop-identity.txt`. Its HTTP endpoint refused afterward. All own observer groups were stopped after equivalent validation. Every saved driver/listener/observer PID, observer child PID and recorded Silo supervisor/leader PID was absent at exit: `logs/observer-stops.jsonl`, `logs/final-process-audit.jsonl`.
- All recorded resources, including the registry data and tools ID, are absent: `logs/exact-final-absence.jsonl`, `logs/event-handles-final-absence.jsonl`. Final allocation is unallocated with zero claims. No own stack, listener, observer, or known data object remains; scratch/captures remain as requested.
- Native ports were TILT 49152 (not started), REGISTRY 49153, API squatter 49154. Listener readiness was `2026-11-06T05:52:01.444Z`; it was stopped before public deletion. Run occurred on shared onyx native Docker through the provided account view with synthetic fixtures only. The k3d slot was returned to the parent after retirement.

Build/scope: `/opt/dist/cli.js`, source `3f87992621a06888ec32c55afe46ec9b71211005`, SHA256 `2e4f0501ccc6423900d902a70623a629917153cc7c0a772b6eef3cb779741ec6`, v0.9.0. Not tried on this build: previous capacity/Compose/network-overlap rows, successful registry advertisement, successful Kubernetes workload startup, browser UI, arbitrary shared/inherited volumes, production data, credential/system changes, global Kubernetes changes, project-wide teardown or prune.
