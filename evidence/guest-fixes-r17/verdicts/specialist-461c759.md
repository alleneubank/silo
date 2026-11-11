approve

**Scope.** I reviewed candidate 461c759 against the incremental correction patch (`diff-r17-review-corrections.patch`) and the current source of `src/cli.ts`, `src/utils/timeout.ts`, `src/commands/status.ts`, `src/commands/ci.ts`, `src/utils/exec.ts`, `src/core/owned_command.ts` (stdio), `src/core/lease_store.ts:377-390` and `src/utils/logger.ts`. I did not run anything.

**What holds, by reading the code (not observed)**
- **One JSON writer.** `writeJsonResult` (`src/cli.ts:292-310`) is the only code that writes JSON to fd 1. It sets `jsonResultStarted` in the same synchronous step as building the payload, before any await. Signal handlers run between event-loop turns, so a signal cannot slip in between "started" and the write being queued.
- **Normal stdout path.** It uses `process.stdout.write` with a completion callback, wrapped in a 30 s `withTimeout`. On failure it destroys stdout and rethrows. `main().catch` (`src/cli.ts:491-499`) sets `exitCode = 1` first, then sends the error to stderr only, because emission has already started. That gives no second object and a nonzero exit, which matches SPEC REQ-CLI-001.
- **Interrupt path.** The fixed INTERRUPTED value is about 200 bytes. It is written with one synchronous `writeFileSync(1)` and then `process.exit(130/143)`. On fd 1 nothing has been written before it, because:
  - structured logging goes to stderr (`logger.ts:17,22`);
  - every `runCommand` child that can run during ci uses `stdio: "pipe"`;
  - supervisor stdout is drained to `process.stderr` (`owned_command.ts:173`).

  So the "empty pipe" assumption holds on fd 1 itself, and the payload is below PIPE_BUF, so the write is atomic.
- **Result and exit selection.** `interrupt` returns early once `jsonResultStarted` is set (`src/cli.ts:314`). A signal during the normal flush therefore keeps both the selected result and its exit code. A signal during `await import("./commands/status")` in `printJsonResult`, before emission starts, still produces INTERRUPTED with 130/143, as REQ-CLI-001 requires ("including final status collection").
- **No new authority.** The handler sends no signals and deletes nothing. Handlers are removed in `.finally` only after the catch path's awaited write finishes.
- **Provenance refusal in status.** `readStatus` (`status.ts:32-37`) throws a `SiloError` with code `COMPLETION_PROVENANCE_MISMATCH`, which the existing writer serialises. The detail keys (`launchId`, `projectId`, `generation`) don't collide with `schemaVersion`, `code` or `message`. Status is read-only, so ownership stays retained.

**Findings, ranked**

1. **Should fix (not tested). Nothing checks the 30 s stalled-reader limit, and it depends on Bun runtime behaviour.**
   - `src/cli.ts:303-309` only enforces the limit if Bun calls the `process.stdout.write` callback after the kernel accepts the bytes, and if `process.stdout.destroy()` actually drops the queued pipe write so the event loop can exit.
   - If Bun calls the callback once the data is buffered, the timeout never fires. A process whose reader never reads would then stay alive forever waiting to flush, instead of exiting nonzero at 30 s as `docs/commands.md:83-84` and SPEC now promise.
   - The same gap applies if `destroy()` leaves the native write pending.
   - The only check, the large-result test in `src/commands/ci.test.ts`, starts its reader after 2 s, so it passes either way. `native-final/` contains no stalled-reader or signal-during-flush capture.
   - Check that would settle it: run `status --json` with the ~940 KB config from that test and never read stdout. Expected: exit 1 within about 31 s, stderr containing `Timed out after 30000ms: JSON output`, and stdout holding only a strict prefix of one object. A process still alive at about 60 s proves the defect.
   - Also worth capturing: SIGTERM sent during that stalled flush, expecting exit 1 rather than 143.

2. **Should fix (minor, contract consistency). `down` / `ci` report the same provenance mismatch as `SILO_ERROR`.**
   - `ProjectOperation.applyCompletions` (`src/core/lease_store.ts:382`) still uses `assert.deepEqual`. So the database row that makes `status --json` return `COMPLETION_PROVENANCE_MISMATCH` (the row `ci.test.ts:141` injects) makes `down --json`, or any path reaching `recordCommandResult`/`applyCompletions`, return `{code: "SILO_ERROR", message: "Completion provenance differs from the grant"}`.
   - That conflicts with the general wording at SPEC.md:197-198 ("A mismatched fact refuses with `COMPLETION_PROVENANCE_MISMATCH`").
   - Ownership is still retained, assuming the assert fires before `checkpointLaunch` (it does). Safety is not affected; only the public error code differs.
   - Fix options: reuse the typed `SiloError` at line 382, or limit the SPEC sentence to `status`.

3. **Note (unverified; partly inherited from 82863ef). A synchronous write that fails inside the interrupt handler loses the 130/143 exit.**
   - At `src/cli.ts:300` (JSON) and `:316` (non-JSON stderr), an `EAGAIN`/`EPIPE` thrown by `writeFileSync` escapes the handler before `process.exit(exitCode)`.
   - This needs a nonblocking descriptor that is full or closed. That is plausible for fd 2 in non-JSON ci, because tilt output is drained to stderr. It is also plausible for fd 1 under `2>&1` with a slow reader, since both then share one pipe and its O_NONBLOCK flag.
   - Result: no INTERRUPTED value, and an uncaught-exception exit code instead of 130/143.
   - Cheap remedy: wrap the write in `try { … } finally { process.exit(exitCode) }`.
   - Not shown to occur. Whether the fd is O_NONBLOCK under Bun has not been checked here, but the author's baseline EAGAIN on fd 1 suggests it is.

4. **Note. A signal during a stalled flush is deferred for up to 30 s.** SIGINT and SIGTERM are swallowed while the result flushes (`src/cli.ts:314`), so a CI runner's graceful stop waits for up to the flush limit before its SIGKILL escalation. This is documented and intended, and adds no authority. Recorded only for runners whose grace period is under 30 s.

5. **Note. EPIPE on the normal path may surface as an unhandled stdout `error` event in Bun rather than through the write callback.** The exit is nonzero either way, so the documented contract still holds. This is a guess about the runtime, not something I observed.

**Not examined**
- The full `diff-r17-final.patch` and the four original fixes: doc lookup in JS/standalone, executor/supervisor startup budgets, connected-UDP retirement, and status launch-state derivation. These were approved at 82863ef; I did not re-review them beyond the callers named above.
- `down.ts`, `prepare.ts` / `withAllocation`, and the rest of `lease_store.ts`.
- Bun's stdout and stream implementation, and whether fd 1/2 are O_NONBLOCK.
- The contents of `evidence/guest-fixes-r17/` (I only listed `native-final/`) and the artifact/diagnostic hashes.
- Standalone builds and Linux / Darwin-x64 runtimes.
- I ran no tests and did not run the full normal-hooks gate.
- I did not read any agent profiles, plan deliberations or author reasoning.
