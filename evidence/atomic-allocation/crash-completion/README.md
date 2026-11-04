# Owner-crash completion observation

Rehearsal correction: `cf0b2b21117a4ddf1dd60f77313dd1803401e4bb`.
Runtime source remains `80f4974d0f9e2db056ceb7ba771fe12597d5afad`;
built CLI SHA-256 remains
`9965e0b2fde3397eadc7c507ae2e7afafd7f0a4b3accfdc84411fba803185894`.
Author: silo-impl on ae-dev, 2026-11-04. Later evidence-only commits reuse
these unchanged product and rehearsal inputs. This is verified local work,
not a merge, release or completed macOS qualification.

## Finding and contract

The native macOS run at fd710d9 killed the owning Silo CLI, not Janitor.
After the HTTP listener drained, command 78 observed the same generation
still `running`, the Tilt launch still `granted`, and no completion. The
same launch's completion was present in the final retained database, with
exit 0 and completedAt `2026-11-04T22:02:21.368Z`.
[Original status](mac/78-status.json), [later completion](mac/late-completion.json),
and [selected original states](mac/crash-and-clean-summary.jsonl) are copied
verbatim from the coordinator-supplied silo-macos/evidence-r3/addendum-2.
The original run failed and is not relabelled a pass. The complete report
remains `~/.handoffs/boss-mobile-release/silo-macos/report-3.md`.

