# Registry provenance limited to the cluster create

This is a verified Linux proposal. The matching specialist round 8 (delta) and
the native Mac run are still required. Round 7 approved with conditions at
a6841309, and addendum 9 directs its should-fix 1. Deletion authority is
unchanged: one leaf removes only exact recorded container/network IDs, and Silo
stops only verified recorded processes. There has been no PR edit, merge,
release, cutover or S1 adoption.

Qualified source: `a885d6afadbdbf6a56d10ddafa2b823df95dc86a`.
CLI SHA-256: `492be5fec07d54662c51d2c11645eeedb81a54435b40d62946513b0553c56e5b`
(head-artifact.txt). Red baseline: the exact round-7 artifact
`2e4f0501ccc6423900d902a70623a629917153cc7c0a772b6eef3cb779741ec6`
(baseline-artifact.txt), built from 3f87992 = a6841309's executable inputs.

## Construction

`captureFinishedProducers` derives one `CaptureProvenance` from the pending
finished launches.

- `registryRequested` holds only when a pending launch has kind
  `K3D_CLUSTER_CREATE_KIND`, the constant k3d.ts uses. That launch's recorded
  command must also pass `--registry-create` with this allocation's exact
  registry identity.
- Exit code plays no part, as in round 7.
- No other producer can make k3d's unlabelled registry acceptable to capture.
  This includes pre-up/post-up hooks, workloads, network/volume creates and the
  registry advertise.
- `composeLaunched` comes from the same value, so Compose provenance is
  unchanged.

SPEC.md:153-157 again states "the completed owned creation request".

## Observations

Host: onyx Linux x64, native Docker 29.9.2, Bun 1.4.4, Janitor 0.3.1, the Tilt fork,
and k3d 5.9.0 with its checksum verified against the release's checksums.txt
(k3d-verified.txt). The legacy 0.9.0/0.5.9 tarballs were verified against npm
`dist.integrity` (legacy-verified.txt). Runs used a disposable bwrap account view
(launchers/sandbox.sh.txt) and recorded process groups
(launchers/run-owned.sh.txt).

| Check / scenario | Observation and raw evidence |
| --- | --- |
| Red, ci variant | registry-provenance-red.log, fixtures/red-ci. At 2e4f0501 the pre-up hook's same-name `k3d.cluster`-labelled container, publishing the assigned registry port, was receipted (`squatterReceipted: true`). k3d create then failed on the name (`COMMAND_FAILED`). Cleanup kept the named cache (red-ci-retained-status.json). The fixture owner removed it after checking receipt creation time and labels (red-ci-owner-resolution.log). |
| Red, earlier attempt | registry-provenance-red-unpublished.log. A squatter that did not publish the port was refused by publication validation (`PORT_BIND_CONFLICT`), not by provenance. It is kept, but it is not the distinguishing red. |
| Red, timed-out hook at down | registry-hook-timeout-red.log, fixtures/red-timeout (6.stdout). After the real 300 s pre-up hook timeout, `down --delete-cluster` at 2e4f0501 exited 0. It had receipted the squatter and deleted it by ID: launch `owned-container-delete` exit 0 targeting c1cd1c61825f…, then `docker inspect` failed. This is the predicted deletion; the container was a recorded fixture. red-timeout-cleanup.log retires that project. |
| Green, both variants | registry-provenance-green.log, fixtures/green. At 492be5fe, ci and `down --delete-cluster` refuse `NAME_CONFLICT`; the timed-out hook case refuses at down. The squatter's full `docker inspect` is unchanged, it is never receipted, and claims are kept. After the fixture owner removes it by exact ID, public `down --delete-cluster --clean` releases all claims. |
| Gates | gates.log: 147 tests / 397 assertions, typecheck (including the harness), lint, knip, zero clones and build pass. The source commit ran normal pre-commit hooks. |
| Full suite | all-qualified.log, fixtures/all-qualified: `--suite all` at 492be5fe with the verified legacy artifacts records 534 commands, including expected refusal and fault probes, and 45 scenario lines. It ends `{"result":"pass","suite":"all"}`. All 41 commands after the result line exit 0, including 35 public cleanup calls. The existing legacy, live, backend (real k3d cluster/registry receipts from a successful create), volumes, lifecycle and producers cases (1023-record cleanup, port-squatter k3d failure that records the registry, IPAM network failure) pass alongside registry-provenance. |
| Copied full example | example/ and launchers/example-rehearsal.ts.txt: before/after provenance binds a885d6a / 492be5fe with clean runtime source. `ci` exits 0 and web/API `/health` return ok through owned port-forwards. Ordinary `down` removes the Compose parents and keeps both Kubernetes deployments ready. `down --delete-cluster --clean` removes the exact k3d parents and their anonymous mounts, but refuses `CLEANUP_REQUIRED` while the named cache and claims remain. The fixture owner removes the cache after checking its creation time and labels, and then `down --clean` retires generation 0 with no claims. The two nonzero codes among 22 commands are the expected absent-Compose inspect and that refusal. Expired synthetic k3d tokens in two node-inspect captures are masked (redactions.json). |

## Limits

- Notes 1-4 of round 7 are unchanged (see review-response-r7.md).
- No guest was run for this refusal-only delta.
- No native Mac run, and no hosted CI.
- A squatter is refused at the first capture that sees it. The ci variant
  therefore refuses during the hook, before `ensureCluster`. That is the same
  outcome, NAME_CONFLICT with nothing deleted, as at 6c942863.
