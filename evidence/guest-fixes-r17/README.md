# R17 evidence

Runtime source: 6c250b44afebf621aec6722db792b442dfbcf88a. Fixture-only sources: 3c12074ad9ef461f1c78dd6641718a9bb6373266 and0cc8ffa. Host aem5, macOS arm64, Bun 1.4.4, Janitor 0.3.1. Retained public artifact digests are in artifact-sha256.txt; binaries are in dist/. All four standalone targets were built sequentially at nice 15.

| Scenario | Before | Observed after | Evidence |
| --- | --- | --- | --- |
| Every bundled doc topic outside the source tree | Both distributions failed topic lookup | All 13 topics plus alias print on public JS/native | docs-red.log, public-docs-final.log, public-docs-results.json |
| CI INT/TERM | Empty stdout; stored granted launch remained unexplained | One schemaVersion-1 INTERRUPTED result, exit130/143; separate completed/terminated observation and retained claims | ci-json-red.log, ci-status-red.log, native-final/, verdicts/guest-461c759.md |
| Startup identity under delay/load | Base misses launch at fixed2s ps limit | Same unconditional delayed real ps plus four owned CPU workers succeeds | ps-old-comparison.log, ps-new-comparison.log, ps-load-comparison.json |
| Parent ps delay longer than10s | Old gate missed launch | 11s per ps succeeds within startup observations | focused-green.log, owned-command tests |
| Identity expiry/refusal | Leader checks required | Expiry leaves planned/no marker; nonleader refuses | startup-refusals.log |
| Checkpoint near observation deadline | Separate grant wait could expire | Real lock across checkpoint, marker at31558ms, durable exited result | checkpoint-result.json, checkpoint-rehearsal-r2.log |
| Connected UDP | Four apparent failures coincided with real TCP listeners | No production classifier change; final fixture has120 observations/0 failures under load | udp-load-baseline-targets.json, udp-load-wildcard-summary.json, udp-load-wildcard-targets.jsonl |
| Large JSON/backpressure | Native EAGAIN truncates valid project JSON | JS/native15.35MB complete, closed reader exits1, stdout stall exits1 by30.7s | diagnose-write.log, large-output-final.json, fifo-stall-result.json |
| Both output channels blocked | Sync diagnostic prevents exit beyond40s | Native30.884s and JS30.508s exit1 | dual-fifo-before.json, dual-fifo-after.json, dual-fifo-after-js.json |
| Human interruption guidance | Potential dropped async guidance | Both signals, both distributions preserve guidance and130/143 | human-signals/ and human-signals.log |

A prior full pre-push suite passed243 tests at969a3a9 (push-code-pinned.log). The later final-prepush-gates.log also records243/0, without an exact-head marker. The final fixture refinement has3 focused native passes (udp-fixture-complete.log) and the load record above. The delivery push runs the full normal hooks again; its receipt is in the lane handoff's final-push.log.

Diagnostic builds redirect account lookup at build time to a private account directory. They do not qualify the unmodified real-account journal path. Real Tilt/Docker were used in author and guest runs; permanent CLI tests use shell stand-ins at those vendor boundaries. Guest captures and one-off rehearsal sources are retained in /Users/allen/.handoffs/boss-mobile-release/silo-guest-fixes/. Raw full-host socket listings are retained there privately; only target socket rows are versioned.

A final-head rehearsal correctly refused cleanup while declared port49153 had a listener. The holder was not captured at that instant. A later complete listing found no row and product cleanup succeeded; native-final/ used a dedicated configured port. No foreign listener was signalled. Earlier failed probes and hook attempts remain named as red/diagnostic evidence, not green gates.

Not qualified: real-account public lifecycle; Linux execution and live proc tables; Darwin-x64/Rosetta execution; pre-existing Docker timestamp/volume and cutover qualifications; held-open grant input/cancellation before a valid executor grant. No waiver was added.

Head-bound run at3c12074 recorded242/243 with a capacity-fixture terminal-proof race. The corrected fixture awaits its existing owned-group drain; capacity-drain-fix.log passes that case. Final delivery must pass normal full hooks; no assertion was weakened or check bypassed.

Fatal diagnostic review conditions were met: dual-fifo-after.json and dual-fifo-after-js.json pass for native/JS; human-signals/ records both signals and both distributions with the reconciliation guidance retained.
