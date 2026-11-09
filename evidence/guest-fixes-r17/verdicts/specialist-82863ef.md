approve

No blocking findings. The four goals are met in the code paths I read. Ownership stays fail-closed, the recorded executor/supervisor identities are still checked exactly, the non-leader refusal is unchanged, and no new signal or deletion authority is added. The production listener probe (`checkPortListenerAbsent`) is not changed. Below are should-fix items and notes, ranked. Each is labelled as a demonstrated code path or a hypothesis.

**Should fix**

1. **`status --json` now fails outright when a completion doesn't match its grant (demonstrated code path).** `src/commands/status.ts:31-35` runs `assert.deepEqual` on each completion's provenance inside `readStatus`.
   - **Input/state:** a `completions` row for the current generation whose `projectId`, `leaderPid` or `groupId` differs from the stored launch. The author's own SIGINT test creates exactly this by rewriting `projectId`.
   - **Result:** `status --json` exits 1 with `code: "SILO_ERROR"`, the generic fallback for a non-`SiloError` `AssertionError`, and prints no `project`, claims or receipts. The text `status` also aborts. So does the final JSON result of `up`/`down`/`env`/`ci` (`src/cli.ts:305-309`), even after the command's effects are committed.
   - **Baseline:** `status --json` printed the stored inspection for the same store.
   - **Why it matters:** SPEC says status "exposes ownership, resources, launches, completion facts and problems", and errors carry a stable `code`. Refusing to import the fact is right; `applyCompletions` already does that for `down`. But the read-only tool the docs tell operators to use before changing anything should still show the stored ownership.
   - **Remedy (separate from the defect):** report the mismatch per launch (e.g. `completion: null` plus a `problem`/`provenanceMismatch` field, with `cleanupRequired: true`), or throw a `SiloError` with a stable code. Don't let a bare `AssertionError` through.

2. **JSON result is marked as written before the write succeeds (demonstrated path; the trigger is a hypothesis).** `src/cli.ts:276-280` sets `jsonResultEmitted = true` and then calls `writeFileSync(1, …)`.
   - **Path:** if that write throws, `main().catch` calls `writeJsonResult(errorResult(...))`, which returns immediately. The process exits 1 with empty or truncated stdout and no schemaVersion-1 object. That breaks the "output is committed once" contract in the other direction: nothing complete is committed.
   - **Hypothesis to check:** with a full non-blocking stdout pipe, `writeFileSync(1, …)` may raise `EAGAIN` under Bun 1.4.4. Before this commit every JSON command went through `console.log`; now status, ci, up, down and env results all use `writeFileSync`. Large `status` payloads (up to 1024 launches with up to 1024-argument commands) can exceed a 64 KiB pipe buffer.
   - **Check that would distinguish:** build a store whose `status --json` output exceeds 256 KiB and run `silo status --json | (sleep 2; wc -c)`. Compare the byte count with the JSON length and confirm the exit status is 0. Repeat with `Bun.spawn(..., { stdout: "pipe" })` reading late. If it fails, set the flag only after a complete write, or loop on `EAGAIN`.

**Notes**

3. **The grant-wait margin counts one store lock wait; the checkpoint can take several (hypothesis; fails closed).** `src/core/constants.ts:20` sets the grant wait to 30 s + 5 s + 10 s. `owner.checkpointLaunch` (`src/core/owned_command.ts:170`, which goes through `lease_store.ts:589-595` and `441-445`) does:
   - `assertCurrent` outside the transaction
   - another `assertCurrent`
   - `BEGIN IMMEDIATE`
   - `COMMIT`, which needs EXCLUSIVE under `journal_mode=DELETE`

   Each step can wait up to the full 5 s busy timeout. If the parent passes the last `startupRemaining()` (line 168) near 30 s and then waits on three or four locks, the executor's 45 s clock (it starts at the handshake) can run out.
   - **Result:** the launch is durably `granted`, the executor exits without running the command or recording a completion, and `down` keeps raising `CLEANUP_REQUIRED` at `src/commands/down.ts:32`. This is safe (never a false launch success), and SPEC calls stalls beyond the window unknown outcomes. But the SPEC's derivation of 45 s understates the worst case.
   - **Check:** hold a reader SHARED lock and a competing writer during checkpoint at about 29 s and see whether the grant arrives within 45 s of the handshake.

