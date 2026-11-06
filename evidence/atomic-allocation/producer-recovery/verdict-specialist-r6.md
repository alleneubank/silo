approve with conditions

Reviewed head `6c9428636509c4a1cae2549aaeef472d67c4c115`. I confirmed it with `git rev-parse HEAD`, and the tree was clean. `git diff a94bfd5..HEAD` touches no `src/`, `scripts/`, `package.json` or `bun.lock` file, so the qualified source `a94bfd5` and CLI `4c50596b…` are this head's executable inputs (`qualification-inputs.txt`, `all-recovery.log:1`).

I reviewed `git diff 3d94c7fa..HEAD` in full against the head tree and its callers: down, up, ci, prepare, ownership, k3d, tilt, the lease store and types, owned commands and the executor. I also read the SPEC, docs, changeset and skill deltas and the round-6 evidence.

This verdict applies the supplied threat model: trusted local users and agents on one shared host, with accidental collisions, deletions, crashes, replacements and port squatters, but no malicious local attacker. It also applies the human's decision that cleanup deletes only recorded IDs and stops its own Tilt by PID, and the coordinator's interior call to record finished launches before any deletion.

I found no path in the delta that deletes a peer or replacement object, and none that releases claims before absence is proven. All three round-5 findings are fixed by construction, and the author's red controls at `3d94c7fa` turn green at the qualified bundle. Two should-fix availability wedges remain. One is newly reachable because the delta makes same-generation restart the supported contract. The other is pre-existing. Neither weakens owner-only deletion.

## Round-5 findings

1. **Resolved — a recreated same-name object wedged the restart loop.**
   - Resource identity is now the immutable ID:
     - the primary key is `(project, generation, kind, id, created_at)`;
     - IDs are unique per kind for containers and networks;
     - only one live receipt may hold a name (`src/core/lease_store.ts:79-83`).
   - `recordResources` refuses only when a *live* receipt holds the same name with a different identity, or when a tombstoned ID reappears (`lease_store.ts:607-623`).
   - Capture tombstones a receipt only once its ID is missing from a complete, bridge-checked enumeration (`src/backends/ownership.ts:205-212`). Volumes use name plus creation time.
   - The preflights in down, prepare and k3d now compare against live receipts (`src/commands/down.ts:37`, `src/commands/prepare.ts:39`, `src/backends/k3d.ts:52,90`).
   - Tombstones are still read for leak and residual audit (`ownership.ts:267,279,285`).
   - I traced Compose `ci → down → ci → down --clean` and k3d `ci → down --delete-cluster → ci` through this code. Both record fresh IDs in the same generation. The k3d cache volume is reused through `docker volume create`'s same-name behaviour and matches its receipt exactly.
   - Red: `lifecycle-red.log` shows `NAME_CONFLICT` for both loops at `b14266a4`. Green: `all-recovery.log` and the guest's rows 1 and 2.

2. **Resolved for the scope named in round 5 — failed or stopped Compose producers went unrecorded.**
   - `tiltCi` no longer throws on a nonzero exit (`src/backends/tilt.ts:25-30`). `ci` records the finished producer before setting cleanup-required (`src/commands/ci.ts:21-25`).
   - `down` captures pending finished producers after stopping groups and importing completions, but before preflight or any deletion (`down.ts:22-33`).
   - The capture reconciles every pending workload or hook only after it succeeds (`ownership.ts:240-248`). A cleanup retry therefore has no pending producer, and a replacement Q created after P's removal stays foreign. That is shown by the live and non-live `composeReplacement` retries (`all-recovery.log`, barrier states at lines 373 and 459).
   - Provenance is unchanged from the success path: Compose project label, physical working root, and a started workload or hook (`ownership.ts:229-232`).
   - Failed hooks are covered too, because they stay unreconciled until `down` captures them.
   - The disclosure is corrected in SPEC.md:185-196, docs/commands.md:11-12,26-37 and the changeset.
   - The same class remains for k3d creates (finding 2 below). It is pre-existing and outside round-5 scope.

3. **Resolved — a failed exact-ID delete whose target later disappeared could never reconcile.**
   - Delete intents carry an immutable typed target (`src/core/lease_types.ts:42,48,62-63`). Only deletes may carry one (`lease_store.ts:547`), and the target is immutable across transitions (`lease_store.ts:567`).
   - `down` re-verifies each terminal, unreconciled delete target before the missing-fact check (`down.ts:25-30`).
   - `recordResourceAbsence` handles both outcomes atomically with the tombstone (`lease_store.ts:626-641`):
     - an exited request is reconciled;
     - a granted request with a lost fact becomes `resolved`/`target-absent` with exit null.
   - It touches only launches whose group is proven terminal, and never creates or untargeted commands.
   - This is sound under the model: the target is a full immutable ID, so any delayed effect can only hit that already-absent ID.
   - Evidence: red `absent-delete` at `b14266a4`; green `external-absence` and `lost-completion` with a real executor SIGKILL (`all-recovery.log`); unit tests `lease_store.test.ts:110-148`.

