# Fresh claims check, round 5 evidence

Green after the staged wording corrections described below. The inspected
source, run counts, scenario outcomes and scoped closeout evidence support the
substantive Linux claims. This is a fact-check, not specialist approval or
permission to publish.

## Basis

Read-only review on 2026-11-06, ending after 01:38 UTC, of the Git index at
HEAD `77e3d68f9b8dffff2aec9c31bc2833349c36c3f3`. Runtime source is
`d9628d1fe8ec47ca401998e35a8786a85bb0ebe6`; its descendants through HEAD change
only `scripts/allocation-rehearsal.ts`. Independent `sha256sum dist/cli.js`
matches `b14266a4564fa89dd7440d5cce5de08f51dd587173a9b3ee475b49b2743c2e53`.
All eight requested documents are indexed, and had no unstaged difference when
read. The new recorded-ID folder contains 2,100 indexed paths before this
verdict. Its evidence is staged, not present in the reviewed HEAD commit.

Inspected the requested staged prose, relevant current source, the prior
specialist verdict, raw red/final/failed logs, per-command outputs, example
provenance and responses, guest verdict/logs, audit inputs/output, workflow and
hook configuration, actual local-bare ref, and disposable stores with read-only
SQLite queries. Human scope/date/lease were corroborated against the durable
`/home/ae/.handoffs/boss-mobile-release/silo-redesign/addendum-6.md`, without
reading sessions. The amended index was re-read before finalizing; the current
blob prefixes are PR body `c6a7fc9`, report `7b6f836`, PR ops `f9a0603`, response
`a1f82b6`, specialist request `da501a1`, Mac request `16be20b`, new README
`c181450`, historical README `fc29bc9`.
No tests, product mutations, network writes, GitHub queries,
process signals, Docker deletion or production Kubernetes inspection occurred.

## Corrections folded into the final staged text

1. **Staged is not committed.** The initial historical README qualification said
   the raw logs were "now committed unchanged"; the initial
   `review-response-r4.md` said "those existing logs are committed without
   reconstruction". At this review
   basis they are additions in the index. `git ls-tree` at `a7359a45` contains
   none of the historical folder's `.log` files. The cited red, focused green,
   full-suite, gates, commit and push logs now have index entries, and the staged
   `.gitignore` exception overrides the global log ignore.

   Both now say the logs are included in this evidence set, without claiming a
   completed commit. A later evidence commit can establish
   committed membership. This review establishes current contents/membership,
   not historical byte identity of files that were never in that old tree;
   "unchanged/without reconstruction" remains author provenance testimony.

2. **The final seal is future work.** The initial new README said "The final proposal
   ref and network push result are sealed in the coordinator handoff
   `pr-ops.md`". The inspected `pr-ops.md` instead says the head/result will be
   sealed after evidence work; `report.md` expressly says push is pending.

   The amended README now correctly says the final proposal ref and network
   result will be sealed in the coordinator handoff. The local-bare push is a separate, completed hook
   rehearsal and does not establish an origin push.

3. **Keep the hosted citation prospective until its publication is recorded.**
   The GitHub branch README link in `pr-body.md` has a matching indexed local
   target, but the new folder is not in HEAD and the feature push is pending.
   Its current hosted reachability is unverified. The amended PR body explicitly
   labels it the intended publication target and states that evidence is local
   until push and hosted reachability was not queried. The actual pushed ref
   remains a final-handoff obligation. No assertion that the URL currently
   returns an error is made.

4. **Time-bound numeric-handle absence.** The amended closeout sentences in the
   PR body, report and new README now anchor their 150 Docker / 1,252 numeric
   handle absence to audit timestamp 2026-11-06T01:30:43.963Z.
   Those are recorded observations; numeric
   process handles may later be reused. `audit-final-group.txt` separately
   checks the auditor leader after its wait. Later hooks/pushes and scratch
   closeout are correctly left to the final handoff. This review did not rerun
   the Docker/process census and makes no current host-wide absence claim.

## Per-claim verdicts

The following verdicts apply to each occurrence of the listed claim in the
requested documents. Paths without a prefix below are in this evidence folder.

