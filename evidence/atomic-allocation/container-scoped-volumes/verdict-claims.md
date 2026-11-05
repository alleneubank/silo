# Claims verification

Supported within the records' stated local scope. The initial wording and
example-provenance findings are resolved. This is a fresh claims check
under the sitrep verification floor, not specialist round 4 or product approval.

Checked `report.md`, `pr-body.md`, `review-response-r3.md` and this directory's
`README.md` against retained raw outputs and read-only local state on
2026-11-05, initially approximately 03:11–03:17 UTC, then rechecked the corrected
records and new example evidence approximately 03:24–03:27 UTC. Repeated claims are grouped below.
The checker read no author sessions, used no network/GitHub tools, reran no
tests/builds, and mutated no Docker object, process, account store or Git ref.
Only this verdict was written.

## Recheck findings

No remaining correction-needed claim was found in the requested records.
The initial verdict remains in `verdict-claims-initial.md`.

1. **Remote state is qualified.** Report and README now describe actions by
   this lane and explicitly say live GitHub state was not queried. This check
   establishes current local refs, not remote merge/draft/publication state.
2. **Closeout remains future work.** The report explicitly says final proposal
   sealing/ref verification and scratch/build/dependency teardown will be
   recorded after the record commit. Current HEAD remains the runtime source;
   records are uncommitted and task scratch remains present. No final record
   commit, proposal-ref push or scratch teardown is claimed complete here.
3. **Historical focused greens are identified.** README now explicitly
   distinguishes earlier supporting runs' embedded digests from exact-candidate
   qualification in `all-final.log` at `90a44fcc…`. In particular,
   `retry-crash-green.log` is at `7019b9b1…`; the final all-suite repeats and
   passes that same real retry/crash case at `90a44fcc…`.
4. **Full-example provenance gap is closed.** Only the full example was rerun.
   `example-provenance-before.json` and `example-provenance-after.json`, also
   embedded in the new summary, bind the run at 03:20:45–03:21:24 UTC to clean
   runtime source `20997dc…` and artifact `90a44fcc…`. Raw results support CI,
   both health endpoints, exact seven-volume receipt accounting, retained named
   cache refusal/unchanged claims, separate owner resolution and final public
   retirement. Earlier example output is retained under `example-historical/`.
5. **Updated audit is verified.** The added run increases recorded-handle
   totals to 153 Docker handles and 1,086 PID/group numbers. The prior
   140/1,042 snapshot is preserved as `audit-pre-bound-example.json`, and its
   handle sets are included in the new audit. Independent live read-only
   checks again found no recorded handle present. Other, unrecorded Docker
   objects are present; the records correctly describe a scoped audit.

The existing fourth specialist review, corrected native Mac/APFS, final
release-artifact, owner-led cutover and release-decision holds remain. This
claims verdict waives none of them and is not release or merge approval.

## Verdict per material claim

Paths below are relative to this directory unless otherwise stated.