Round-5 note 4 (the check-then-signal window when stopping Tilt by PID) is unchanged and still accepted.

## Findings

No blocking findings.

1. **Should fix (availability, newly reachable) — the per-generation launch cap is shared by producers and cleanup, so a long-lived restarting generation can reach a state where Silo cannot delete its own live receipts.**
   - `planLaunch` refuses at 1024 launches per generation, counting reconciled history (`lease_store.ts:19,550`).
   - Every exact delete is a launch (`ownership.ts:294` → `owned_command.ts:84`).
   - Restarting within a generation is now the supported contract (`docs/commands.md:26`, REQ-CLEANUP-005). For the shipped example (`example/silo.toml`: two hooks, one Compose service), each `up` adds three launches and each `down` adds two deletes, so each cycle adds about 5.

   Source path:
   1. After roughly 200 `up`/`down` cycles in one generation, a producer reaches the cap with live receipts recorded, or a `down` reaches it partway through its deletes.
   2. Every later `down` throws `STORE_FULL` at the first delete it plans.
   3. `up`/`ci` refuse with cleanup-required, and `--force` refuses with retained or cleanup-required.
   4. The error tells the user to "clean this generation", which cannot succeed.

   The only exit is to remove Silo's own objects by exact ID outside Silo, after which `down` records absence and retires. No document says so.

   This is source-demonstrated, not run. Distinguishing check: in a unit test, fill a generation to 1023 launches with one live receipt, then require the public `down` to remove two receipts.

   Remedy, kept separate from the defect: reserve cleanup capacity by construction. For example, refuse new non-delete launches while live receipts plus a retry margin would exceed the cap, or compact terminal reconciled history.

2. **Should fix or owner-ratify (availability, pre-existing, not a regression) — a k3d create that fails with a known exit leaves its generation permanently unretirable.**
   - `recordCreation` uses `runOwnedCommand`, which throws on a nonzero exit before capture (`k3d.ts:38-42`, `owned_command.ts:141`).
   - `down` reconciles only exited launches whose effect is none, workload or hook, or whose exit code is 0 (`down.ts:49-58`). A failed `create` is therefore uncertain on every run.
   - That is deliberate (`lease_store.test.ts:236`, "a failed creating tool keeps its port").

   Concrete path inside the threat model:
   1. A port squatter takes the K3D_API_PORT between allocation and `k3d cluster create --no-rollback` (`k3d.ts:62-71`).
   2. k3d leaves server and serverlb containers carrying `io.silo` runtime labels, with no receipts.
   3. `down` hits `NAME_CONFLICT` on the cluster name (`ownership.ts:160-161`), and after owner removal, permanent `CLEANUP_REQUIRED` from the failed create.

   A plain `docker network create` failure, such as address-pool exhaustion on a busy host, reaches the same permanent `CLEANUP_REQUIRED` with nothing created. The claimed ports and names are held forever, and the docs offer only "escalate" (`docs/troubleshooting.md:86`).

   It is the same consequence as round-5 finding 2, on another producer. I missed it in round 5.

   Remedy, separate from the defect: before any deletion, capture a finished k3d create's labelled outputs with the existing `projectLabel` provenance, and reconcile known-exit creates once those outputs are recorded. Otherwise the owner ratifies the limit with a documented recovery that is not store surgery.

3. **Note — capture authority for an unreconciled producer lasts until a capture succeeds.**
   - If capture throws, for example on an unclaimed publication (`PORT_BIND_CONFLICT`) or an unlabelled network (`ownership.ts:186,232`), the launch stays pending. Every later `down` recaptures.
   - So any container a peer creates under this root's Compose project and working directory in the meantime is attributed and later deleted by ID. It is not the round-4 race: deletion cannot start while capture is pending.
   - This is a hypothesis within the accepted success-path provenance. Bounding capture by creation time against the launch's completion time would close it, if Docker and host clocks can be trusted on the target engines.

