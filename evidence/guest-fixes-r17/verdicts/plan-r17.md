I've read the revision 4 amendments, the rev3 verdict, and checked the constants in the code. Here is the verdict.

**approve**

Revision 4 makes the corrections the rev3 review asked for. No concrete blocker remains. I ran no commands, wrote no files, and grant no waiver.

## Rev3 findings checked against revision 4

| Rev3 finding | Status |
|---|---|
| **B1: executor's grant wait could end before the parent writes the grant** | **Fixed.** The wait gets its own name, `EXECUTOR_GRANT_TIMEOUT_MS`, counted from `SILO_GATE` (plan-r17.md:31). The numbers check out against the code: 30 s observation + 5 s `STORE_BUSY_TIMEOUT_MS` (the default at src/core/lease_store.ts:167) + 5 s `TILT_DRAIN_GRACE_MS` (src/core/constants.ts:24) + 5 s = 45 s. The parent's deadline starts at spawn and the executor's starts later, at `SILO_GATE`. So the executor waits until at least spawn + boot + 45 s, while the parent's last grant write is due by spawn + 30 + 5 s plus fsync. That leaves about 10 s for fsync and scheduling. The earlier claim of "no grant after 30 s" is withdrawn. A stall beyond that window is treated as a refusal or unknown outcome, never a successful launch. The near-deadline real-lock rehearsal and the ordinary startup-expiry check are both specified. Item 7 (:13) already puts the bounded startup in SPEC. |
| **S1: startup time charged to `timeoutMs`** | **Fixed** (:32). The run timer still starts at the grant, startup stays capped separately at `min(timeoutMs, 30 s)`, and nothing is subtracted from the command's own run time. |
| **S2: one signal test could not pass** | **Fixed** (:33). The BUSY and `down` checks now apply only while an operation is held. The final-result window checks for exactly one object, the matching exit code, a status with no operation, and a next `ci` that is not BUSY. No assertion is dropped. |
| N1: status-read window | Fixed. The fixture now waits on a dynamic import that yields to the event loop, not on SQLite's blocking busy wait. |
| N2: UDP re-reservation | Fixed (:34). At most 32 attempts, only on EADDRINUSE. The fixture releases its own TCP reservation and waits for that before retrying. Other errors still propagate. Later races keep their diagnostics and fail; nothing is skipped. |

## Notes (not blocking)

- **The B1 check is described as an "author rehearsal" (:31).** Rev3 asked for a test. If it can run without the diagnostic build, commit it as a regression test that asserts the result is recorded and `CLEANUP_REQUIRED` never appears.
- **The 45 s total borrows `TILT_DRAIN_GRACE_MS` as a margin.** That constant means something unrelated. The value is right today, but a separate named margin would stop a future change to the drain grace from silently changing the grant wait.
- **The interrupt message is slightly off in the final-result window.** It still says "owned claims retained" after `owner.finish` has released the operation. This fails safe, and rev3 listed a message variant only as something to consider.
- **Rev3's N3 and N4 are not mentioned in revision 4.** N3: callers should check whether an operation is live before trusting `cleanupRequired`. N4: `commandLiveness` makes `status` and `up` slower under load. Item 7's docs update (:13) is the place for both.

## Needs the human or coordinator (not covered by this approval)

These rev3 items still stand:
- whether brief item 4 is resolved by evidence plus a fixture repair
- the wider 30 s identity budget for `status`, `up` and `down`
- the feature push (#58 stays a draft)
- the unqualified conditions: the real-account journal, Linux, Darwin-x64/Rosetta and Docker

No merge, release, account write, `~/.silo` write or deletion is granted.

## Not examined

I read only revision 4, the rev3 verdict, and the constants and timeouts it depends on (owned_command.ts, executor.ts, lease_store.ts, constants.ts). I ran no commands, tests or builds. I did not look again at the parts the rev3 review already covered.