| Claim in the records | Verdict | Evidence and scope |
| --- | --- | --- |
| Runtime source is `20997dc740bd1df00c351cb4db6b4ba20734e47b` on `feat/atomic-allocation`; current CLI digest is `90a44fcc8641b959544e2cb9e9525d469b8749ea8abc680ababe87b7329e7e0f`. | supported | Read-only `git rev-parse HEAD`, branch query and independent `sha256sum dist/cli.js` agree with `source-head.txt` and `artifacts.txt`. Tracked working changes at check time are record/resource files, not runtime source. |
| This is a local proposal; this lane performed no merge/publication, and live GitHub state was not queried. | supported | The corrected wording scopes actions to the lane and expressly leaves live external state unverified. Lane negative-action statements remain attributed attestations; local refs do not establish remote PR status. |
| Final record-only SHA, final-ref hook push and scratch/build/dependency closeout receipts will be recorded after the record commit. | supported | These are explicitly deferred tasks, not completed actions. At recheck HEAD remains the runtime source; record files are modified/untracked and task scratch is present. No final-ref or teardown receipt is inferred. |
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
| Baseline real retry/crash fails; corrected final native case passes. | supported | `retry-crash-red.log` retains failed endpoint deletion, successful completion boundary and stranded cleanup. `all-final.log` records a real exit-1 network deletion, later durable exit-0 fact while the caller launch remains granted, then successful public recovery. Focused `retry-crash-green.log` is explicitly historical at another digest. |
| Narrow completion-import unit failed before the fix and passed afterward; it differs from the real executor fact case. | supported | `retry-red.log` reports the named unit failure; `retry-green.log` reports three passing cases. Retained test source explicitly injects a completion record. README discloses the injected boundary; final native retry/crash uses an actual executor completion. |
| Initial timestamp fixture missed its precondition; first volume and cache-disable failures remain disclosed. | supported | `same-second-precondition-failure.log` records different timestamp seconds. `volumes-green.log` actually fails with ALREADY_RUNNING. `all-suite.log` fails cache-disabled cluster creation. The records do not present these as candidate passes or pre-existing failures. |
| 132 Bun tests / 343 assertions; typecheck, lint, knip, zero-clone jscpd and build pass. | supported | `source-gates.log` retains all named outputs, including 132 pass / 0 fail / 343 expect calls and successful bundle output. This checker did not rerun them. Knip emits one configuration hint, not an error. |
| Normal source commit hooks pass; an actual local-bare source push runs every configured pre-push hook and receives exact source head. | supported | `commit-source.log` records successful lint/format/typecheck and commit `20997dc`. `local-bare-source-push.log` records successful test/knip/jscpd and ref update. Current `lefthook.yml` contains those three pre-push hooks. Independent read-only bare-ref lookup yields the full `20997dc…` SHA. This is not a final record-ref push or network push. |
| Native Bun/Janitor precede mise shims; pinned k3d checksum verified; disposable filesystem account views use real Docker. | supported | Retained run/sandbox wrappers specify absolute native tool directories before shim paths, account bind mounts and the local Docker socket. `environment.txt` identifies versions; `checksums-verified.log` records `bin/k3d: OK`. Current Docker engine ID matches the recorded engine. No system installation is evidenced by these wrappers. |
| Final all-suite passes across 339 recorded commands, including prior allocation and current volume/k3d/retry cases; 22 final fixture cleanup commands exit 0. | supported | Parsed all-final command IDs are exactly 1–339. Its 370 event rows equal `fixtures/allocation-rehearsal-HbHK2W/events.jsonl` byte-for-data after JSON parsing. Every command has retained stdout/stderr. Commands 318–339 are exactly 22 final public cleanup calls, all code 0. The total includes helper Docker/ps commands and expected refusals, not 339 successful CLI calls. |
| Full copied example CI and web/API health pass; all seven distinct mounted volumes are receipted; six anonymous names disappear and named cache refusal retains claims before owner resolution/retirement. | supported | `example-summary.json` / driver log report exit-0 CI and actual web/API health bodies. Four mount captures yield exactly the same seven-name set as before-status receipts. Raw command 12 lacks the six anonymous names; 13 still inspects the named cache. Before/retained claims match; command 10 gives CLEANUP_REQUIRED; command 15 gives generation 0/empty claims after separate owner removal. Health is through kubectl port-forward with Host headers; this does not establish every ingress route. |
| The current full-example run is bound to exact current runtime source/artifact. | supported | New before/after contemporaneous receipts both record source `20997dc…`, digest `90a44fcc…` and clean runtime source. They match their embedded copies in `example-summary.json`. Independent current HEAD/digest checks agree. Earlier unbound output is separately historical. |
| Fresh guest is green on the supplied source/current artifact for Redis CI, peer preservation, repeated clean, data readback, shared/orphan/replacement preservation and owner recovery. | supported | `guest/verdict-guest.md` records independent before/after artifact hashing and source head supplied by author. Raw captures show Redis lifecycle, `named-data`/`borrowed-data`/`replacement-data` readback and refusals/recovery. Peer before/after/final log bytes match; both claims pairs and replacement inspections match. Guest independence/no implementation or author-session reading is the guest's explicit attestation, not independently reconstructed here. |
| Guest's limits and ALREADY_RUNNING hesitation remain disclosed. | supported | Guest verdict explicitly excludes k3d, volumes-from, destructive crash/owner-loss, cutover/legacy, remote engines, concurrent launches and production; notes CLI-only design and mildly confusing retained-state label. No broader guest qualification is claimed. Initial APP_HOST setup output was overwritten; guest discloses that raw-capture gap. |
| Current author 20 and guest 5 records are generation 0, no claims/active resources/operations; failed archive is separate with one active generation, 24 claims and one historical active network row. | supported | Updated `audit.json`/`audit.log` and independent read-only SQLite queries at 03:26:27Z agree exactly. Failed archive has 25 total project records; its one active row is network `720fc4b7614c66d141bbb72fae6f0987b650177b12e0eb27c986f807608c9902`, physically absent. Persistent records are not deleted projects. |
| All 153 recorded Docker handles and 1,086 recorded numeric PID/group handles, including archived runs, are absent. | supported | Updated audit arrays contain those exact counts and include the complete prior 140/1,042 sets. Independent current complete Docker namespace enumeration on matching engine, with successful known-present bridge inspection, has no matching recorded handle. Current `ps -eo pid=,pgid=` has no matching recorded number in either column. This is scoped absence, not a host census, identity guarantee against future PID reuse, or teardown of task scratch. |
| Shared images/build caches, unrecorded objects and historical unattributed Mac volumes were preserved; private account/env/lock/kubeconfig files are excluded from committed evidence. | unverified | Retained exact-target ledgers and this directory's absence of private account/database/env/lock/kubeconfig files support the stated scope. There is no independent whole-host before/after inventory or Mac access, and the evidence commit has not occurred. This checker cannot certify those global negative actions or a future committed tree. |
| Round 2 approved with conditions, round 3 required changes; fourth review and Mac/final-artifact/cutover/release holds remain. | supported | Prior retained r2 verdict and current retained r3 verdict state those outcomes and limits. The records clearly do not claim matching round-4 approval or release readiness. Live GitHub review state remains unverified. |
| Intended release stays 1.0.0 via major changeset; package/plugin remain 0.9.0; proposal branch is not a release deployment trigger. | supported | Current package/plugin JSON are 0.9.0, changeset is major, and checked-in release workflow triggers main and invokes Changesets publish. This establishes repository configuration, not current hosted workflow/registry state. |
| No GitHub write/network push/merge/tag/release/npm publication, real host cutover, S1 adoption, production operation or credential mutation occurred in this lane. | unverified | Retained observed Git push is local-bare and supplied instructions assign external operations to the coordinator. A read-only claims check without author-session or service access cannot exhaustively prove all historical negative actions. Keep these as explicitly lane-attributed declarations; do not turn them into live external-state claims. |
| No stated onyx inotify/firewall limitation blocked the driven final scenarios; Mac/APFS/final architectures/hosted CI/other engines and interruption neighbors remain unqualified. | supported | Successful driven logs support only those scenarios; the records expressly retain the listed limits and do not infer a general host or release qualification. No new waiver is claimed by this check. |

## Live-state receipt

The latest independent read-only recheck at `2026-11-05T03:26:27.185677Z` observed:

| Store | Projects | Active generations | Claims | Active resources | Operations |
| --- | ---: | ---: | ---: | ---: | ---: |
| author | 20 | 0 | 0 | 0 | 0 |
| guest | 5 | 0 | 0 | 0 | 0 |
| failed no-image-volume archive | 25 | 1 | 24 | 1 | 0 |

Docker engine: `114f4194-e27d-4d0b-82fc-201ecd0e9997`.
Complete read-only enumeration returned 3 containers, 9 networks and 90 volumes;
the enumerated bridge was independently inspected successfully. Intersection
with the retained audit's 153 `(kind, handle)` pairs was empty. Intersection of
the 1,086 retained numbers with both live PID and PGID columns was empty.
No absent query was interpreted as proof without the successful namespace/control
checks. The failed archive's historical active network ID was included in that
empty Docker intersection.

No final-ref, scratch teardown, GitHub, production, Mac or release receipt is
created or implied by this verdict.