The [lifecycle contract](../../../SPEC.md#lifecycle-authority) gives the executor
authority only to append its immutable completion; the operation owner folds
that fact into the launch journal. Status is read-only. In
`src/core/executor.ts`, the executor awaits `child.exited` before calling
`recordExecutorCompletion`. That method then checks legacy state and commits
the fact to SQLite. `ProjectOperation.inspect` reads a transaction snapshot;
it neither waits for nor applies facts. `applyCompletions` runs under the
next owner operation. An application can close its listener before its tool
finishes and before this commit. Therefore listener drain does not imply a
durable completion. A later status can observe the fact while lifecycle/launch
still read `running` / `granted`; owner reconciliation is a separate step.

The defect was the probe's synchronization condition, not demonstrated loss
of a completion. The probe now waits with the existing 30-second deadline
for the exact crashed launch's fact. It checks project, generation and original
claims during that wait, checks the completed leader/group and started flag,
and rechecks B's exact logical state and HTTP identity before owner cleanup.
Every old assertion remains, including nonempty completions. A missing exact
fact still fails; an unrelated completion cannot satisfy the wait. No product
code, schema, CLI contract or configured timeout changed. No waiver was added.

## Distinguishing observations

| Surface / input | Observation | Record |
| --- | --- | --- |
| Original fd710d9 live suite, Linux, no instrumentation | Pass and successful cleanup. The natural Mac timing was not reproduced on Linux. | [live-before.log](live-before.log) |
| Built public CLI, actual Janitor/Tilt, test-only hold at completion INSERT | While A's tool had exited and its listener was absent, fresh status showed `running`, granted launch, unchanged claims and no exact fact. Releasing the insert made that same fact visible; public clean succeeded and B stayed identical. | [timing-probe2.log](timing-probe2.log) |
| Corrected real live suite, same scheduling hold | The probe stayed in its wait across commands 26 and 27 with no completion. After release, command 28 observed the exact fact; all live scenarios and public cleanup passed. | [controller](controlled-live.log), [suite](controlled-live-suite.log), [states](controlled-status/) |
| Corrected all-suite, no preload, at cf0b2b2 | All-suite pass; 177 recorded commands; exact crash completion, legacy/cutover, squatter, file/launch crashes, aliases, retained k3d/exact deletion, role removal and engine refusal passed; all final cleanup commands exited zero. | [allocation-final.log](allocation-final.log), [resources](allocation-resources.txt), [head](rehearsal-head.txt) |
| Full required checks at cf0b2b2 | Typecheck, lint, knip, jscpd (zero clones), 130 tests / 335 assertions / zero failures, build pass. | [gates](gates-final.log), [head](gates-head.txt) |
| Commit hooks | Normal lint/format/typecheck hooks pass; no bypass. | [commit-fix.log](commit-fix.log) |
| Actual local-bare push at cf0b2b2 | Normal pre-push hooks pass: 130 tests, knip, jscpd. The owned local repository received the exact head; no network. | [push-fix.log](push-fix.log), [received ref](local-bare-ref.txt) |
| Exact teardown audit | 28 disposable project rows, all generation 0 and no operation; zero claims or undeleted resources. 408 recorded PID and same-number group handles absent; 16 recorded object/mount checks absent, including six captured volume handles. No cleanup signal issued by the audit. | [audit.json](audit.json) |

The timing hold is a one-off scheduling experiment. It replaces only the
instant at which the real executor inserts its completion, for at most four
seconds, and releases after the observed condition. It does not qualify a
native delayed-write implementation or general SQLite fault recovery. It is
not in the shipped CLI or a permanent test. The instrumented run records
actual public status reads, not an inferred result from listener shutdown.
The uninstrumented all-suite separately drives the native completion path.
Exact probe sources are retained as text in [probes](probes/).

The [fresh claim check](verdict-claims.md) supports the local findings and
verification claims; it leaves final proposal publication and scratch/build
removal to closeout. It is separate from the product specialist review.

## Environment and boundaries

[Environment](environment.txt): Linux x86_64/ext4, Bun 1.4.4, Janitor 0.3.1,
Tilt 0.37.8-fork.20261009.g753c01455, Docker client/server 29.9.2,
engine `86f30b48-26b3-4a5b-8f5c-8c97fe963463`, k3d 5.9.0 / k3s 1.35.5-k3s1.
The [sandbox invocation](probes/sandbox.sh.txt) binds only an owned disposable
home over the native account home, scratch over /tmp, and this checkout at
/mnt. Native account lookup, real tools and the shared native Docker engine
remain in use; the real account's Silo store is not accessed. The published
old artifacts were copied from the supplied Mac evidence and both prescribed
[digests](legacy-digests.txt) matched. No Git network operation ran.

Noticed: the first standalone timing fixture omitted APP_HOST and failed with
INVALID_CONFIG before allocating; both public cleanup calls were no-ops.
Its [failure](timing-probe.log) is retained. The corrected fixture's record is
separate. The original Linux suite passed; it is not a red control for the
Mac schedule. Dependency and hook timestamps show pre-existing coordinator
installations at 05:50Z; the frozen install changed nothing. They are preserved
at teardown. Only this run's dist and addendum4 scratch are teardown targets;
the final cleanup receipt belongs in the coordinator handoff.

The matching specialist round 2 is
[approve with conditions at fd710d9](verdict-specialist-r2.md), with no blocking
or should-fix findings. The runtime it reviewed is unchanged; this probe-only
correction does not initiate product specialist round 3. The coordinator
still owns review/release decisions and native macOS qualification. The Mac
run's retained [native preflight](mac/06-hook-probe.log),
[130 tests](mac/02-tests.log) and [real local-bare hook push](mac/09-hook-push.log)
passed before this later assertion failure. Its
[driver excerpt](mac/native-driver-excerpt.sh.txt) and
[coordinator-supplied shim-resolution report](mac/reported-shim-resolution.txt)
record the PATH and shell-function setup; the historical pre-push cause was
not independently attributed by this Linux lane.

Not checked: corrected native Mac/APFS case modes, Intel/Apple Silicon
artifacts, new hosted CI, final versioned 1.0.0 artifacts, actual host cutover,
lost executor facts or every instruction-level crash point. Earlier guest,
full-example and allocation evidence is reused only for unchanged inputs.
There is no new product flow or guest verdict for this harness-only repair.
The existing high-risk plan approval, trusted-local-user threat model and
release holds remain as recorded in the [parent index](../README.md).
