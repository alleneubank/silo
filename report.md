done

Addendum 4 is verified locally at rehearsal correction
`cf0b2b21117a4ddf1dd60f77313dd1803401e4bb`; subsequent records-only commits
leave its inputs unchanged. The final proposal SHA and coordinator operations
belong in `~/.handoffs/boss-mobile-release/silo-impl/pr-ops.md` at closeout.
PR [#58](https://github.com/alleneubank/silo/pull/58) remains draft. No Git
network operation, merge, release or actual host cutover ran in this lane.

## Cause and correction

The Mac failure is a probe synchronization defect. Listener shutdown does not
prove that Tilt has exited or that its executor has committed the completion
fact. The executor publishes after child exit; status is a read-only database
snapshot; a later owner operation applies the fact. Status may therefore have
no completion after listener drain, and may retain `running` / `granted` even
after a completion is visible. A later reconcile consumes the executor's fact;
it does not manufacture one from an absent listener.

The Mac's command-78 empty completion and later same-launch exit-0 fact are
retained verbatim. The original live suite passed naturally on Linux. A
controlled Linux scheduling hold at the real completion INSERT demonstrated
the allowed intermediate status, with unchanged claims; release published
the same launch's fact, public cleanup succeeded, and B stayed unchanged.

The corrected rehearsal waits with the existing 30-second deadline for the
exact crashed launch, checks original project/generation/claims during the
wait, validates completion leader/group and started flag, and rechecks B's
logical state and HTTP identity. Every old assertion remains. Two missing-fact
reads were observed during the controlled corrected-live run before it passed.
No product code, CLI contract, schema, configured timeout or assertion was
weakened. Runtime source remains `80f4974d0f9e2db056ceb7ba771fe12597d5afad`;
CLI SHA-256 remains
`9965e0b2fde3397eadc7c507ae2e7afafd7f0a4b3accfdc84411fba803185894`.
The Mac runbook also records native Bun/Janitor PATH selection and the inherited
Bun-function shadowing papercut observed by the Mac lane.

## Evidence and checks

Full record: [crash-completion evidence](evidence/atomic-allocation/crash-completion/README.md).

- At cf0b2b2, typecheck, lint, knip, jscpd (zero clones), 130 Bun tests /
  335 assertions / zero failures, build and normal commit hooks pass.
- A real push of cf0b2b2 to an explicitly owned local bare repository passes
  all normal pre-push hooks; its exact received ref is recorded.
- Author drove the full uninstrumented public Linux CLI rehearsal at cf0b2b2
  using real native Janitor/Tilt/Docker/k3d and a disposable account filesystem
  view. All-suite pass, 177 recorded commands and successful final fixture
  cleanup. The exact crash completion, legacy/cutover, concurrent A/B, squatter,
  export/grant crash, path alias, failed teardown, k3d retention/exact deletion,
  child-volume removal, role removal and engine-refusal scenarios passed.
- Scoped audit: 28 disposable projects, every generation 0, no operation,
  zero claims/undeleted resources, 408 recorded PID/same-number-group handles
  absent, 16 object/mount checks absent including six captured volumes.
  Historical unattributable volumes, shared caches and peer resources remain
  untouched. The real account store was not accessed.

The controlled scheduling hold is test-only instrumentation and does not
qualify native delayed SQLite writes; the full uninstrumented rehearsal covers
the actual completion path. The first standalone timing fixture omitted
APP_HOST and failed before allocation; its original failure and both no-op
cleanups remain beside the corrected run. No failure is called pre-existing
or dismissed as flaky.

## Reviews and remaining qualification

The coordinator-supplied [round-2 specialist verdict](evidence/atomic-allocation/crash-completion/verdict-specialist-r2.md)
is **approve with conditions** at fd710d9, with no blocking or should-fix
findings. Its reviewed runtime is unchanged. This harness-only correction
does not initiate product specialist round 3. Existing guest/full-example
evidence is reused only for unchanged product inputs; no new guest verdict
is claimed. The [fresh claim check](evidence/atomic-allocation/crash-completion/verdict-claims.md)
supports the local findings, with final publication and cleanup left to closeout.

The native Mac run passed its native dependency preflight, 130 tests and real
local-bare push before the later completion assertion failed. This Linux lane
does not independently attribute the historical Mac pre-push cause. Corrected
native Mac/APFS case modes and Intel/Apple Silicon artifacts remain pending,
as do new hosted CI, final versioned 1.0.0 artifact qualification, actual host
cutover and explicit merge/release decisions. Lost facts, arbitrary crash
points and the other unsupported neighbors in the retained verdict remain
unqualified. No waiver added.

## Release and handoff

Intended semver remains **1.0.0** via the existing major changeset;
package/plugin remain 0.9.0. The coordinator applies only the proposal branch
push and the prepared PR body/review response. Keep PR #58 draft until native
qualification and the matching review conditions are satisfied, then obtain
explicit merge approval. Review the Changesets Release PR and package/plugin
version synchronization; qualify its final native artifacts and obtain separate
release approval before merging it, because main's workflow publishes npm
through OIDC. Procedure A and owner stop/recreate precede the first new host
allocation; S1 adoption remains held.

Only task-created dist and addendum4 scratch are teardown targets after
retaining evidence. Live timestamps show node_modules, generated hooks and
the parent scratch entries predate this run; they are preserved as coordinator
work. The coordinator handoff must include the final cleanup receipt and head.
