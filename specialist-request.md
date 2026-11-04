# Cross-provider specialist request — round 3 of 3

Coordinator-owned launch, per addendum 5. Review cleanup source `a21f710896528aeaed5a6c142abc13a80895f1ba`,
CLI SHA-256 `40fd990ead9815f2f679b43e16eb65fc111fe0a798e08988e9a85667206e43a6`, with the standard charter and threat model below.
The earlier round-2 approval does not cover this product change. Keep PR #58
draft. No review is launched or approval claimed by this lane.

Goal: every owned container's creation-result receipt journals its anonymous
mount identities before Silo tears that container down; receipts survive
parent deletion. Clean removes only exact recorded anonymous children and
cannot release or replace a generation while a recorded child remains.
Named, explicitly supplied, bind and inherited mounts confer no child authority.
Explicit cluster deletion uses the same exact child receipts, without implicit
Docker --volumes deletion or pruning. Inspect all retirement/reallocation,
failed-delete/retry and parent-forgetting paths against that obligation.

Author risk scenarios: real copied example before/after; public regression red
on 5d2c870 and green here; plain-down retention; forced-reallocation refusal;
in-use deletion refusal and successful exact retry after original parent is
gone; named and explicitly borrowed anonymous sentinel preservation;
replacement identity refusal and absent-child recovery; full native k3d
create/retain/delete and the existing all-suite crash/peer/cutover checks.
Evidence: [anonymous-volumes/README.md](evidence/atomic-allocation/anonymous-volumes/README.md).

Neighbors not qualified: tools deleting/recreating transient containers before
Silo can capture creation results, inherited volumes-from, lost executor facts,
same-name/same-second volume identity replacement, hostile local actors,
alternate engines/drivers, native macOS at this runtime and final versioned
artifacts. These are limits, not passing scenarios. Review scope remains trusted
local users/agents and cooperating config/tools on a shared development host.
The prior Mac 5d2c870 pass does not qualify these changed bytes or establish
ownership of its two historical anonymous volumes; preserve them.

## Historical request and standard charter

Status: round 2 returned **approve with conditions** at `fd710d9`;
[its verdict](evidence/atomic-allocation/crash-completion/verdict-specialist-r2.md)
is retained verbatim. It has no blocking or should-fix findings. Correction
`cf0b2b2` changes only the rehearsal's completion observation and the Mac
runbook; runtime source and artifact are unchanged. This does not initiate
product specialist round 3. The coordinator owns any further review request;
native Mac, final versioned artifacts, cutover and release conditions remain.

The original round-2 request below is historical context, not a second launch:

Round 1 returned **changes required** at `5344574`;
[its verdict](evidence/atomic-allocation/specialist-r1/verdict-specialist-r1.md)
is retained verbatim. Request a fresh review at executable source
`80f4974d0f9e2db056ceb7ba771fe12597d5afad` (later commits change tests/records
only), artifact `9965e0b2fde3397eadc7c507ae2e7afafd7f0a4b3accfdc84411fba803185894`.
The final source also preserves bounded supervisor diagnostics on pre-grant
startup failures; inspect its error propagation and retained-claim behavior.
No corrected-head specialist approval has been claimed.
Keep the PR draft. Run one reviewer on a provider different from the author
(Codex/OpenAI), read-only and without the author's profile/AGENTS instructions.
Supply the standard charter below, this goal/threat model, the baseline,
selected PR head, diff, source and named neighbors. Do not supply author
sessions or reasoning. Use the PR Evidence revision and artifact digest; a
message-only/evidence-only commit does not invalidate unchanged behavior.

## Goal and risk category

Atomic local-account allocation and generation-bound lifecycle cleanup for
Silo. High risk: shared-host resource ownership, SQLite schema/durability,
public breaking CLI/file contract, and CI/runtime prerequisites. This is a
stop/recreate cutover, with no import, migrate or recreate helper.

