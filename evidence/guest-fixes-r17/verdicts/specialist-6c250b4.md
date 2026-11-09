**approve**, on condition that the in-flight native dual-FIFO rehearsal passes. If that rehearsal still times out, the verdict becomes **changes required**.

`verdict-specialist.md`

## Findings

**1. Should fix (unverified assumption that decides the goal): `src/cli.ts:294`.** The fix assumes Bun's `process.stderr.write` can't block inside the kernel when stderr is a full FIFO opened in blocking mode. That is exactly the baseline setup: in `dual-fifo-red.log:9` stderr is opened without `O_NONBLOCK`. The baseline shows the old `writeFileSync(2, …)` hung after the 30s JSON timeout (`dual-fifo-before.json`: timed out at 40006 ms, exit null). Whether Bun 1.4.4 writes to a pipe through its event loop or with a direct `write(2)` is runtime behaviour I can't confirm from source. If it writes directly, the `finally { process.exit(1) }` never runs and the bug is still there.
- **Check that settles it:** the same `dual-fifo.ts` harness on `6c250b4`, for both the JS bundle and the standalone binary. Pass means exit 1, roughly 30–31 s elapsed, not timed out. A hang until 40 s means the change failed.

**2. Should fix (possible regression, hypothesis): `src/cli.ts:328` → `:292`.** In human mode, the interrupt message used to be a synchronous write, so it was guaranteed to arrive when the reader was healthy. Now it's an asynchronous write followed straight away by `process.exit`. On macOS, pipe writes in Node-style runtimes can be async, and `exit` may drop queued data. The failure would look like this: `silo ci` in a normal CI log gets SIGINT, exits 130, and the "owned claims retained. Run silo status and silo down" reconciliation guidance never appears.
- No test covers this. `ci.test.ts:92-217` only exercises `--json` and only asserts stdout.
- **Check:** run human-mode `silo ci` with stderr piped and drained, send SIGINT and SIGTERM, and assert the exit code is 130/143 and that stderr contains `ci interrupted by`. Run it for both the JS and the standalone build.

**3. Note: `src/cli.ts:325-327`.** The JSON interrupt path is correct and slightly better than before. `writeFileSync(1, payload)` uses a small, fixed payload, and stdout has carried nothing earlier in `ci --json`. If that write throws (EAGAIN on a full non-blocking stdout, or EPIPE), the process still exits 130/143 with no JSON. Before this change, the throw left the handler without ever reaching the exit. Exit codes are now worked out from the signal alone. This stays within the "at most one result" contract.

**4. Note (existing behaviour, unchanged by this diff): `src/cli.ts:321`.** If SIGINT or SIGTERM arrives while a normal JSON result is mid-flush (`jsonResultStarted` is true), the handler returns and swallows the signal. The process can then wait up to 30 s and exits 1, not 130/143. That runs against "immediate CI cancellation", but it was the same in the approved `969a3a9`.

**5. Note (outside this diff's scope): `src/cli.ts:503,506,510-516`.** The non-interrupt fatal paths still use `console.error`, then the process exits naturally. If stderr is full, these paths are still unbounded. In human mode, earlier logging would already have blocked, so this isn't a new exposure.

**Authority:** the change adds no new signal sending, process killing or resource deletion. Cleanup is still left to Janitor's parent watcher.

## Not examined
- I didn't execute anything, including the in-flight rehearsal, tests or builds.
- I didn't read Bun runtime source, so I can't confirm how its stdio writes to a pipe.
- I didn't look at `ci.ts`, `status.ts`, the provenance, refusal and gate logic, or the normal data paths. I took the brief's statement that they're unchanged.
- I didn't examine the `native*/` rehearsal JSONs or the `resources` file.
- As instructed, I read no profiles, plans, sessions or author reasoning.
