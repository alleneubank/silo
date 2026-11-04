# Cross-provider specialist request

Status: requested; no implementation specialist verdict has been claimed.
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