4. **Short run budgets now get less startup time than the base did (demonstrated).** The startup budget is `min(timeoutMs, 30 s)` (`src/core/owned_command.ts:136`). For `registry-advertise` (`KUBECTL_APPLY_TIMEOUT_MS = 10_000`, `src/backends/registry.ts:71-76`), the handshake and the identity ps now share 10 s in total. The base allowed a 10 s handshake plus a separate 2 s ps. If the handshake takes about 9 s and the identity ps about 1.5 s, the base succeeds and the candidate times out. The `withRetry` wrapper and SPEC REQ-LAUNCH-002 make this intended and bounded; I'm noting it only as a behavior difference.

5. **Interrupts now exit normally instead of dying by the signal (demonstrated).** `src/cli.ts:296` calls `process.exit(130|143)`, so the parent sees a normal exit, not `WIFSIGNALED`. Shells that use wait-and-cooperative-exit (bash) will continue a script loop after Ctrl-C where the base would have aborted. The next `silo ci` then refuses with `BUSY`, so ownership stays safe. This matches REQ-CLI-001's wording "exits 130/143". If dying by the signal is wanted, re-raise with the default disposition after writing the JSON; the test's `exitCode` expectations would then need to change.

6. **A signal after the success JSON still exits 130/143 (demonstrated, narrow window).** Between `writeJsonResult(readStatus(...))` (`src/cli.ts:308`) and the `.finally` that removes the handlers (`src/cli.ts:482`), a signal makes `writeJsonResult` a no-op and exits 130/143 after a success object was already printed. Consumers would see a success payload with an interrupt exit code.

7. **The UDP fixture's reservation is weaker than its comment says (hypothesis; tests only).** `src/core/fixtures/connected_udp.ts:774-784` reserves TCP on 0.0.0.0 and ::, and UDP only in the other address family. Node sets `SO_REUSEADDR` on TCP servers, and on BSD/Darwin that allows a wildcard bind next to an existing specific-address listener. A UDP socket in the same family on another local address is not reserved either. So a co-located listener could still make the post-release `toBe(true)` assertions (`src/core/ports.test.ts:1028`, `lease_store.test.ts:855`) flaky. There is also a gap between `releaseListeners()` and the probe. Production refusal is unaffected.

8. **The interrupt handler doesn't cover unsupervised setup children (same as base).** For `kill -TERM <cli>` during setup, `runCommand` children such as `docker` are not in Janitor's group and are orphaned. The base's default kill did the same, so this is not a regression.

**Confirmed as intended:**
- **Interrupts:** the handler runs only between awaits, so it can't cut a synchronous SQLite transaction (better than the base's arbitrary kill). It writes nothing to the store, sends no signals, and leaves the dead operation PID for `down --recover` (`lease_store.ts:273-277`).
- **Status observations:** `observedLaunch` gives stored `exited`/`terminal`/`resolved` facts precedence. `groupsAbsent` needs ESRCH for both the supervisor and the group. `cleanupRequired` doesn't fire for healthy stacks, because `captureFinishedProducers` reconciles finished producers (`ownership.ts:267`) and `none`/successful-delete launches reconcile at exit.
- **Executor startup:** the executor's leader ps still refuses non-leaders before the handshake (`executor.ts:29-30`). The parent re-checks the deadline after the identity ps and before the durable grant, so an expired startup leaves the launch `planned`. A late grant can't produce a completion, because `executorGrant` requires `granted` (`lease_store.ts:331`).
- **Docs:** `with { type: "text" }` imports are compatible with `module: ESNext` / `moduleResolution: Bundler`, and `src/text.d.ts` types them. `--list` prints bare topic names, which matches the parsing in the distribution test.

**What I did not examine:**
- I ran nothing: no tests, builds, typecheck, or native/standalone runs.
- I did not check the author's evidence (`evidence/guest-fixes-r17`, the diagnostic or artifact hashes, the native Tilt/Docker captures, the ps-load comparison, the SQLite lock rehearsal).
- The listed neighbors not driven by the author's checks: the real `~/.silo` account path, Linux `/proc` socket tables, Darwin-x64/Rosetta/Linux runtimes, Docker volume qualifications.
- Janitor's parent-watch and drain implementation, `utils/exec.ts` and `utils/timeout.ts` internals, `socket_listeners.ts`/`ports.ts` (unchanged), `prepare.ts`/`withAllocation`, hooks, k3d backends beyond the timeout callers, and the tilt extension or skill text beyond grepping for the old status/interrupt wording.
- Whether Bun 1.4.4's `writeFileSync(1)` can return `EAGAIN` (finding 2) and the real per-statement SQLite busy behavior (finding 3) are still open.
- `resources`, `review-response-*`, `pr-body.md` and the other untracked or working-tree files.
