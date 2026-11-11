green

| Scenario | Result | Observed | Capture |
| --- | --- | --- | --- |
| Supplied Redis fixture with 1023 completed launches | pass | Wrote/read a synthetic Redis sentinel. Public `down --clean` succeeded, deleted the exact container/network and its anonymous `/data` volume, removed snapshots and released all claims. Repeat clean returned `changed:false`. | `logs/capacity-summary.json`, `logs/capacity-sentinel-get.out`, `logs/capacity-clean.out`, `logs/capacity-clean-repeat.out`, `logs/exact-absence-audit.jsonl`, `logs/capacity-files-after.out` |
| Fresh Compose `ci → down → ci`, unchanged configuration | pass | Both CI runs succeeded in project `28589099-8041-402e-bb38-f0f3426ad316`, generation 1. Old container/network receipts became `deleted:true`; fresh immutable IDs under the same names were `deleted:false`. Final public clean removed both generations of physical objects/data; repeat clean was a no-op. | `logs/restart-history-summary.json`, `logs/restart-ci-1-status.json`, `logs/restart-ci-2-status.json`, `logs/restart-clean.out`, `logs/restart-clean-repeat.out`, `logs/exact-absence-audit.jsonl` |
| Real k3d creation failure from an allocated API-port squatter | pass | Own HTTP listener bound returned API port 49155. Real k3d failed with `PORT_BIND_CONFLICT`; listener still answered afterward. Stopped only its recorded, validated process group. Public `down --delete-cluster` removed exact recorded containers/network and four anonymous data volumes, retaining its named image cache and 21 claims. Public clean refused while cache remained. After separate owner verification of cache Name/CreatedAt/project/generation/no users and owner removal, final public clean released claims; repeat was a no-op. | `logs/k3d-ci-port-failure.out`, `logs/listener-after-failure.out`, `logs/k3d-summary.json`, `logs/k3d-cache-owner-verified.json`, `logs/k3d-exact-absence.jsonl`, `logs/k3d-clean-timewait-retry.out`, `logs/k3d-clean-timewait-repeat.out`, `logs/k3d-final.json` |
| Real Docker network-create overlap failure | pass | Independently created/recorded blocker network `4b1ec0cb5e3687c825d194ef0f87446cda99dd1a4f326bdba7da79aec8a026bd` on `192.0.2.0/28`. Transparent wrapper added that subnet to real Docker network create. Docker returned its real IPAM overlap error twice, on successive fresh allocations. Public clean retired each failed creation and repeat clean was a no-op. The exact blocker survived both cleanups, then its owner separately verified identity/labels/no users and removed it by its full ID. | `logs/network-wrapper-argv.txt`, `logs/network-ci-overlap-1.out`, `logs/network-ci-overlap-2.out`, `logs/network-blocker-preserved.json`, `logs/network-blocker-preserved-2.json`, `logs/network-blocker-owner-verified.json`, `logs/network-blocker-owner-removal.out` |

Other observed behavior:

- A live Compose `up` was cleaned successfully from a separate invocation. A second live `up` received SIGINT through its independently recorded and validated process group. Immediate clean returned `BUSY` twice while the original operation was still finishing; status then showed a terminal/reconciled launch and retry clean succeeded. Captures: `logs/ctrlc-clean.out`, `logs/ctrlc-clean-repeat.out`, `logs/ctrlc-settled-status.json`, `logs/ctrlc-clean-retry.out`, `logs/ctrlc-clean-final-repeat.out`.
- Final k3d cleanup initially refused port 49152 after all fixture objects and the squatter were gone. Two native TCP connections on that port were in TIME-WAIT, with no TCP listener or UDP socket. Several retries conservatively retained claims; cleanup succeeded after those connections expired. No process was stopped to clear that port. The guest fixture never published APP_PORT 49152; its Redis services used only container-local port 6379. Ownership of the expired native connections was not attributed. Captures: `logs/blocked-clean-tcp-all.txt`, `logs/blocked-clean-udp-all.txt`, `logs/k3d-clean-final.out`, `logs/k3d-clean-port-retry.out`, `logs/k3d-clean-timewait-retry.out`.

What worked: Public docs accurately described failed-create reconciliation, same-generation restart, historical receipts, and the named-cache ownership boundary. Stable JSON error codes made recovery clear. The unrelated blocker and the squatting listener survived product cleanup.

