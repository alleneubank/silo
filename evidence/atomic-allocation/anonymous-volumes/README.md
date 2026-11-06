# Anonymous service-volume cleanup

Executable source: `a21f710896528aeaed5a6c142abc13a80895f1ba`.
Built CLI SHA-256:
`40fd990ead9815f2f679b43e16eb65fc111fe0a798e08988e9a85667206e43a6`.
Author: silo-impl on ae-dev Linux x86_64, native Docker 29.9.2 / Compose 5.6.1,
k3d 5.9.0 / k3s 1.35.5-k3s1, Tilt 0.37.8 fork, Bun 1.4.4 / SQLite 3.53.4,
Janitor 0.3.1. [Environment](environment.txt), [head](rehearsal-head.txt),
[artifact](artifact-sha256.txt), [gates](gates.log), [commit hooks](commit-code.log).
The disposable native-account filesystem view is [recorded](sandbox.sh.txt);
the real account store was never used.

## Finding and prior audit scope

**Supported product defect, reproduced on Linux at 5d2c870.** The unmodified
copied full example reached successful CI. Its public `down --delete-cluster
--clean` exited zero and retired the generation, but Redis's anonymous `/data`
volume remained. Each of four parent containers' Mounts and image volume
declarations were captured before teardown. Seven distinct mounted volumes
were present: one named k3d image volume, four k3s node anonymous children,
one registry anonymous child, and one Redis anonymous child. The first six
were absent after public clean; Redis's remained. No macOS/OrbStack-specific
cause is required to explain that class.

The prior [six-volume audit](../crash-completion/audit.json) included
image-declared anonymous volumes: the named k3d images volume plus four node
children and one registry child. It did **not** include Redis. The script
captured only the backend fixture's k3d mounts. Its scoped absence statement
remains valid; it did not establish complete copied-example child cleanup.

Baseline evidence: [summary](baseline-summary.json),
[all parent/image/Mounts snapshots](baseline-all-mounts.json),
[Redis mount](baseline-redis-mounts.json), [volume identity](baseline-redis-volume.json),
[successful public clean](baseline-clean.json),
[post-clean leaked identity](baseline-leaked-volume.json),
[before](baseline-volumes-before.jsonl) and [after](baseline-volumes-after.jsonl)
volume enumerations. Its leaked volume was subsequently removed only after
exact saved-identity comparison and checking every current container's Mounts:
[owned fixture cleanup](baseline-exact-cleanup.json). Historical unattributed
Mac or Linux volumes were preserved.

