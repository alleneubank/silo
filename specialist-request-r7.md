# Specialist round 7 request

The coordinator owns this review. Use one profile-free specialist with a
read-only shell and charter:
/home/ae/.codex/plugins/cache/agent-profile/agent-workflows/16.2.0/skills/done/references/specialist.md.
Return verdict-specialist-r7.md; do not change code or launch another reviewer.
Confirm the reviewed ref and inspect the full delta
fd710d9d1c407678a228133a4f94bb0da5106a7d..HEAD, including the author-condition
changes since 6c942863. Handoff pr-ops.md seals the exact proposal ref and push.

Qualified source: 3f87992621a06888ec32c55afe46ec9b71211005.
CLI SHA256: 2e4f0501ccc6423900d902a70623a629917153cc7c0a772b6eef3cb779741ec6.
Later records preserve executable inputs. Category: high-risk durable state,
shared-host ownership and breaking CLI/public contract. Goal: atomic allocation
and generation-fenced effects without deleting peers. Human addendum 6 limits
Docker deletion to recorded immutable IDs and stopping to verified recorded
processes. Addendum 8 directs the two round-6 author repairs. The unchanged
round-6 approve-with-conditions verdict at 6c942863 is retained in the new record.

Threat model: trusted local users, executables and cooperating config/tools;
defend against accidental concurrent collisions/replacements, crashes, missing
facts, squatters and unrelated resources/files. No hostile local-writer sandbox.
SPEC.md holds standing requirements, refusal boundaries and the no-migration
cutover contract. Real store deletion, even drained, needs explicit owner authority.

Inputs: full code diff and callers, SPEC.md, docs, major changeset, pr-body.md,
macos-rehearsal.md, review-response-r6.md and raw evidence under
evidence/atomic-allocation/producer-recovery/.
Earlier records qualify their own historical inputs. No current approval is claimed.

Neighbors not driven: native Mac/APFS case/Unicode, account/process/fsync and
final Intel/Apple Silicon artifacts; actual owner cutover/mixed clients;
pending-capture late attribution and read-only executor grant validation during
hot-journal recovery (round-6 notes 3/4 unchanged); unknown create completion loss,
arbitrary transient containers before capture, delayed daemon effects, Compose
in-place recreate, external Kubernetes, alternate engines/drivers and every
instruction-level interruption. Entire capacity occupied by unresolved effects
still refuses. Named caches and ambiguous/orphaned data need independent owners.
Both the initial registry-advertise timeout and the final-source restart
load-balancer failure remain unattributed despite later successful runs. The
registry-enabled red and same-state recovery, the initial/follow-up guest scopes
and accounting gaps, and the client-version probe correction are disclosed in
the evidence record. The final full run uses a transparent failure-only observer.
Preserve historical unattributed Mac volumes. Keep PR58 draft; matching review,
Mac/final artifacts and authorized cutover remain separate gates.
