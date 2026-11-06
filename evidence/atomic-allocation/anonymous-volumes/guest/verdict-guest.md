green

All requested scenarios ran against real Linux Docker using the supplied built CLI. Only guest-owned disposable Docker fixtures and the supplied isolated account filesystem were mutated. No product source, diff, author sessions, build, or credentials were inspected or changed.

| Scenario | Result | Observed | Capture |
| --- | --- | --- | --- |
| Real Compose Redis project | pass | `silo ci g6401main --timeout 90s` created three Redis services. Redis accepted marker writes and SAVE. Container receipts identified only the image-created `/data` volume as an anonymous child. | [main-ci.log](main-ci.log), [main-status-before-down.json](main-status-before-down.json), [data-writes.log](data-writes.log) |
| Plain down retains anonymous data | pass | Original Redis container disappeared; its exact anonymous volume remained. Status was stopped with all 15 claims and the anonymous child receipt retained. | [main-status-after-plain-down.json](main-status-after-plain-down.json), [main-parent-after-plain-down.log](main-parent-after-plain-down.log), [main-anonymous-after-plain-down.json](main-anonymous-after-plain-down.json) |
| Clean removes retained anonymous data | pass | `down --clean` removed the exact retained volume. Docker reported no such volume; status became unallocated with no claims, resources, launches, or file receipts. | [main-clean.json](main-clean.json), [main-anonymous-after-clean.log](main-anonymous-after-clean.log), [main-status-after-clean.json](main-status-after-clean.json) |
| Repeat clean | pass | Repeated clean succeeded with `changed:false` and unallocated state on both roots. | [main-repeat-clean.json](main-repeat-clean.json), [peer-repeat-clean.json](peer-repeat-clean.json) |
| Preserve named, explicitly supplied, unrelated data | pass | Main clean preserved an attached external named volume, an explicitly supplied hash-shaped external volume, and an unrelated named volume. Reopening the real main Compose project loaded both saved Redis marker values. The replacement implicit anonymous volume was different and had no old marker. | [preserved-after-main-clean.json](preserved-after-main-clean.json), [main-reopen-data.log](main-reopen-data.log), [main-reopen-status.json](main-reopen-status.json) |
| Preserve second root | pass | A separately allocated Compose Redis root stayed running through main down and clean. Its marker remained `peer`, and its anonymous volume still existed. | [peer-status-before.json](peer-status-before.json), [peer-after-main-down.log](peer-after-main-down.log), [peer-after-main-clean.log](peer-after-main-clean.log), [preserved-after-main-clean.json](preserved-after-main-clean.json) |
| Failed clean retains ownership after parent disappears | pass | A guest-owned borrower mounted the peer anonymous volume. Two clean attempts each exited 1 with `COMMAND_FAILED`, the exact in-use volume and borrower ID. The original Redis parent was gone; both attempts retained generation 1, all 15 claims, exact child receipt, and unchanged env/lock hashes. | [borrower-inspect.json](borrower-inspect.json), [peer-clean-failure-1.json](peer-clean-failure-1.json), [peer-clean-failure-2.json](peer-clean-failure-2.json), [peer-status-after-failure-1.json](peer-status-after-failure-1.json), [peer-status-after-failure-2.json](peer-status-after-failure-2.json), [peer-parent-after-failure-1.log](peer-parent-after-failure-1.log), [peer-snapshots-before-failure.log](peer-snapshots-before-failure.log), [peer-snapshots-after-failure-2.log](peer-snapshots-after-failure-2.log) |
| Retry after owner resolves use | pass | Guest removed only its exact borrower container. Clean then removed the anonymous volume and retired ownership. No store or snapshot repair was used. | [borrower-owner-resolution.log](borrower-owner-resolution.log), [peer-clean-retry.json](peer-clean-retry.json), [peer-anonymous-after-retry.log](peer-anonymous-after-retry.log), [peer-status-after-retry.json](peer-status-after-retry.json) |

Other findings: none observed.

**What worked:** Bundled docs and packaged skill gave enough information to create a correctly labelled Compose project. Status preserved exact child identities after parent removal. In-use deletion errors named the borrower and made the retained ownership understandable. Retry worked directly.

**Papercuts:** The initial guest fixture supplied `TILT_HOST` without `APP_HOST`, which configuration rejected clearly with `hosts must include APP_HOST`. Adding the field shown in the bundled example resolved it. This was fixture setup, not an observed product defect. No issue would have made this guest abandon the flow.

**Hesitations:** None after reading the bundled Tilt and troubleshooting references. Explicitly setting the Compose project name was essential and documented.

**Looks:** CLI-only run; JSON and error text were readable. No graphical surface was exercised.

**Trust:** These observations support confidence in the tested Compose cleanup boundary: implicit children are removed, explicit data stays, and an in-use child prevents release. They do not establish behavior for the excluded environments and races listed below.

**First fix:** No required fix emerged from these scenarios. Keep the exact in-use child and borrower diagnostics.

Resource audit and teardown:

- Host scratch retained for the parent's final audit: `/home/ae/Work/0xbigboss/alleneubank/boss-mobile-release-silo-impl-tmp/addendum5/guest`.
- Exact resource handles, teardown commands, and recorded service process handles: scratch `resources.txt`, also copied to [resources.txt](resources.txt). Recorded PIDs are also in [recorded-process-pids.txt](recorded-process-pids.txt); exact-PID final queries found them absent in [processes-final.log](processes-final.log).
- Disposable account view: scratch `account`; fixture roots: scratch `root-main` and `root-peer`, mounted as `/tmp/root-main` and `/tmp/root-peer` inside the supplied wrapper. Root project IDs: `6e6de392-5401-480c-b5c8-4abcc1807b2e` and `53828345-b79a-4026-abe9-cdb88b168cfe`.
- Guest Compose project names were `guest-g6401main` and `guest-g6401peer`; borrower was `guest-g6401-borrower` / `ff10d81701302312589ab69b176dc4b80e38b411e93e2924e3df8105d3ea7d07`.
- Both roots ended unallocated. All guest-created containers, networks, and volumes were removed, including the three external fixture volumes only after their preservation and data were observed. Exact-object final absence captures: [fixture-containers-final.log](fixture-containers-final.log), [fixture-networks-final.log](fixture-networks-final.log), [fixture-volumes-final.log](fixture-volumes-final.log). Snapshot absence: [snapshots-final.log](snapshots-final.log). Stores were left intact for audit. No process selector was used to signal anything.
- Candidate probe names recorded in the resource ledger were never created; reopening the actual silo root supplied the data readback instead.

Build: `/home/ae/Work/0xbigboss/alleneubank/boss-mobile-release-silo-impl/dist/cli.js`, executed as `/mnt/dist/cli.js` using Bun 1.4.4 through the supplied `guest-sandbox.sh`. Source head read from Git metadata: `a21f710896528aeaed5a6c142abc13a80895f1ba`. Build SHA-256: `40fd990ead9815f2f679b43e16eb65fc111fe0a798e08988e9a85667206e43a6`. See [source-head.log](source-head.log), [build-sha256.log](build-sha256.log). Real shared Linux Docker Engine 29.9.2, Compose v5.6.1, local `redis:7-alpine` image; no pulls, source edits, or rebuilds. Fixture configs and Tiltfiles are included beside these logs.

Not tried: arbitrary Tilt-managed replacement before capture, missing executor completion facts, inherited `volumes-from`, hostile local writers, native macOS, Kubernetes/k3d, production data, or other Docker engines. Named-volume preservation here covers explicitly supplied external named data; no claim is made about a distinct top-level owned Compose named-volume cleanup policy. No waiver was added.