Papercuts: A minimal config with only `TILT_HOST` under `[hosts]` returned the useful `hosts must include APP_HOST` error; adding APP_HOST resolved it before allocation. The named-cache owner step is substantial operational work, but the error states the boundary clearly. TIME-WAIT cleanup refusal gives no suggestion to wait and retry, so a user could mistake a temporary socket state for a persistent process. Immediate cleanup after Ctrl+C can need a status-and-retry cycle. None prevented completion.

Hesitations: The plain post-delete text says resources and claims are retained; the JSON was needed to distinguish deleted container/network history from the active cache. The documented `deleted` field was sufficient once read.

Looks: CLI-only run. Human stderr is readable. JSON embeds long k3d diagnostics including escaped ANSI color sequences; the stable error code and first sentence remain usable. No browser or visual UI was evaluated.

Trust: The exercised cleanup paths preserved independently owned objects and retained claims whenever proof was incomplete. These results support using the tested paths for disposable development data. They do not establish production-data safety or prove behavior of arbitrary hooks/Tiltfiles.

First fix: Explain that a port cleanup refusal can be temporary and suggest retrying after status/port inspection; retain the conservative refusal.

Resource accounting and boundaries:

- Only the supplied view was used. No source, diff, author sessions, earlier guest verdicts, source tests, or author harness were read. Product learning used built CLI help/docs, the installed product skill, and generated public state. Parent coordination messages included suite/port status, but no implementation evidence was inspected.
- All own long-running drivers/listeners/observers were launched with `setsid timeout`, and their returned group handles were saved immediately under `pids/`, the own ledger, and the shared ledger. An initial shell builtin `kill` rejected its `--` syntax without sending a signal; public down cleaned that run. The subsequent SIGINT used `/usr/bin/kill` after UID/PGID/command validation.
- Live event observers recorded owned container creation IDs and immediate mount inspection, plus explicit-name network/cache events. The named cache CreatedAt/labels were independently inspected shortly after creation rather than atomically in the create event. The transient k3d tools object did not yield an independently captured immutable ID: a later exact-name Docker-events query returned empty, so that query is not claimed as historical absence proof. Current fixture-namespace enumeration and exact tools-name inspect show no remaining container. All recorded receipt/event IDs and mount handles are independently absent.
- All saved driver/observer/listener handles and recorded Silo/observer child PIDs were absent at exit: `logs/final-process-audit.jsonl`, `logs/final-child-process-audit.jsonl`. Exact Docker evidence: `logs/all-event-handles-absence.jsonl`, `logs/exact-absence-audit.jsonl`, `logs/k3d-exact-absence.jsonl`, `logs/network-blocker-absence.out`, `logs/k3d-final-namespace-containers.jsonl`.
- All four fixture allocations are retired. The guest left no live stack/listener/observer or known data object. Scratch/captures remain for parent archival as requested. No global Kubernetes, credential/system changes, gh, playwriter, project-wide teardown, prune, or selector deletion was used.

Port attribution (UTC, from captured supervisor identities and completion facts):

| Run | Ports | Start | Completion |
| --- | --- | --- | --- |
| Supplied capacity CI | APP 61231; Tilt 61232 | 05:01:17 | 05:01:22.208 |
| Guest restart CI 1 | APP 49152 unbound; Tilt 49153 | 05:03:38 | 05:03:45.156 |
| Guest restart CI 2 | APP 49152 unbound; Tilt 49153 | 05:03:55 | 05:03:58.384 |
| Guest live up / public down | APP 49152 unbound; Tilt 49153 | 05:05:11 | 05:05:27.666 |
| Guest live up / SIGINT | APP 49152 unbound; Tilt 49153 | 05:05:40 | 05:05:52.489 |
| Guest native squatter | 127.0.0.1:49155 | Around 05:06:23 | Stopped around 05:08:05 |

Captures: `logs/port-timeline.jsonl`, `logs/live-up-completions.jsonl`, `logs/listener-ready.json`, `logs/listener-stop-identity.txt`.

Build: supplied read-only `/opt/dist/cli.js`, version 0.9.0, SHA256 `4601b51c88facb43be2f5e8e885db365ef87172f96eb452ffa49068cfd278c3f`; supplied source head `73114d2d4a47b55dcc31350c8bfcef3ab0587a0e`. Ran through the supplied guest view against native shared onyx Docker engine `114f4194-e27d-4d0b-82fc-201ecd0e9997` using only synthetic disposable data. No successful Kubernetes workload/registry-advertisement path, arbitrary inherited/shared mounts, corrupted store, engine switch, production data, or browser UI was tried.
