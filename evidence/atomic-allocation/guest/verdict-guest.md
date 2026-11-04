green

| Scenario | Result | Observed | Capture |
| --- | --- | --- | --- |
| New env refusal, owner-driven old stop/recreate, preserve peer | pass | New `env guest-a` refused with `LEGACY_STATE`, naming only `/tmp/guest/old`. Announced guest-domain cutover; published 0.9.0 `down --clean` stopped the owned old fixture. No old client ran afterward. New `env guest-old` reserved a new project/generation. Peer sentinel checksum stayed identical. | [refusal](01-legacy-refusal.txt), [old down](02-old-down.txt), [new allocation](03-old-recreated.txt), [peer](56-peer-preserved.txt) |
| Concurrent profile variants, real Tilt API, preserve A, refuse live force, stopped switch | pass | A base used `guest-a`, APP 49152 / Tilt 49153. B alternative used `guest-b`, APP 48143 / Tilt 49154. Both APIs listed their own resource. B cleanup left A's same resource Ready with runtime `ok`. A's live alternative `--force` refused twice. `down`, then `up guest-a --profile alternative --force`, created generation 2, APP 48143 / Tilt 49152, with a healthy API. | [A ownership](06-a-live-status.json), [B ownership](07-b-live-status.json), [A API](20-a-real-api.txt), [B API](21-b-real-api.txt), [A after B cleanup](23-a-api-preserved.json), [force 1](10-live-force-1.txt), [force 2](11-live-force-2.txt), [switch](25-a-stopped-switch.txt), [new ownership](26-a-after-switch.json), [new API](27-a-after-switch-api.json) |
| Real k3d CI, retained clean refusal, explicit owned recovery, peers intact | pass | `ci guest-retained --timeout 120s` exited 0. Ownership recorded real server/load-balancer containers, network and volume, and a successful `tilt-ci` launch. k3d reported 1/1 server; kubectl reported its k3s control plane Ready. `down --clean` refused twice with `CLEANUP_REQUIRED` and kept owned resources. Explicit `down --delete-cluster --clean` succeeded; k3d listing became empty and ownership became unallocated with empty claims/resources. Peer checksum remained identical. | [CI log](28-retained-ci.txt), [successful launch/receipts](31-retained-creating-status.json), [k3d live](32-k3d-live-list.txt), [node Ready](35-real-k3d-nodes.txt), [refusal 1](33-retained-clean-refusal-1.txt), [refusal 2](36-retained-clean-refusal-repeat.txt), [cleanup](39-retained-explicit-clean.txt), [empty listing](43-k3d-after-clean.txt), [unallocated](44-retained-after-clean.json), [peer](56-peer-preserved.txt) |

Other observed behavior:

- Repeating matching live `up guest-a` returned success and reused supervisor 427979, generation 1: [capture](14-a-repeat-up.txt).
- Another root requesting reserved `guest-a` received `NAME_CONFLICT` naming `/tmp/guest/a`, twice: [first](41-name-conflict-1.txt), [second](42-name-conflict-2.txt).
- Unknown profile and misspelled `--profil` were rejected twice with clear errors: [profile first](29-unknown-profile-1.txt), [profile second](30-unknown-profile-2.txt), [option first](45-typo-option-1.txt), [option second](46-typo-option-2.txt).
- SIGINT to the exact verified owned A process group stopped the CLI and Tilt successfully. Status became stopped with no operation/problem. Immediate restart refused twice, explicitly requesting `down` reconciliation; `down` followed by `up` restored Ready/runtime `ok`. [Process proof](37-a-pre-interrupt-process.txt), [stopped state](40-a-post-interrupt-status.json), [restart first](47-a-restart-after-interrupt.txt), [restart second](50-a-restart-after-interrupt-repeat.txt), [recovery](51-a-interrupt-reconcile.txt), [healthy restart](53-reconciled-restart-api.json).
- A simultaneous second retained cleanup reported `BUSY` while the first cleanup owned the operation. The next sequential attempt gave the intended retained-resource refusal: [busy](34-retained-clean-refusal-2.txt), [sequential refusal](36-retained-clean-refusal-repeat.txt).

No reproducible product failure was observed.

**What worked:** Ownership errors named the owner and gave useful next actions. Live force refused without harming the running resource. The stopped switch, retained cluster refusal and explicit cleanup matched the docs. Real backend objects and actual Tilt health were observable independently of CLI process liveness.

**Papercuts:** The host's normal Tilt command could not see the disposable account's private API discovery config. Host `tilt get` failed, and unauthenticated HTTP did not prove API health. The supplied `guest-command` account wrapper resolved this. This was rehearsal setup friction, not attributed to the product. Startup also printed repeated generated-env/lock messages; they were noisy but did not block use.

**Hesitations:** After Ctrl+C, `status` said `stopped` with a null problem, but immediate `up` still required `down`. The restart error supplied the right recovery and it worked. A clearer reconciliation hint in status or the shutdown message would remove that pause.

**Looks:** CLI only; captured errors and tabular resource output remained readable. Browser layout and responsive/dark appearances were not reviewed.

**Trust:** These scenarios support relying on owner isolation for disposable development work. They do not establish safety for valuable data or every failure mode. No peer cleanup, store editing, credential changes, source inspection, or author-scripted rehearsal was used.

**First fix:** Make the Ctrl+C completion or stopped status explicitly say when `down` reconciliation is still required before restart.

Observed command entry points were `guest-silo <project> <silo argv>` and `guest-old09 <project> <silo argv>` under `/home/ae/Work/0xbigboss/alleneubank/boss-mobile-release-silo-impl-tmp/`. Native API checks used `guest-command <project> /bin/sh -c 'set -a; . ./.localnet.env; set +a; tilt get ... --port "$TILT_PORT"'`. [resources.txt](resources.txt) records actual launched commands, PIDs and PGIDs. Every long-running lifecycle command ran under `setsid --wait`. Only A's exact verified owned group received an external signal.

Cleanup completed: all four owned projects were unallocated with empty claims/resources; every recorded wrapper PID was absent at the final exact-PID inspection. [A](57-a-final-status.json), [B](58-b-final-status.json), [old](59-old-final-status.json), [retained](44-retained-after-clean.json), [processes](60-started-processes-final.txt). The peer fixture was never stopped, cleaned or edited.

Build: immutable packaged CLI at `guest-product/dist/cli.js`; supplied source head `e4e77aa978cca4aa8210b0695123a7b8e7fa402d`; verified SHA256 `6e5e0848141659a58a316071623bc63eb05716cc8f16d68bb4bcdb8eb325b8d0` ([digest](61-build.sha256)). Ran on Linux in the supplied disposable account filesystem view with the real shared Docker engine, Bun 1.4.4, Janitor 0.3.1, and Tilt v0.37.8-fork.20261009.g753c01455. The supplied head was not independently inspected, as the guest charter prohibited source/history access.

Not tried: browser UI, application HTTP serving (fixtures provide only local Tilt resources), Compose workload deletion, registry advertising, valuable data recovery, actual concurrent legacy-client cutover, machine/power loss, engine replacement/unavailability, macOS, or physical devices. This was a guest usability/behavior run, not a security review. No waivers were added.