4. **Note — the executor's grant validation still opens read-only (`lease_store.ts:325-329`), and a validation error records no completion (`src/core/executor.ts:40-52`).**
   - If another account-store writer crashes and leaves a hot journal in the window between the CLI's grant commit and the executor's validation, the executor refuses without recording `started: false`.
   - The result is a permanent missing-fact refusal, which only an exact-target absence can resolve, and only for deletes.
   - The window is milliseconds and needs a concurrent crash. The writable lifecycle recovery claimed in REQ-STORE-001 holds (`hot-journal-public-green.log`).

5. **Note — Compose's in-place recreate is outside the qualified restart loop.**
   - When a service whose image declares a VOLUME is recreated (config change or rebuild while a receipt is live), Compose inherits the anonymous volume W into P' through an explicit `Source`.
   - Silo then treats W as supplied (`ownership.ts:130-135`), and `rm --volumes P'` keeps it.
   - With P receipted, clean refuses on a leak until the owner removes W. With P never receipted, W is left unaudited after retirement.
   - SPEC.md:175-176 discloses this. The restart paragraph in docs/commands.md:26-30 covers only the loop with `down` between runs; it should say so.

6. **Note — `status --json` lists tombstoned and live receipts identically (`lease_store.ts` inspect).** After restarts, several receipts share a name with no liveness field. The docs disclose this (`docs/commands.md:37`). A `deleted` flag would make the public JSON self-describing.

### New delta items asked about

- **Format 2 refuses format 1.** `databaseVersion` throws for any user_version other than 2, or a foreign application ID, before `journal_mode` or any schema write (`lease_store.ts:151-157,176-183`). Format-1 code at `3d94c7fa` likewise refuses version 2, so mixed proposal clients refuse each other and neither corrupts the store. The unit test preserves the bytes for both the creating open and the read-only inspect (`lease_store.test.ts:79-88`), and the real-CLI refusal leaves the SHA unchanged (`format1-before/after.sha256`). Acceptable as an unreleased, migration-free break. The cost to owners is in condition 2.
- **SQLite hot-journal recovery.** Removing the read-only preflight lets writable commands, including `down`, use SQLite's native rollback before schema validation. `openExisting` opens with `create=false` and returns null without creating a store or project (`lease_store.ts:239-247,257`). Red (`hot-journal-red.log`: `SQLITE_READONLY_ROLLBACK`) and public green with a killed real writer both hold. Read-only `status` refusing in that state is disclosed. I found no application mutation before validation.

## Conditions for the author

- Fix finding 1, or record an owner ratification of it.
- Fix finding 2 or record its ratification; this is owner-decidable.
- Change executable inputs before the native Mac run, so Mac qualifies the merging head once.
- A corrected change needs matching specialist review of the delta.

## Owner-only conditions

1. **Native macOS qualification at the actual merging head.** It must include this round's lifecycle suites (restart loops, failed CI, down-stopped live up, absent and lost delete, hot journal), plus APFS case and Unicode, account, process-group and fsync behaviour, and the final Intel and Apple Silicon artifacts. Linux and guest evidence do not qualify these.
2. **A separately authorized host cutover (procedure A).** Drain the legacy 0.9.0 clients and every format-1 proposal store with its matching old build before any format-2 allocation. Removing a drained format-1 store is a data-bearing deletion and needs explicit authority, because format 2 refuses it even when empty. Owners recreate their own projects. Historical unattributed Mac volumes and all peer objects are preserved.
3. **Keep PR #58 as a draft.** This verdict grants no ready-for-review, merge, tag, publish, cutover or S1 adoption.

## What I did not check

- I ran no tests, build, rehearsal or Docker/Tilt/k3d command, and I did not recompute the CLI digest. I relied on the recorded hashes and gate logs (`recovery-gates.log`: 146 pass, 393 assertions).
- I sampled the evidence rather than reading all of it: README, red log, final rehearsal scenarios, barrier states, hot-journal and format-1 logs, the teardown audit and the guest verdict.
- Findings 1–6 are source-demonstrated paths, not reproduced failures.
- I assumed Compose v2 inherits image-declared anonymous volumes on recreate through explicit `Source` mounts, and that Docker's `rm -v` skips mounts with a source. I did not re-read either upstream source this round.
- I did not trace k3d restart with the registry enabled (the lifecycle fixture disables it), duplicate network names on older engines, or same-second volume recreation (it fails closed).
- I did not cover the request's listed neighbors: native Mac, final artifacts, real cutover and mixed clients, lost completions for creates, transient tool containers, delayed daemon effects, external Kubernetes, alternate engines, and every daemon or database interruption point.
- I did not assess the lane records committed at the repository root (`report.md`, `resources`, `pr-body.md` and others) as product content.
- No checkout file was changed. This verdict is the only file written.
