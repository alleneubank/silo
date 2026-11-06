# Specialist round 6 request

The coordinator owns this review. Run one profile-free specialist with a
read-only shell, using the charter:
`/home/ae/.codex/plugins/cache/agent-profile/agent-workflows/16.1.0/skills/done/references/specialist.md`.
Return `verdict-specialist-r6.md`; do not change code or launch another reviewer.
Confirm the actual reviewed ref with the shell, and inspect the full delta:
`fd710d9d1c407678a228133a4f94bb0da5106a7d..HEAD`.
The exact proposal ref and push result are sealed in handoff `pr-ops.md`.

Qualified source: `a94bfd50723cb1d61c52006c5e10acb651d8da1f`.
CLI SHA-256: `4c50596b5171ecda81912351d98c28f28f1b791aeee1a7aac31422648f8befc5`.
Later record-only commits preserve these executable inputs.
Category: high-risk shared-host ownership, durable state and breaking CLI contract.
Goal: atomic allocation and generation-fenced effects without peer deletion.
Human addendum 6 limits cleanup to recorded Docker IDs and verified recorded
processes; no delegated project teardown. Addendum 7 directs the lifecycle
repairs after the unchanged round-5 verdict at 3d94c7fa required changes.
The production 0.9.0 client uses legacy JSON/root locks; owners drain old clients
and recreate projects. Unreleased format 1 is incompatible with format 2; no
schema migration/reset. SQLite's own rollback recovery is permitted before
application schema validation.

Threat model: trusted local users, installed executables and cooperating
config/tools; defend against accidental collisions, concurrent replacements,
crashes, missing facts, squatters and unrelated files/resources. No hostile
same-account writer containment or arbitrary shell sandbox. SPEC.md holds the
standing requirements and refusal boundaries.

Inputs: code and all callers in the full diff, SPEC.md, docs/, operator skill,
major changeset, pr-body.md, macos-rehearsal.md, review-response-r5.md, and
`evidence/atomic-allocation/lifecycle-reconciliation/` including the unchanged
round-5 verdict, red controls, final raw outputs and guest records. Earlier
records retain historical source identities and superseded behavior.

Neighbors not qualified by Linux checks: native Mac/APFS case/Unicode modes,
account/process/fsync behavior and final Intel/Apple Silicon artifacts; real
host cutover/mixed clients after cutover; unknown create completion loss,
arbitrary transient tool containers before capture, delayed daemon effects,
external Kubernetes, alternate Docker drivers/endpoints and every instruction-
level daemon/database interruption. A killed exact-ID delete was checked; that
is not evidence of generic request cancellation. Named caches and orphaned or
replaced mount names require independent owner resolution. Preserve historical
unattributed Mac volumes. Native Mac follows this review; no round-6 approval
or merge/release/cutover authority is claimed.
