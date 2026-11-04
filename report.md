done

Addendum 5's local outcome is verified at executable source
`a21f710896528aeaed5a6c142abc13a80895f1ba`; CLI SHA-256
`40fd990ead9815f2f679b43e16eb65fc111fe0a798e08988e9a85667206e43a6`.
PR [#58](https://github.com/alleneubank/silo/pull/58) remains draft.
The coordinator still owns the offline proposal push, specialist round 3 of 3
and new native Mac qualification. At closeout, the final proposal head and exact push/body/response operations
will be written to `~/.handoffs/boss-mobile-release/silo-impl/pr-ops.md`.
No matching specialist approval or merge readiness is claimed.

The copied full example at 5d2c870 reproduces a product leak on Linux:
public `down --delete-cluster --clean` returns success and retires claims,
but Redis's image-declared anonymous `/data` volume remains. All four parents'
Mounts and image declarations were saved before deletion. Six k3d mounted
volumes disappear; Redis's seventh survives. The prior Linux six-volume audit
**did include image-declared anonymous volumes**: one named k3d image volume,
four k3s node children and one registry child. It did not include Redis.
No Docker/OrbStack-specific cause or ownership of the two historical Mac
volumes is inferred; those objects remain untouched.

The correction stores exact anonymous mount names, creation identities and
destinations inside immutable container receipts. Parent receipts survive
physical deletion. Clean deletes only recorded children; explicit cluster
deletion uses the same path rather than implicit Docker `--volumes` deletion.
Both retirement and forced replacement prove children absent. Explicit volume
sources and binds confer no child authority; inherited ambiguity refuses.
Used or replaced children keep claims. Failed child deletes retry before old
failed-request adjudication. No schema DDL/version migration, timeout change,
assertion relaxation or waiver was added.

Evidence: [anonymous-volume record](evidence/atomic-allocation/anonymous-volumes/README.md).

- Native regression fails first on the leaked volume at 5d2c870; final focused
  suite passes exact clean/repeat, retention/reallocation refusal, in-use
  refusal/retry after parent deletion, supplied-data preservation and replaced
  child identity refusal/recovery.
- At a21f710, all required gates pass: 130 Bun tests / 335 assertions,
  typecheck, lint, knip, jscpd (zero clones), build and normal commit hooks.
- Author drove the complete native Linux public-CLI all-suite at a21f710:
  the suite passes across 234 recorded commands, including expected refusals;
  all 17 final fixture cleanups exit zero. Real Janitor, Tilt,
  Docker and k3d; disposable native-account filesystem view, never the real
  account's store. Existing crash, peer, cutover, squatter, role-removal,
  file-alias and exact-k3d scenarios remain covered at the changed runtime.
- Author drove the copied full example at the same source/artifact: web/API
  deployments available; both health responses status ok; retained-k3d clean
  refuses with unchanged claims; explicit deletion removes all seven recorded
  mounted volumes, including Redis; final generation 0/claims empty.
- Fresh [guest](evidence/atomic-allocation/anonymous-volumes/guest/verdict-guest.md)
  is green at a21f710 / 40fd990e: real Compose/Redis, plain down retention,
  exact clean/repeat, peer preservation, two in-use failures with unchanged
  receipts/snapshot hashes/15 claims, successful retry, and reopened explicit
  Redis data readback. It did not inspect the implementation.
- [Closing audit](evidence/atomic-allocation/anonymous-volumes/audit.json):
  26 fixture projects across two disposable stores, every generation 0 and no
  operation; zero claims/active resource rows; 621 recorded PID/same-number
  group handles absent; 122 recorded object handles absent, including 59
  volume names. Candidate handles never created by the guest are only absence
  checks, not claimed creations. Shared caches and historical unattributed
  volumes are preserved.

The [fresh claim check](evidence/atomic-allocation/anonymous-volumes/verdict-claims.md)
supports these bounded observations with wording corrections applied; it is
separate from the pending specialist.

The first implementation's in-use retry ordering failed and was corrected;
original failure, recovery and fresh pass remain in the record. An initial
unused schema export failed knip and was made private before full gates.
The guest's initial fixture omitted APP_HOST and corrected it from bundled
docs. None of these failures is labelled pre-existing or flaky.

The broader plan basis is the reviewed r3/r5 design and human stop/recreate /
procedure-A decisions; addendum 5 directs this exact receipt-and-clean fix.
Threat model remains trusted local users/agents and cooperating tools on a
shared development host, accidental collision/deletion/crash, not hostile
local writers. Round-2 approval at fd710d9 is historical and does not qualify
this product change. The supplied native Mac 5d2c870 report passed its driven
scenarios but could not attribute two anonymous volumes; this Linux lane
neither deletes them nor claims Mac qualification of a21f710.

Not checked: matching specialist round 3, native Mac at this runtime,
case-sensitive APFS, final Intel/Apple Silicon/1.0.0 artifacts, new hosted CI,
actual host cutover, lost executor facts, arbitrary tool-managed transient
containers removed/recreated before creation-result capture, inherited
volumes-from, same-name/same-second replacement or alternate engines/drivers.
No waiver added. No Git network operation, credential change, merge, tag,
release, npm publication or real-project cutover ran here.

Intended semver remains **1.0.0**, with package/plugin still 0.9.0 and the
existing major changeset. Coordinator pushes only the proposal branch and
applies the prepared PR body/addendum-only response, retaining draft status.
After matching review/native qualification, merge still needs explicit owner
authority. Review Changesets' Release PR and version synchronization, qualify
its final artifacts, and obtain separate release approval: merging that Release
PR on main publishes npm through OIDC. Owner-led procedure A and stop/recreate
precede the first new host allocation; S1 adoption remains held.

Task-created dist and addendum5 scratch are cleanup targets after evidence
retention; pre-existing dependencies, hooks and parent scratch are preserved.
At closeout, final teardown and final-head actual local-bare hook push receipts
will be added to the handoff beside the final exact coordinator operations.