Docker documents that anonymous volumes persist independently of containers;
[Compose down](https://docs.docker.com/reference/cli/docker/compose/down/)
requires an explicit volumes option, while
[container rm --volumes](https://docs.docker.com/reference/cli/docker/container/rm/)
removes anonymous children. Plain `tilt down` was the Compose path; exact k3d
container removal formerly used Docker's implicit `--volumes` path. Native
Linux evidence establishes the defect without inferring the exact ownership
of the two historical Mac volumes.

## Contract and construction

The directive in addendum 5 authorizes the receipt-and-exact-clean correction;
the broader plan basis remains the reviewed r3/r5 allocation design and human
stop/recreate/procedure-A decisions. Threat model: trusted local users/agents,
config and installed tools on a shared development host; accidental collision,
delete, crash and squatter errors, not a malicious local attacker.

A container receipt contains a bounded, typed immutable `anonymousVolumes`
array: exact child name, creation time and mount destination. Capture requires
a source-less mount and Docker's anonymous label. Explicit bind/volume sources
are excluded; ambiguous inherited provenance refuses. Parent receipts persist
in the generation journal after physical parent deletion. Child deletion runs
through the existing gated, durable exact-command path, without force/prune.
It checks engine and child identity and re-enumerates afterward. A used child
refuses. Clean retries child deletion before adjudicating old failed deletion
receipts. Both retirement and forced replacement check every historical
parent's recorded children before claims or snapshots can disappear. k3d uses
the same exact child path rather than implicit `docker rm --volumes`.

No database DDL/version migration, timeout, assertion relaxation or waiver was
added. Receipt shape belongs to this still-unreleased allocation proposal.
The public state/caller contract is recorded in SPEC.md, troubleshooting,
packaged skill and the major changeset.

## Author observations

| Scenario | Surface and observation | Evidence |
| --- | --- | --- |
| Red first | Built 5d2c870, actual native Docker Redis, public clean succeeds but the regression asserts the exact leaked `/data` volume is absent and fails | [red](regression-red.log) |
| Exact child clean and repeat | Native public CI captures Redis child; clean removes it; generation 0 and repeated clean `changed:false` | [final focused suite](identity-and-retry.log) |
| Plain down / forced replacement | Parent is deleted, anonymous child and historical receipt remain; force/profile reallocation refuses with identical claims | focused suite; all-suite |
| In-use child / retry | Another exact fixture container uses the child; clean fails without deleting/signalling that borrower and retains claims. After the owner removes the borrower, retry succeeds despite the original parent's absence | focused suite; all-suite |
| Supplied data preserved | Explicit named and borrowed anonymous mounts are excluded from child authority; both snapshots and donor container remain unchanged | focused suite; all-suite |
| Replacement identity | A fixture volume at the old name but different creation time refuses NAME_CONFLICT with claims/replacement intact; after exact owner removal, absent-child clean retires | focused suite; all-suite |
| Complete Linux rehearsal | Suite passes across 234 recorded command invocations, including expected refusals; all 17 final cleanup commands exit zero; includes previous crash/peer/squatter/cutover/alias/k3d/role-removal scenarios plus the new volume cases | [all-suite](all-suite.log), [raw command/status evidence](rehearsal/events.jsonl) |
| Copied full example | At a21f710 both web/API deployments become available and both health endpoints return status ok. Clean refuses retained k3d; explicit deletion then removes all seven recorded mount volumes, including Redis; generation 0/claims empty | [author run](example-fixed.log), [commands](example-fixed/commands.jsonl), [parents and mounts](example-fixed/parent-mounts.json), [removed handles](example-fixed/removed-mounts.json), [final status](example-fixed/status-after.json) |
| Required gates | 130 Bun tests / 335 assertions / zero failures; typecheck, lint, knip, jscpd (zero clones), build and normal commit hooks | gates.log; commit-code.log |

The first implementation of this correction exposed an in-use retry-ordering
error: unresolved-request adjudication ran before the retry. Its original
[failure](retention-and-peer.log), [recovery](retry-ordering-recovery.json) and
[corrected run](retention-and-peer-fixed.log) are retained. This is not a
pre-existing or flaky failure. The initial unused schema export also failed
knip; the export was made private and the full gates then passed. One full node inspection initially included
an ephemeral k3d bootstrap token. Its exact fixture cluster was destroyed by
public clean; that raw capture was replaced with an identity/mount projection
before committing, and the retained one-off driver now applies that projection.
No token-bearing raw capture is retained.
The first simple green run predates the final retry correction; only the final
focused/all-suite runs qualify the final source. Earlier observations are
retained as investigation evidence, not substituted for final verification.

The full-example [one-off driver](example-probe.ts.txt) used real vendor tools
and public CLI commands. It introduced no production test hook. The final
all-suite retains stdout/stderr for every command; no kubeconfig private-key
file or generated account state is committed.

## Reviews and remaining qualification

The fresh [guest verdict](guest/verdict-guest.md) is **green** at a21f710 /
40fd990e. It independently drove real Compose/Redis retention, clean/repeat,
peer preservation, two in-use failures with unchanged claims/receipts/snapshot
hashes, successful retry and explicit-volume Redis data readback after reopening.
The [closing audit](audit.json) finds 26 retired projects across two disposable
stores, zero claims/active resource rows, all 621 recorded PID/group handles
absent and all 122 recorded object handles absent (59 volume names). Some guest
candidate handles were never created; these counts are absence checks, not
creation counts. The [actual local-bare source push](local-bare-source.log)
passes all pre-push hooks and the [received ref](local-bare-source-ref.txt)
is exactly a21f710. At closeout, a final-head records-only push receipt and scoped scratch /
dist removal receipt will be retained in the coordinator handoff directory. The [fresh claim check](verdict-claims.md) supports the bounded observations
with corrected wording and explicitly leaves source correctness to the specialist.
Specialist round 3 of 3 is coordinator-owned and **pending**;
the round-2 fd710d9 verdict does not approve this changed runtime. Keep PR #58
draft. The supplied native Mac 5d2c870 report passed its scenarios but could
not attribute/remove two new anonymous volumes. It does not qualify a21f710.
The updated [Mac runbook](../../../macos-rehearsal.md) includes the volume
suite and copied-example Mounts/receipt enumeration and exact absence checks.

Not checked: native macOS at this runtime; case-sensitive APFS; Intel/Apple
Silicon or final versioned 1.0.0 artifacts; real cutover; arbitrary tool-managed
transient containers removed/recreated before creation-result capture;
inherited volumes-from; missing executor facts; hostile writers or same-name,
same-second volume replacement; alternate engines/drivers. Trusted tools must
cooperate; Silo does not intercept every Docker creation event. No ownership
claim or deletion is made for historical unreceipted volumes. No waiver added.
No Git network operation, merge, release, tag, npm publication, credential
change or real-project cutover ran in this lane.
