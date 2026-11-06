# Claims verification

Corrections needed before publishing the records. The principal local results,
counts and scoped cleanup claims are supported. This is a fresh claims check
under the sitrep verification floor, not specialist round 4 or product approval.

Checked `report.md`, `pr-body.md`, `review-response-r3.md` and this directory's
`README.md` against retained raw outputs and read-only local state on
2026-11-05, approximately 03:11–03:17 UTC. Repeated claims are grouped below.
The checker read no author sessions, used no network/GitHub tools, reran no
tests/builds, and mutated no Docker object, process, account store or Git ref.
Only this verdict was written.

## Findings

1. **Qualify remote state.** `report.md` and `README.md` call the proposal
   “unmerged.” Current local HEAD and local refs are verified; live GitHub
   merge/draft/publication state is unavailable. Use “local proposal; live
   GitHub state was not queried” or attribute unmerged status to the supplied
   coordinator record. This check does not establish live remote status.
2. **Make pending closeout explicitly future tense.** The report says the
   final SHA/operations “are sealed … after commit” and final-ref verification
   and teardown “are recorded separately.” At check time the record changes
   remain uncommitted, the source-head local-bare ref is the only verified push,
   and scratch, `dist` and dependencies still exist. The coordinator's stated
   intent is clear, but “will be sealed/recorded after the record commit and
   teardown” avoids presenting future receipts as present evidence. No final
   record commit, proposal-ref push or scratch teardown is verified here.
3. **Keep historical green evidence distinct from final-artifact evidence.**
   `retry-crash-green.log` records artifact `7019b9b1…`, not `90a44fcc…`.
   The same real retry/crash case is rerun successfully in `all-final.log` at
   `90a44fcc…`, so the final candidate claim is supported by that latter run.
   The existing README cites both; readers must not treat the focused historical
   green log alone as exact-candidate qualification.
4. **Full-example behavior is captured; its exact run-time digest is not.**
   `example-driver.log`, `example-summary.json`, the raw command captures and
   retained driver establish the observed example result. They identify
   `/mnt/dist/cli.js` but contain no contemporaneous artifact digest or source
   head. The current bundle independently hashes correctly, and the final
   all-suite and guest independently identify that digest. Those facts do not
   by themselves prove which bytes the earlier example process loaded. Avoid
   claiming independently established exact-artifact provenance for that
   particular run unless another retained receipt supplies the missing link.

## Verdict per material claim

Paths below are relative to this directory unless otherwise stated.

