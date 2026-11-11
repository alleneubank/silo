green

| Scenario | Result | Observed | Capture |
| --- | --- | --- | --- |
| Run real CI to create the owned cluster | pass | `ci guest-r2-retained --timeout 120s` exited 0. Status showed the real k3d creation and Tilt CI launches exited 0, and the project retained its cluster. | [CI](captures/ci.log), [retained status](captures/status-retained.json) |
| Record exact cluster mounts and anonymous volume children | pass | Exact server and load-balancer container inspection succeeded. The server mounted four anonymous volumes at `/var/log`, `/var/lib/cni`, `/var/lib/kubelet`, and `/var/lib/rancher/k3s`. Both nodes mounted the named images volume. Each volume existed in Docker before cleanup. | [node mounts and IDs](captures/node-mounts-before.txt), [volume inspection](captures/volumes-before.json) |
| Attempt clean while the cluster is retained | pass | `down --clean --json` exited 1 with `CLEANUP_REQUIRED`, named retained resources, and kept ownership. Exact node IDs still existed afterward. | [refusal](captures/retained-clean.log), [status](captures/status-after-retained-clean.json), [nodes](captures/nodes-still-retained.txt) |
| Use documented explicit owned deletion | pass | `down --delete-cluster --clean --json` exited 0, removed snapshots, and returned unallocated state with no claims/resources. Docker then reported both exact node IDs, all four exact anonymous volume IDs, the named images volume, and the exact network ID absent. | [cleanup](captures/explicit-clean.log), [nodes absent](captures/nodes-after.txt), [volumes absent](captures/volumes-after.txt), [network absent](captures/network-after.txt) |
| Preserve unrelated named control volume and file | pass | `guest-r2-control-20261104-0345` still existed after cluster deletion. Its Docker metadata and literal sentinel contents were byte-identical before and after. | [before](captures/control-before.json), [after](captures/control-after.json), [sentinel before](captures/control-sentinel-before.txt), [sentinel after](captures/control-sentinel-after.txt), [comparison](captures/control-comparison.txt) |
| Repeat explicit cleanup from a fresh CLI invocation | pass | Repeating the same command exited 0, reported nothing allocated, and returned `changed:false`. Fresh status remained unallocated. | [repeat](captures/repeated-clean.log), [final status](captures/status-final.json) |
| Teardown own control fixture | pass | Removed only the recorded control volume after preservation captures. Docker confirmed that volume and both short-lived `--rm` verification containers absent. | [removal](captures/control-remove.txt), [absence](captures/control-removed.txt), [containers absent](captures/sentinel-containers-removed.txt) |

No product failures were observed in this bounded deletion-flow assignment.

**What worked:** The documented retain-then-explicit-delete sequence matched the observed behavior. The refusal named what remained and the explicit deletion released ownership only after removing the cluster. Repeated cleanup was clear and harmless.

**Papercuts:** CI printed only snapshot-generation messages in this package, so the guest used `status --json` to confirm the k3d and Tilt launch exit codes. This did not block the scenario.

**Hesitations:** The ordinary status resource list showed the named images volume but did not enumerate the anonymous node mount volumes. The guest used direct Docker mount inspection to establish those exact handles independently.

**Looks:** CLI-only exercise; no graphical surface was changed or reviewed.

**Trust:** The observed exact-handle deletion and unchanged unrelated volume support trusting this bounded ephemeral-cluster cleanup. This exercise does not establish behavior for other workloads or adversarial races.

**First fix:** Consider exposing the node-associated anonymous mount volumes in user-visible cleanup/status information so users can see the full deletion footprint.

**Capture correction:** The first node inspection requested full Docker labels and exposed an ephemeral cluster token in tool output. That local capture was immediately overwritten with only ID/name/mounts and Silo project/generation labels; the final retained capture contains no full labels or token. The already authorized exact cluster deletion then completed, removing that cluster. No kubeconfig contents were printed. This was a guest inspection mistake, not a product finding.

Resources and teardown:

- Project `abfcd518-163d-46bd-8d9c-4a3d34f8b211`, generation 1, cluster `localnet-guest-r2-retained`; exact Docker handles are in the linked before/after captures. Both nodes, the network, named images volume, and all four anonymous children were removed through Silo.
- Own unrelated control volume `guest-r2-control-20261104-0345` was removed only after its unchanged sentinel was captured. Own verification containers `guest-r2-sentinel-write-20261104-0345` and `guest-r2-sentinel-read-20261104-0345` used `--rm`, no network, explicit guest labels, and no daemon.
- Foreground lifecycle gates ran under `setsid --wait`; each capture records actual PID/PGID/SID. All returned normally; no process signals or cleanup selectors were used.
- Supplied fixture config and Tiltfile remain; generated env/lock snapshots were removed by Silo. Captures and this verdict remain for review. No peer roots/resources, credentials, or credential configuration were changed.

Build used: packaged CLI under `guest-product-r2`, source head `d6590a5bb129cb90cb50bb1617bfe3ac966d907b`, CLI SHA256 `1a09c9812329a16342f95b7c006ddd5d844f611c6dbb3b5febca6a0e21396abc` ([hash](captures/build.txt)). Invoked through the supplied isolated-account wrappers at sandbox root `/tmp/guest-r2/retained`, using the real shared local Docker engine. Product docs were read; source, diff, history, and author sessions were not read.

Not tried: other prior guest flows, unrelated workloads, Compose, registry, interrupted deletion/races, other Docker engines, or production. No skipped scenario above is counted as a pass, and no waivers were added.