Threat model: trusted local users/agents on a shared development host;
accidental collisions, deletions, crashes and non-silo squatters. No malicious
local attacker or confidentiality boundary. Config, hooks, installed tools
and OS are trusted and must consume generated names/ports. No private runtime,
network daemon/proxy or arbitrary shell containment is promised.

Production baseline: `9882041aa7d1f798d6cdb44c5cab1cec8d0acd9a` (0.9.0).
Peer JSON reads and publication are separate; env can overwrite an escaping
output; same-name resources may be reused; live force disowns a stack; failed
Tilt down can still clean snapshots/reservations. The candidate's public
contract is [SPEC.md](SPEC.md) and its bundled docs. Review `git diff <base>...<head>`
and all changed callers, including the example and workflows.

## Neighbors the author's checks do not qualify

- macOS native account lookup, Darwin PID/group behavior, APFS case and Unicode
  aliases, directory fsync, Intel/Apple Silicon distributed artifacts. The Mac
  run is pending; [macos-rehearsal.md](macos-rehearsal.md) gives the commands.
- The coordinator's original macOS real-push failure. Linux reproduces the
  same three failures with an unconfigured mise Janitor shim, and passes an
  actual local-bare push with native Janitor. That does not establish the Mac
  cause. Native-binary fixture preflight and actual Mac push remain necessary.
- Live third-party Docker requests that complete after a lost executor fact;
  required behavior is retained cleanup uncertainty, not guessed cancellation.
- Real stopped foreign k3d topologies with persistent data. The leftover server
  and registry refusal cases use native stopped synthetic Docker containers;
  full owned k3d creation/retention/deletion was driven separately.
- Real schema upgrades are deliberately unsupported; unknown/corrupt state must
  refuse rather than initialize. Test error paths against their input states.
- Alternate local engines and endpoint drift; remote engines must refuse.
- Tilt's independently selected internal API listener, IPv6 Docker publication
  races, and dependencies that bind after a successful probe. No kernel socket
  reservation or single-listener guarantee is claimed.
- Arbitrary hard-coded tool names/ports and unlabelled external/shared objects
  lie outside the managed contract. Check that failed scope attribution cannot
  confer deletion authority. Inspect Compose project_name and ownership labels.
- Namespace absence uses complete structured enumeration and the engine's
  known-present bridge control. Judge whether this satisfies the required
  absence proof at the last owned-object deletion; do not infer absence from
  an error or an unvalidated filter.
- Actual ae-dev host cutover and real installed-client upgrades/retirements
  were not performed. Old clients after cutover are unsupported limits; the
  fixture demonstrates duplicate lock-only numbers with unchanged new claims.
- The fresh example first encountered a k3s bootstrap/API failure and failed
  original Tilt teardown; the failure and exact fixture teardown records are
  retained. A fresh generation with the original inputs passed. No general
  bootstrap-reliability or pre-existing-failure conclusion is established.
- An anonymous Redis /data child remained after Compose/Tilt teardown and was
  individually removed using its recorded mount/parent attribution. Automatic
  k3d node/registry child removal was exercised separately; arbitrary Compose
  anonymous children are not an established automatic-cleanup guarantee.

## Standard specialist charter

Review one change in the named risk category. Judge whether it reaches the
goal in production without breaking what that category protects: data, access,
callers or the running service. Read touched code and callers; compare each
changed interaction with production's behavior.

Every finding must name a file/line and concrete failing input/state, wrong
outcome and violated requirement or threat boundary. Separate observed
failures, demonstrated paths and hypotheses; name unverified assumptions and
the distinguishing check the author should run. Inability to run a check
proves neither result. Separate the defect from its proposed remedy. Explain
which failure a refactor removes. Flag scope/threat-model challenges explicitly.

Rank findings **blocking**, **should fix**, or **note**. State what was not
examined. Return `verdict-specialist.md` opening `approve` or `changes required`,
with findings in that order and the exact head reviewed. No merge, publish,
credential change, peer-resource cleanup or production operation is authorized.
