# Specialist round 5 request

The coordinator owns this review. Use the profile-free, read-only specialist
charter at `/home/ae/.codex/plugins/cache/agent-profile/agent-workflows/16.1.0/skills/done/references/specialist.md`.
Return `verdict-specialist-r5.md`; do not launch another reviewer or change code.

Review the full delta from `fd710d9d1c407678a228133a4f94bb0da5106a7d` to
the exact proposal head sealed in the coordinator handoff `pr-ops.md`.
Runtime source: `d9628d1fe8ec47ca401998e35a8786a85bb0ebe6`; qualified
source plus rehearsal: `77e3d68f9b8dffff2aec9c31bc2833349c36c3f3`.
CLI SHA-256: `b14266a4564fa89dd7440d5cce5de08f51dd587173a9b3ee475b49b2743c2e53`.
Later record-only commits preserve those executable inputs. Confirm the exact
reviewed ref before reviewing; the handoff records the network push outcome.

Category: high-risk shared-host ownership, durable state and breaking CLI/public
contract. Goal: atomically allocate and fence project generations without deleting
peer data. Human addendum 6 ratifies recorded-ID-only Docker cleanup and stopping
only verified recorded processes; no delegated Tilt/Compose/project teardown.
The production 0.9.0 client uses legacy JSON/root locks and does not manage the
SQLite domain. Owners must drain old clients and recreate projects; no migration.
The a7359a45 proposal still ran Tilt down after removing exact parents; round 4
rejected its replacement race and incomplete Git evidence.

Threat model: trusted local users, installed binaries and cooperating configuration
and tools; defend against accidental concurrent collisions/replacements, crashes,
missing facts, squatters, and unrelated files/resources. No hostile same-account
writer containment or arbitrary shell sandbox is promised. Inspect SPEC.md for
standing ownership and refusal requirements. Read the unchanged prior verdict in
`evidence/atomic-allocation/recorded-id-teardown/verdict-specialist-r4.md`.

Inputs: code and callers in the full diff, SPEC.md, docs/, the major changeset,
`pr-body.md`, `macos-rehearsal.md`, and raw qualification evidence under
`evidence/atomic-allocation/recorded-id-teardown/`. Earlier evidence remains under
`evidence/atomic-allocation/`; its source identities are historical inputs.

Neighbors the current Linux checks do not drive: native Mac/APFS case and Unicode
modes, native account discovery/process identities/fsync and final Intel/Apple
Silicon release artifacts; real host cutover and mixed clients after cutover;
lost executor facts; arbitrary transient tool containers before capture;
interrupted producers with outstanding delayed daemon requests; external Kubernetes
clusters, alternate Docker drivers/endpoints and every daemon interruption boundary.
Unreceipted resources are deliberately refused instead of adopted during cleanup.
Named caches and orphaned/replaced anonymous names require independent owner
resolution. Preserve historical unattributed Mac volumes. The Mac run follows
this specialist review; no current matching specialist approval is claimed.
