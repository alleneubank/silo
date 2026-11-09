**approve**

The correction fits the observed failure and the standard, and I found no blockers.

**Why it holds**
- **The failure is real at the line the plan names.** `src/cli.ts:276-280` sets the "result already written" flag and then calls `writeFileSync(1, …)` once. When that write throws, `main().catch` (`src/cli.ts:469-473`) calls `writeJsonResult` again, which does nothing because the flag is set, then exits 1 with nothing on stderr. That matches `inspect-large-result.log` exactly: exit 1, 655360 bytes, unterminated JSON, no error line.
- **The plan's list of result writers is complete.** The four in source are `printJsonResult` at `:309`, `status` at `:410`, the main error handler at `:471` and the interrupt handler at `:293`. The plan covers all four.
- **The claim that "no prior JSON is queued" before an interrupt holds in source.** In JSON mode the logger writes to stderr (`src/utils/logger.ts:17,22`). Every `runCommand` caller passes `stdio: "pipe"`. The supervisor's stdout and stderr go to `process.stderr` (`src/core/owned_command.ts:148,156,173`). So the fixed interrupt payload goes into a pipe nothing else has written to.
- **Keeping two write paths is justified, not a shim.** The interrupt payload is fixed and about 200 bytes, under macOS's 512-byte limit for a single uninterrupted pipe write, so the sync write stays reliable there. The plan also gives a concrete reason against async interrupt output: setup could keep running while the write waits.
- **The verification uses the product path, which is the right test.** The standalone probe (`stdout-strategies.log`) passed in all three modes, so it can't tell the designs apart. The plan treats the native run with the >940 KiB payload and a 2 s delayed reader as the real test, on both built JS and compiled binaries.

**Notes (not blocking)**
- **The cause is still unknown.** The plan doesn't claim EAGAIN, and the evidence doesn't show which error `writeFileSync` raised. The design reports any write error as a nonzero exit, so it's safe either way. Capturing the error code in the red baseline would confirm the explanation.
- **Bun's write callback timing may matter.** If the callback fires when Bun buffers the data rather than when it reaches fd 1, awaiting it proves nothing. The large-payload native rehearsal is the only check that settles this, so it has to stay a hard requirement.
- **Two behaviour changes should be stated in SPEC/docs:**
  - During a stalled write in `ci`, SIGINT/SIGTERM are ignored for up to 30 s.
  - A reader that pauses longer than 30 s (for example a pager) now gets a nonzero exit instead of the full result.
- **Uncaught signals can still truncate output.** `env`, `up`, `down` and `status` have no signal handlers, so a signal during a slow write can still leave partial JSON. That's unchanged from today and outside this correction.

**Only you can approve:** this is a CLI JSON contract change, so it still needs the specialist review and the native rehearsal at the merging head. This approval doesn't replace either.

**Not examined:** Bun 1.4.4's `process.stdout` internals, the other r17 evidence files, the SPEC/docs text, the tests, the `doc --json` output path (it uses `console.log`), and anything after 408fddb. I ran nothing and wrote no files.
