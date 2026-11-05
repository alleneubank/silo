# Specialist request — human-approved round 4

The coordinator launches one read-only, profile-free specialist on a provider
other than this author's OpenAI provider. The human explicitly approved the
fourth round and, on 2026-11-05 at 02:21Z, selected container-scoped anonymous
volume removal in silo-redesign addendum 1. Keep the proposal draft; this lane
has not launched the specialist or claimed approval.

Use the standard specialist charter at
`/home/ae/.codex/plugins/cache/agent-profile/agent-workflows/16.1.0/skills/done/references/specialist.md`
(on onyx), or the identical standard charter in the coordinator's installed
skill. Supply that charter and the inputs below, without the author's house
profile/AGENTS/CLAUDE or author sessions. Grant every cited directory when the
review launcher restricts reads to its working directory.

## Goal, category and threat model

High risk: shared-host allocation/resource ownership and the breaking public
cleanup contract. Silo must not delete peer/replacement data. Its built-in
cleanup removes anonymous volumes only with exact receipted parent container
IDs (`docker container rm --force --volumes`), never by volume name. Receipts
retain anonymous mount names for audit/leak reporting only. Surviving names or
named volumes prevent retirement/forced replacement, preserving claims until
the data's owner resolves them. Ambiguous inherited provenance refuses.

A durable successful exact deletion retry must resolve earlier matching failed
intents on recovery, including a caller crash before completion import. An
older success must not resolve a later failed request. Unknown/lost completion
facts remain uncertainty; empty listings alone cannot cancel requests.

Threat model: trusted local users/agents, config, hooks, installed tools and OS
on a shared development host; accidental collisions, same-name replacements,
deletions, crashes and non-silo squatters. Malicious local writers and other
hosts/accounts are outside it. No private runtime/proxy or arbitrary shell
containment. Do not silently exclude the demonstrated replacement races.

## Exact inputs

- Repository/branch: onyx lane root, `feat/atomic-allocation`.
- Exact final proposal SHA: coordinator handoff `pr-ops.md`; verify the SHA
  before review. The runtime source is
  `20997dc740bd1df00c351cb4db6b4ba20734e47b`, CLI SHA-256
  `90a44fcc8641b959544e2cb9e9525d469b8749ea8abc680ababe87b7329e7e0f`.
  Later record-only commits reuse those runtime inputs.
- Review **the full delta fd710d9d..the exact final proposal SHA**, including
  the prior anonymous-receipt change, its callers and the crash-completion
  rehearsal correction, not merely this lane's last commit.
- Production baseline: `9882041` (0.9.0). Previous reviewed candidate:
  `fff3083dc1974f1856835a5ed8424c7f26ebb19a`.
- Production previously used peer JSON reservations and name-oriented backend
  cleanup. The previous candidate inspected anonymous name/time/label then
  deleted by name; its round-3 verdict required changes. See
  `evidence/atomic-allocation/container-scoped-volumes/verdict-specialist-r3.md`.
- Contract and callers: SPEC.md, packaged Silo skill, docs/troubleshooting.md,
  src/backends/{ownership,k3d,tilt}.ts, src/commands/down.ts,
  src/core/{lease_store,owned_command,executor,allocation,lease_types}.ts,
  creation/capture/retirement/reallocation callers, and native rehearsal scripts.
- Evidence: `evidence/atomic-allocation/container-scoped-volumes/README.md`,
  raw fixtures/logs, guest verdict and audit; `macos-rehearsal.md`.

## Round-3 finding-to-check map

| Finding | Distinguishing check |
| --- | --- |
| Same-second reused anonymous name | Native `--suite same-second`: equal Docker CreatedAt seconds, replacement/claims preserved. Red baseline and corrected observations retained. |
| Replacement after inspection, before delete | Native `--suite paused-delete`: baseline reaches a transparent scheduling barrier and deletes replacement; candidate has no name-delete operation, reports the surviving name and retains claims/replacement. |
| Anonymous cleanup at parent removal | Native `--suite parent-volumes`: exact parent and anonymous data absent before intentionally failed later Tilt teardown. |
| Durable successful retry followed by caller crash | Native `--suite retry-crash`: real failed network deletion, real durable successful retry fact while CLI is stopped, killed CLI, then public recovery/retirement. Narrow lease-store tests also cover import and temporal ordering. |
| Missing raw evidence | Current 132-test/static/build/commit/hook-push logs; 339-command full all-suite; complete example mount/health/retention/owner-resolution records; guest and audit. |

## Neighbors and qualification limits

Review explicit named/borrowed sources, source-less mounts, inherited mounts,
parent tombstones, partial creation, named-cache retention, ordinary down,
clean, explicit cluster deletion, force, retry ordering and all remaining
built-in Docker mutation callers. The k3d named image cache is deliberately
retained; fixture-owner cache cleanup is not an automatic product guarantee.

The author drove current native Linux scenarios; the guest independently used
real Compose/Redis. Neither qualifies native Mac/APFS account/process/fsync or
case modes, Intel/Apple Silicon final artifacts, actual cutover, new hosted CI,
lost executor facts, arbitrary transient tool-managed containers before
capture, alternate/remote engines/drivers, or every daemon instruction-level
interruption. Do not turn a listed limit into a passing scenario. Historical
unattributed Mac volumes remain untouched.

Return `verdict-specialist-r4.md` opening `approve` or `changes required`, with
exact head and findings ranked per the standard charter. No merge, ready
transition, publication, credentials or peer-resource mutation is authorized.
