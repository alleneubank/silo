green

| Scenario | Result | Observed | Capture |
| --- | --- | --- | --- |
| Allocate fixture with pre-up sentinel, no k3d or Docker workload | pass | Public env allocated generation 1 and TILT_PORT 49152; synthetic local Tilt resource only. | 01-allocate.log, 05-fixture-and-docs.log |
| Supervisor startup refusal in normal text | pass | CI exited 1; message included supervisor exit 1, actual mise “No version is set for shim: janitor”, and `mise use -g github:alleneubank/janitor@0.3.1`. Hook did not run. | 02-refusal.log |
| Repeat startup refusal with --json | pass | Second attempt exited 1 with schemaVersion 1, LAUNCH_FAILED, launchId, generation 1, supervisorExitCode 1 and same actionable diagnostic. Hook still absent. | 02-refusal.log |
| Preserve ownership and file bytes after both refusals | pass | Same project ID, generation, allocation, 13 claims and port; phase reserved; no resources. Two planned hook launch receipts retained. Both generated file hashes exactly matched baseline. | 01-allocate.log, 02-refusal.log |
| Restore PATH and complete real Tilt CI | pass | Native Janitor reported 0.3.1. CI exited 0, status recorded successful real tilt-ci command with --web-mode=prod and --timeout 20s; hook sentinel appeared exactly once with `hook-ran`. | 03-restored-ci.log |
| Explicit public down --clean | pass | Exited 0, phase unallocated, empty claims/resources/launches/files/sinks/completions. Env and lock snapshots absent, user-authored fixture files retained until my final removal. | 04-clean-and-nearby.log, 06-final-cleanup.log |
| Repeated and invalid nearby actions | pass | Repeating down --clean succeeded with changed:false and “Nothing to stop”. CI with nonexistent profile exited 1 PROFILE_MISSING, leaving unallocated state unchanged. | 04-clean-and-nearby.log |
| End processes and remove own fixture | pass | Recorded supervisor/leader PIDs absent; bounded detached outer groups exited 0 and were absent. Public cleanup completed; removed remaining own fixture and its directory. | resources.log, 04-clean-and-nearby.log, 06-final-cleanup.log |

No functional finding in the assigned scenarios. Commands and fixture are recorded in commands.md; outputs above are unedited captures.

What worked: The diagnostic contains the actual supervisor failure and a concrete remedy, so I did not have to infer whether Tilt or the hook was broken. Troubleshooting explains version-manager shims and checking janitor from the project directory. Recovery needed only restored PATH, the same CI command, and explicit cleanup. Failed attempts preserved ownership without blocking a legitimate subsequent run.

Papercuts: The machine-readable message contains escaped ANSI color sequences inherited from mise. It remains valid JSON and understandable, but a consumer presenting message directly may show formatting debris. This would not make me give up. During successful CI no synthetic resource output appeared in Silo's captured terminal output; success and the real Tilt command were observable through its zero exit and status completion receipt.

Hesitations: Before reading troubleshooting, “Launch gate exited before its handshake” by itself would not tell me what to fix. The attached Janitor/mise detail removes that hesitation. Planned failed-launch receipts remain visible in status until cleanup, but their null PIDs plus reserved state made sense with the docs' retained-ownership explanation.

Looks: CLI text only; no visual surface. Mise inserts ANSI color codes in error text and escaped codes inside JSON. No clipped or unreadable output observed.

Trust: I would rely on this behavior for this local synthetic workload: I saw the forbidden hook stay unexecuted twice, the same claims and file bytes survive, the real operation succeed after repairing PATH, and explicit cleanup release everything. This run does not establish broader Docker/k3d or adversarial-hook safety.

First fix: If polishing one thing, normalize ANSI escapes out of the structured error message while preserving the supervisor's actual diagnostic and exit status.

Build: supplied /mnt/dist/cli.js (host /home/ae/Work/0xbigboss/alleneubank/boss-mobile-release-silo-impl/dist/cli.js), source head 80f4974d0f9e2db056ceb7ba771fe12597d5afad (supplied identity; did not inspect source), SHA-256 independently checked 9965e0b2fde3397eadc7c507ae2e7afafd7f0a4b3accfdc84411fba803185894. Ran through assigned public/sandbox on 2026-11-04, disposable filesystem account view with native Janitor/Tilt and read-only product checkout. No build/source edits, commits or Git network.

Not tried: k3d, Kubernetes resources, Docker object creation/deletion, live account store, long-running up, Ctrl+C/interruption, concurrent invocations, live user work, hooks with external effects, GITHUB_ENV exports, or platform variants. No waivers added. Native shared Docker objects were not mutated. Scratch captures intentionally retained at the requested guest destination.
