blocked (numbered questions)

1. Does the coordinator accept preserving the older, unattributable anonymous
   Docker volumes from the pre-fix rehearsal? **Recommended: preserve them.**
   Further cleanup needs authoritative parent/mount records. Selecting volumes
   by age, namespace, or a prune operation on this shared host is outside the
   grant. Twenty-five children with retained provenance were individually
   verified and removed; older real-cluster mount IDs were never retained and
   are no longer in the engine's event window. Complete historical cleanup
   cannot be attested safely.

The implementation and requested draft are delivered:
[PR #58](https://github.com/alleneubank/silo/pull/58),
`feat: atomic project allocation; refuse legacy state (breaking)`.
It remains draft. The blocker above concerns lane cleanup; macOS and matching
specialist approval remain expected release gates, not waived requirements.

Repository: `/home/ae/Work/0xbigboss/alleneubank/boss-mobile-release-silo-impl`.
Branch: `feat/atomic-allocation`, PR base `main`.

## Delivered

Atomic SQLite port/name/physical-file claims, one project-operation capability,
generation-fenced exports and callbacks, owned-file crash receipts, gated
Janitor process groups, immutable executor completions, exact backend identity,
retention-safe cleanup and host-wide read-only legacy refusal replace the old
JSON allocator/disown behavior. Exact owned container removal includes Docker's
anonymous-volume cleanup. Packaged skill, CLI help, bundled docs, example,
portable rehearsal and a major changeset were updated.

Relevant commits:

- `e4e77aa978cca4aa8210b0695123a7b8e7fa402d`: atomic allocation implementation.
- `c11370015e78da3253f28696e1ff24d8fdba77fa`: native/guest evidence.
- `4e05edd9af5d3fea3e2e5057553e071b33115cc7`: isolate legacy fixture Actions flags.
- `d6590a5bb129cb90cb50bb1617bfe3ac966d907b`: anonymous child cleanup and structural fixture comparison.
- `b96e18b3fc38d47adce7ac727a651eaaa763ca9e`: corrected qualification and explicit cleanup limits.

The final report/evidence commit follows these commits; executable source stays
at d6590a5. CLI artifact SHA-256:
`1a09c9812329a16342f95b7c006ddd5d844f611c6dbb3b5febca6a0e21396abc`.

## Acceptance / Verification

[Evidence index](evidence/atomic-allocation/README.md) links exact commands,
results, IDs, baseline failures, corrections and captures.

- Typecheck, lint, knip/jscpd, build, skill validation and **123 Bun tests** passed.
  Commit/push hooks ran; no required gate was bypassed.
- The final public-CLI all-suite rehearsal passed on ae-dev/Linux/ext4 at
  d6590a5/artifact 1a09, with real SQLite, Tilt, Docker/k3d, two live projects,
  legacy 0.9.0/0.5.9, pre-grant and export crashes, squatter, retention, alias
  and leftover refusals, failed teardown/retry, and anonymous-volume absence.
- Full web/API example and service-proxy health passed. Hosted
  [unit CI](https://github.com/alleneubank/silo/actions/runs/41768909265) and
  [example](https://github.com/alleneubank/silo/actions/runs/41768909399) passed
  at d6590a5. Later commits change records only; their automatic checks may
  rerun while this report is handed off.
- [Original guest](evidence/atomic-allocation/guest/verdict-guest.md): green at
  e4e77aa/artifact 6e5e for unchanged lifecycle flows.
  [Refreshed deletion guest](evidence/atomic-allocation/guest-r2/verdict-guest.md):
  green at d6590a5/artifact 1a09, including four anonymous children absent and
  an unrelated named control-volume sentinel unchanged.
- Claim audits, including the final d659 delta, are retained. They are factual
  audits, not implementation specialist approval. The skill pilot was
  decision-only and establishes no causal effectiveness improvement.

Not checked: native macOS/APFS or other architectures, valuable foreign data,
actual ae-dev cutover/pin retirement, Docker IPv6 publication races, Tilt's
independent API-listener failure, a live daemon request losing its completion,
and every instruction-level crash timing. Injected-store tests do not qualify
Docker/canonical child completion; native runs cover those separately.
No waiver was added.

## Decisions

- **Ratified:** r3 atomic claim/file/lifecycle design, r5 non-migrating refusal,
  and the owner's stop/recreate decision. The r3 verdict was `approve with
  conditions`; the owner's choice A closed the remaining cutover precondition.
  No standalone r5 approval is claimed.
- **Ratified:** announce cutover, upgrade/retire every permitted old invocation,
  and wait for every old operation to finish before the first new allocation.
  No real project stop/recreate or host cutover occurred in this lane.
- **Ratified boundary:** proposal pushes and draft PR only. No merge, ready
  transition, tag, version bump, release or npm publish was performed.
- **Provisional cleanup disposition:** preserve unattributable historical
  anonymous volumes; question 1 requests acceptance or authoritative provenance.

## Release

Recommended semver: **1.0.0**, supplied as a major changeset. Package/source
version remains 0.9.0 until release versioning.

1. Complete [macos-rehearsal.md](macos-rehearsal.md) and the profile-free,
   cross-provider [specialist request](specialist-request.md) at the relevant
   merging head; resolve findings and the cleanup disposition.
2. Obtain the human's merge approval. Main is release-workflow tracked;
   Changesets normally opens a Release PR after the feature/changeset lands.
3. Review the generated 1.0.0 package/plugin/source version sync. Build and
   record the versioned release artifacts; qualify the final release head on
   both OSes and retain required checks/guest/rehearsal evidence.
4. Obtain explicit release approval before merging the Release PR, which
   publishes npm through the repository's OIDC workflow. Do not run release
   or publishing commands from this lane.
5. Each host/project owner performs the announced cutover before its first new
   allocation. The existing S1 serialization hold is not lifted by this PR.

## Resources and operations

The final scoped audit found 78 author-store and 5 guest-store projects, all
with zero active generations, and no recorded/owner-labelled containers,
networks or volumes. Author-attested checks found recorded PIDs absent; guest gates returned
and their own fixtures/control resources were removed. This does **not** prove
all historical anonymous children absent. Twenty-five proven old children were
removed non-forcibly; unproven volumes and shared image/build cache were untouched.

Native scratch `<lane-root>-tmp` was removed after retaining its evidence.
Final git hooks use a separate temporary directory under this root, removed on
command exit. Ignored dependency/build outputs are removed after that final
push. No commands targeted peer registries, the BOSS repo, the shared builder
or credential configuration; deliberate cleanup used attributed fixture handles.

The refreshed guest initially captured full k3d labels privately, exposing an
ephemeral fixture token. Its retained node capture was restricted to allowlisted
identity/mount fields and the exact cluster was destroyed. The correction and
its limits are recorded in the guest verdict; no secret value is repeated here.

Git push and draft creation succeeded. One inspection used a wrong PR number;
#58 was subsequently verified draft. No auth repair was attempted. Local tool
friction was handled with the already installed Janitor binary and system
Python for skill validation; shared tool/config queues were not modified.
