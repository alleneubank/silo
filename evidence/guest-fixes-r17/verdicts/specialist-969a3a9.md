# verdict-specialist.md

**approve**

This review covers 969a3a9, which changes only the fatal output-failure path in `src/cli.ts`. I read the diff, the current `src/cli.ts`, its callers, `src/utils/timeout.ts` and the two evidence files you named. I didn't run or change anything.

## What the change does
- **Failure removed:** at 461c759, a timed-out output write called `destroy()` and re-threw. The error then went to `main().catch` (`src/cli.ts:495-496`), which only logs and sets the exit code. If Bun kept a native FIFO write running, the process could stay alive past the 30 s deadline.
- **New path** (`src/cli.ts:306-311`): after the 30 s timeout or a write error, it writes one short line to stderr and calls `process.exit(1)`. The `finally` makes sure it still exits if that stderr write throws.
- **Callers:** every caller of the normal-output path awaits it as its last step: `printJsonResult` (`:333`, used by up/down/env/ci), `status --json` (`:434`) and the error result (`:498`). Exiting there skips no work that hasn't already happened. Exit code 1 matches what the old path set (`:494`).
- **Other goals still hold:**
  - **One result only:** the `jsonResultStarted` guard (`:293`, `:296`) is unchanged.
  - **CI interruption:** the small JSON for an interrupted, uncommitted CI run is still written immediately and synchronously (`:297-301`), unchanged.
  - **Success path:** writes that finish are unchanged.
- **No added authority:** `process.exit` only ends this process. The change sends no signals and deletes nothing.
- **Evidence agrees with the code:** `fifo-stall-result.json` shows exit 1 after 30696 ms, an 8192-byte prefix and the TIMEOUT stderr line. `large-output-final.json` (head 969a3a9) shows 15350087 bytes of valid JSON for both JS and standalone builds, for env and status. A closed reader gets exit 1 with EPIPE, and 0 claims remain after cleanup. I checked that these match the code but didn't re-run them, and I didn't verify where they came from.

## Findings

**Blocking:** none.

**Should fix:** none.

**Notes:**
1. **Unproven case: the stderr write can block** (`src/cli.ts:309`). `writeFileSync(2, …)` is synchronous. If stderr is a pipe whose reader has stopped and that is already full (e.g., a parent that captures stderr and has stopped reading it), this ~50-byte write blocks. `process.exit(1)` is then never reached, and the `finally` doesn't help because nothing throws. That would break the 30 s guarantee. It needs that unusual setup. To tell success from failure: re-run the stall test with stderr also pointed at a FIFO that is filled and not read, and check whether the process still exits by about 31 s. A possible fix is to exit without logging when stderr isn't writable. This is outside the current threat model unless you count stalled callers on stderr as in scope.
2. **Signals are ignored during a stalled result write** (`:316`, unchanged since 461c759). While the final CI result is being written, the SIGINT/SIGTERM handlers stay installed and return early, so a signal is swallowed until the 30 s timeout. The process still exits 1 within the deadline, so the goal holds. Callers should just know that a signal won't shorten a stall.
3. **Some error handling is now unreachable:** `writeJsonResult` can no longer reject, so the `catch` at `:499` and the "already started" logging at `:496` never run on an output failure. This is harmless; it could be cleaned up later.

## Not examined
- Bun's internal handling of native pipe writes and how `process.exit` behaves while a write is in progress. I relied on the native evidence for this.
- The internals of `commands/*` and the owned-process supervisor, beyond confirming that their output calls come last.
- Whether there are tests that cover the new path.
- Running any tests or rehearsals, and where the evidence files came from.