| Claim / location | Verdict and evidence |
| --- | --- |
| Runtime head, final harness head and CLI digest in PR/report/requests/README | Supported. Actual refs exist; `git diff d9628d1 HEAD` affects only the rehearsal; independent live digest, `source-head.txt`, `artifact.txt`, and example before/after receipts agree. Record-only descendants are a proposed evidence-reuse rule, not existing additional commits at this basis. |
| Human recorded-ID choice on 2026-11-05; round 5 then Mac; feature push with exact a7359a45 lease | Supported by durable addendum 6. Its own document date is November 6, while its quoted human decision is November 5. No new approval or wider publish grant is established. |
| Round 4 required changes at a7359a45 and rejected delegated cleanup/missing logs | Supported by retained `verdict-specialist-r4.md`; its reviewed source/digest and findings match the named historical refs. The historical README qualification correctly preserves that rejection, subject to finding 1. |
| Recorded process stops, full container/network IDs, no teardown delegation or cleanup adoption | Supported by inspected construction in `src/commands/down.ts`, `src/core/owned_command.ts`, `src/backends/ownership.ts`, `src/backends/k3d.ts` and `src/core/lease_types.ts`. Down has no Tilt/hook/capture executor import. The removal branch excludes volume receipts and consumes validated branded 64-hex IDs. This is a source guarantee under the stated trusted-tool/config threat model, not proof against hostile binaries or delayed external effects. |
| Parent-scoped anonymous deletion; named/orphaned/replaced data and uncertainty retain claims | Supported by the exact-ID `--force --volumes` removal leaf, receipt tombstones/leak proof, retained-volume clean refusal, and final volume scenarios. Volume names are audit identities, not removal arguments. This does not grant authority over arbitrary unreceipted data or prove all daemon interleavings. |
| Teardown hooks rejected, including profiles; changed Tiltfile ignored | Supported by strict shared hook schema in `src/core/config.ts`, down's call path, and guest hook/Redis logs. Both selected and unselected profile cases are captured. Startup hooks and arbitrary trusted startup code remain outside that restriction. |
| Kubernetes remains with retained cluster; explicit cluster deletion uses recorded IDs | Supported by source: ordinary down omits `deleteCluster`; explicit deletion calls exact container/network leaf. Observed retention is specifically two ready example deployments on the recorded Linux engine, with `example-16.stdout` showing ready replicas. It is not general external-Kubernetes qualification. |
| Durable successful delete retry reconciles earlier matching failures after caller death | Supported by `ProjectOperation.applyCompletions`/`reconcileDeletion`, passing unit output and final retry-crash scenario. Row ordering limits which prior failures a success resolves. Lost completion facts remain an expressly untested/refused boundary. |
| 139 tests / 356 assertions, typecheck, lint, knip, zero duplicate blocks, build | Supported by staged `source-gates.log`, including exact test totals and successful build. There is a nonfatal knip configuration hint; no failure is hidden. These checks were inspected, not independently rerun by this reviewer. |
| Normal commit hooks and real local-bare pre-push hooks | Supported by `commit-source.log`, follow-up commit logs and `local-bare-qualified-push.log`; all configured pre-push commands complete. Actual read-only `git --git-dir=.../r5/hook-push.git rev-parse refs/heads/rehearsal` returns 77e3d68, matching `local-bare-qualified-ref.txt`. No origin result follows from it. |
| Baseline real Compose race deletes Q, leaves W, releases claims | Supported by raw `compose-replacement-red.log`: pause reached, resumed exit 0, replacement absent, volume present, claims empty, then preservation assertion fails. Baseline digest 90a44fcc matches the historical artifact record. |
| Corrected race preserves Q/W/data/claims and refuses, then owner resolution permits retirement | Supported by final VMowsW raw events/outputs: resumed exit 1 with a real network-active-endpoint error, Q/W preserved, claims unchanged, data readback, exact fixture-owner removal and successful public recovery. Wrapper, `parent-removed` and `resume-cleanup` files are indexed. This observed refusal uses Docker's network endpoint boundary; it does not establish every possible transient replacement schedule. |
| Matching unreceipted Compose object at cleanup entry is not adopted | Supported by final author scenario and two guest refusals, unchanged inspect/status captures, empty resource receipts and exact fixture-owner recovery. The public guest refusal is CLEANUP_REQUIRED; the inherited failed-capture case is NAME_CONFLICT. The records distinguish these. |
| Full all-suite: 371 commands, 24 final cleanup commands all zero | Supported by raw `all-final.log` and `rehearsal-summary.json`; final cleanup entries 348–371 are 24 zero exits. The suite intentionally includes expected refusals/nonzero commands; "all-suite passes" does not mean every one of the 371 commands exits zero. Named legacy/cutover, file, peer/crash, k3d, volume and retry cases are present. |
| Copied full example CI/health, provenance, physical parent removal, retained ready Kubernetes, six anonymous mounts gone, cache refusal/owner recovery | Supported by `example-summary.json`, both source/digest provenance files, mount captures and raw command outputs. CI exit 0; web/API health bodies present; exact Compose inspect fails after down; two deployments remain ready; cluster clean initially returns CLEANUP_REQUIRED for named cache; fixture owner removes that cache; final public clean reaches generation 0. Six anonymous mounts and named cache are differentiated. |
| Fresh guest green on the same bundle | Supported by `guest/verdict-guest.md`, its digest receipt and raw logs for mandatory Redis/data, failing Tiltfile, repeat, own/peer listener, foreign-object refusal/recovery and base/profile hook cases. Guest states it did not read implementation/diff/author evidence. That independence statement is guest testimony, not independently observable here. Guest explicitly did not test the replacement race or Kubernetes. |
| Failed inherited and timestamp probes were harness corrections, preservation assertions retained | Supported by failed raw logs and actual two follow-up rehearsal diffs: inherited error expectation changes to NAME_CONFLICT; reverse fixture cleanup; timestamp setup precedes durable receipt write; equality and data/claims assertions remain. Final same-second original/replacement timestamps match. No corresponding runtime repair exists after d9628d1. |
| Initial copied-example error confused receipt history with physical presence | Supported by first-probe evidence, corrected exact-ID outputs and successful repeated example. This is not presented as runtime failure. Recovery launcher failure and subsequent successful file recovery are retained. |
| Guest live port delayed inherited retirement, author did not stop it | Guest logs identify peer Tilt port 49155 and its owner-driven retirement; `inherited-retire-after-guest.log` records successful later retirement. The README correctly leaves the first 49154 occupant unidentified. Absence of author signaling outside recorded evidence is author testimony, not a host-wide audit. |
| Author54/guest4 projects generation0, zero claims/active resources/operations | Supported by `audit.json` and independently repeated read-only SQLite counts against both disposable stores during this review. |
| Docker150/PID1252 absent; auditor later absent | Supported as time-stamped recorded audit observations by `audit.json`, archived audit logic and `audit-final-group.txt`, subject to finding 4. The audit explicitly excludes its active group before the later check and has empty remaining sets. No production or host-wide absence follows. |
| Historical cited logs restored despite global ignore; current evidence indexed | Supported for current index membership. Global excludes configuration points to `~/.gitignore_global`; repository exception selects evidence logs. Missing historical cited files are absent at a7359a45 and now indexed. Historic byte preservation is qualified in finding 1. |
| 1.0.0 intended major release; current versions 0.9.0; no migration/mixed allocators | Supported by major changeset, package/plugin version files and SPEC cutover contract. Legacy overlap controls demonstrate the old-client exclusion; they do not prove real owner-led cutover. |
| Feature push proposal; main Changesets workflow can publish npm | Supported by local `.github/workflows/{ci,e2e-example,release}.yml`: CI/example have PR events and main pushes; release has main push and Changesets publish. No hosted pipeline run or service state was queried. |
| PR58 is unmerged draft; remote push pending; no matching approval/native Mac | Remote pending and approval/Mac omissions are the supplied task basis and are consistently described as pending. PR58 is a standing pointer only; current draft/merge state is unverified. Prefer "standing draft-PR pointer; live state not queried" when restating it. |
| Native Mac request prerequisites and review order | Consistent with addendum 6 and Linux evidence limits. `macos-request.md` describes future work, explicitly requires its own digest and prohibits historical-volume cleanup authority. It makes no claim that Mac or final artifacts passed. |
| No merge/release/cutover/S1 adoption/new waiver; preserved unrelated/Mac resources | No such action or new waiver is evidenced in the inspected task delta. These are scope/author-operation statements, not a live global operations audit. Existing exclusions and pending specialist/Mac/final-artifact gates remain necessary. |

No missing local target was found among the cited new summaries, raw race and
failed logs, provenance, guest verdict/logs, audit records or hook receipts.
Publication-state corrections are folded into the staged authored records; the
final handoff must separately establish its exact committed/pushed ref and closeout.
This verdict does not qualify hosted CI, native Mac/APFS/account/process/fsync,
final 1.0.0 binaries, production cutover, hostile same-account code, arbitrary
transient/delayed producer effects, alternate engines or every crash boundary.