| Claim in the records | Verdict | Evidence and scope |
| --- | --- | --- |
| Runtime source is `20997dc740bd1df00c351cb4db6b4ba20734e47b` on `feat/atomic-allocation`; current CLI digest is `90a44fcc8641b959544e2cb9e9525d469b8749ea8abc680ababe87b7329e7e0f`. | supported | Read-only `git rev-parse HEAD`, branch query and independent `sha256sum dist/cli.js` agree with `source-head.txt` and `artifacts.txt`. Tracked working changes at check time are record/resource files, not runtime source. |
| Proposal remains unmerged / remote PR is draft. | correction-needed | Remote state was not queried. Local state cannot prove this; see finding 1. Draft is a required coordinator action, not a verified GitHub state. |
| Final record-only SHA, final-ref hook push and scratch/build/dependency closeout receipts exist. | correction-needed | These are explicitly deferred tasks, not completed actions. At check time HEAD remains the runtime source; record files are modified/untracked and task scratch is present. See finding 2. |
| Human approved container-scoped removal on 2026-11-05 at 02:21Z and requested fourth review then macOS qualification. | supported | `approval-addendum-1.md` retains the decision and option wording. This is a retained coordinator-provided decision receipt, not a fresh independent interview with the human. |
| Built-in cleanup targets exact container/network IDs, removes Compose parents with anonymous volumes before Tilt teardown, and uses the same parent path for explicit k3d deletion. | supported | Current named cleanup functions and down/k3d call sites match the description; raw final parent-volume and k3d scenarios record the behavior. This is a factual correspondence check, not a new implementation safety review. |
| Built-in cleanup never directly deletes a volume by name; mount names are audit/leak evidence; named mounts survive. | supported | Current built-in deletion target type is container/network, and the emitted container removal includes `--force --volumes`. Final native and guest logs show named preservation and leak refusal. Fixture-owner `docker volume rm` commands are visibly separate. This claim is scoped to built-in cleanup, not arbitrary configured hooks/tools. |
| Surviving orphan/replacement names and retained named data block clean/force or reconfiguration with claims intact until independent owner resolution. | supported | Final shared/orphan/replacement scenario rows and their stdout/stderr; guest repeated clean/force captures; identical borrowed/replaced before/after claims; retained cache error and final resolved cleanup. |
| Inherited volumes-from provenance refuses before removal; Docker preserves a shared reference but can remove last-user inherited anonymous data. | supported | Final inherited scenario and raw Docker outputs distinguish shared and last-user behavior. Guest explicitly did not test volumes-from. The external documentation links were not fetched during this no-network check. |
| k3d 5.9.0 cache-disable experiment failed tools-node creation and was discarded; supported final configuration retains the named cache. | supported | `all-suite.log` records `failed to ensure tools node: Failed to find image volume` and failure, not pass. Final native/example commands succeed with the cache retained. This supports the tested pinned configuration; linked upstream source was not independently fetched. |
| Fixture-owner cache deletion is separate and uses recorded creation identity/project/generation. | supported | Retained example driver compares name, CreatedAt and project/generation labels before command 14; raw command 13 supplies those values. Product command 10 refuses; owner command 14 removes the cache; product command 15 retires. |
| Common recovery imports durable exact successful retries over earlier matching completed failures, never a later failure. | supported | Current common reconciliation rule, added unit outcomes, final real retry/crash scenario and final retirement output agree. No broader interruption guarantee is inferred. |
| No schema migration, weakened existing unit assertion or new waiver was added by this change. | supported | `fff3083..20997dc` diff retains existing unit assertions and adds the two recovery cases; schema definitions are unchanged by this delta. Records explicitly retain the external holds and state no new waiver. This is scoped to the inspected delta. |
| Baseline `fff3083` / `40fd990e…` fails same-second replacement. | supported | `same-second-red.log` plus fixture `allocation-rehearsal-0v7nRz`: original/replacement raw inspections both give `2026-11-05T02:31:57Z`; baseline clean exits 0, retires and final listing lacks the replacement. Baseline artifact independently hashes to `40fd990e…`; prior r3 verdict records the source/digest mapping. |
| Baseline fails paused post-inspection replacement and parent removal before later Tilt failure. | supported | `paused-delete-red.log` / `allocation-rehearsal-fANCVU` show replacement creation followed by successful baseline retirement and missing replacement; `parent-volumes-red.log` / `allocation-rehearsal-UKjEst` show failed teardown followed by successful inspection of the still-present parent. |
| Baseline real retry/crash fails; corrected final native case passes. | supported | `retry-crash-red.log` retains failed endpoint deletion, successful completion boundary and stranded cleanup. `all-final.log` records a real exit-1 network deletion, later durable exit-0 fact while the caller launch remains granted, then successful public recovery. Focused `retry-crash-green.log` is historical at another digest; see finding 3. |
| Narrow completion-import unit failed before the fix and passed afterward; it differs from the real executor fact case. | supported | `retry-red.log` reports the named unit failure; `retry-green.log` reports three passing cases. Retained test source explicitly injects a completion record. README discloses the injected boundary; final native retry/crash uses an actual executor completion. |
| Initial timestamp fixture missed its precondition; first volume and cache-disable failures remain disclosed. | supported | `same-second-precondition-failure.log` records different timestamp seconds. `volumes-green.log` actually fails with ALREADY_RUNNING. `all-suite.log` fails cache-disabled cluster creation. The records do not present these as candidate passes or pre-existing failures. |
| 132 Bun tests / 343 assertions; typecheck, lint, knip, zero-clone jscpd and build pass. | supported | `source-gates.log` retains all named outputs, including 132 pass / 0 fail / 343 expect calls and successful bundle output. This checker did not rerun them. Knip emits one configuration hint, not an error. |
| Normal source commit hooks pass; an actual local-bare source push runs every configured pre-push hook and receives exact source head. | supported | `commit-source.log` records successful lint/format/typecheck and commit `20997dc`. `local-bare-source-push.log` records successful test/knip/jscpd and ref update. Current `lefthook.yml` contains those three pre-push hooks. Independent read-only bare-ref lookup yields the full `20997dc…` SHA. This is not a final record-ref push or network push. |
| Native Bun/Janitor precede mise shims; pinned k3d checksum verified; disposable filesystem account views use real Docker. | supported | Retained run/sandbox wrappers specify absolute native tool directories before shim paths, account bind mounts and the local Docker socket. `environment.txt` identifies versions; `checksums-verified.log` records `bin/k3d: OK`. Current Docker engine ID matches the recorded engine. No system installation is evidenced by these wrappers. |
| Final all-suite passes across 339 recorded commands, including prior allocation and current volume/k3d/retry cases; 22 final fixture cleanup commands exit 0. | supported | Parsed all-final command IDs are exactly 1–339. Its 370 event rows equal `fixtures/allocation-rehearsal-HbHK2W/events.jsonl` byte-for-data after JSON parsing. Every command has retained stdout/stderr. Commands 318–339 are exactly 22 final public cleanup calls, all code 0. The total includes helper Docker/ps commands and expected refusals, not 339 successful CLI calls. |
| Full copied example CI and web/API health pass; all seven distinct mounted volumes are receipted; six anonymous names disappear and named cache refusal retains claims before owner resolution/retirement. | supported | `example-summary.json` / driver log report exit-0 CI and actual web/API health bodies. Four mount captures yield exactly the same seven-name set as before-status receipts. Raw command 12 lacks the six anonymous names; 13 still inspects the named cache. Before/retained claims match; command 10 gives CLEANUP_REQUIRED; command 15 gives generation 0/empty claims after separate owner removal. Health is through kubectl port-forward with Host headers; this does not establish every ingress route. |
| That particular earlier full-example run is independently bound to exact current runtime source/artifact. | unverified | No contemporaneous digest/head in its raw driver/summary captures; see finding 4. Its observed behavior remains supported. |
| Fresh guest is green on the supplied source/current artifact for Redis CI, peer preservation, repeated clean, data readback, shared/orphan/replacement preservation and owner recovery. | supported | `guest/verdict-guest.md` records independent before/after artifact hashing and source head supplied by author. Raw captures show Redis lifecycle, `named-data`/`borrowed-data`/`replacement-data` readback and refusals/recovery. Peer before/after/final log bytes match; both claims pairs and replacement inspections match. Guest independence/no implementation or author-session reading is the guest's explicit attestation, not independently reconstructed here. |
| Guest's limits and ALREADY_RUNNING hesitation remain disclosed. | supported | Guest verdict explicitly excludes k3d, volumes-from, destructive crash/owner-loss, cutover/legacy, remote engines, concurrent launches and production; notes CLI-only design and mildly confusing retained-state label. No broader guest qualification is claimed. Initial APP_HOST setup output was overwritten; guest discloses that raw-capture gap. |
| Current author 20 and guest 5 records are generation 0, no claims/active resources/operations; failed archive is separate with one active generation, 24 claims and one historical active network row. | supported | `audit.json`/`audit.log` and independent read-only SQLite queries at 03:15:15Z agree exactly. Failed archive has 25 total project records; its one active row is network `720fc4b7614c66d141bbb72fae6f0987b650177b12e0eb27c986f807608c9902`, physically absent. Persistent records are not deleted projects. |
| All 140 recorded Docker handles and 1,042 recorded numeric PID/group handles, including archived runs, are absent. | supported | Audit arrays contain those exact counts. Independent current complete Docker namespace enumeration on matching engine, with successful known-present bridge inspection, has no matching recorded handle. Current `ps -eo pid=,pgid=` has no matching recorded number in either column. This is scoped absence, not a host census, identity guarantee against future PID reuse, or teardown of task scratch. |
| Shared images/build caches, unrecorded objects and historical unattributed Mac volumes were preserved; private account/env/lock/kubeconfig files are excluded from committed evidence. | unverified | Retained exact-target ledgers and this directory's absence of private account/database/env/lock/kubeconfig files support the stated scope. There is no independent whole-host before/after inventory or Mac access, and the evidence commit has not occurred. This checker cannot certify those global negative actions or a future committed tree. |
| Round 2 approved with conditions, round 3 required changes; fourth review and Mac/final-artifact/cutover/release holds remain. | supported | Prior retained r2 verdict and current retained r3 verdict state those outcomes and limits. The records clearly do not claim matching round-4 approval or release readiness. Live GitHub review state remains unverified. |
| Intended release stays 1.0.0 via major changeset; package/plugin remain 0.9.0; proposal branch is not a release deployment trigger. | supported | Current package/plugin JSON are 0.9.0, changeset is major, and checked-in release workflow triggers main and invokes Changesets publish. This establishes repository configuration, not current hosted workflow/registry state. |
| No GitHub write/network push/merge/tag/release/npm publication, real host cutover, S1 adoption, production operation or credential mutation occurred in this lane. | unverified | Retained observed Git push is local-bare and supplied instructions assign external operations to the coordinator. A read-only claims check without author-session or service access cannot exhaustively prove all historical negative actions. Keep these as explicitly lane-attributed declarations; do not turn them into live external-state claims. |
| No stated onyx inotify/firewall limitation blocked the driven final scenarios; Mac/APFS/final architectures/hosted CI/other engines and interruption neighbors remain unqualified. | supported | Successful driven logs support only those scenarios; the records expressly retain the listed limits and do not infer a general host or release qualification. No new waiver is claimed by this check. |

## Live-state receipt

The independent read-only recheck at `2026-11-05T03:15:15.627269Z` observed:

| Store | Projects | Active generations | Claims | Active resources | Operations |
| --- | ---: | ---: | ---: | ---: | ---: |
| author | 20 | 0 | 0 | 0 | 0 |
| guest | 5 | 0 | 0 | 0 | 0 |
| failed no-image-volume archive | 25 | 1 | 24 | 1 | 0 |

Docker engine: `114f4194-e27d-4d0b-82fc-201ecd0e9997`.
Complete read-only enumeration returned 0 containers, 8 networks and 89 volumes;
the enumerated bridge was independently inspected successfully. Intersection
with the retained audit's 140 `(kind, handle)` pairs was empty. Intersection of
the 1,042 retained numbers with both live PID and PGID columns was empty.
No absent query was interpreted as proof without the successful namespace/control
checks. The failed archive's historical active network ID was included in that
empty Docker intersection.

No final-ref, scratch teardown, GitHub, production, Mac or release receipt is
created or implied by this verdict.
