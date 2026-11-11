# Round-6 response

The round-6 approve-with-conditions verdict at 6c942863 has no blocking finding.
Addendum 8 directs the two author fixes without changing the recorded-ID-only
human boundary. All three distinguishing checks were reproduced first on the
exact 4c50596b bundle: public cleanup at 1023 records hit STORE_FULL; a real
API-port squatter left k3d outputs unrecorded; a real overlapping-IPAM network
create left an unreconciled known failure. Only individually recorded synthetic
objects were removed by the fixture owner. The failed-create metadata is retained
for a same-store public recovery check, not replaced with an empty store.

1. Supported: the launch cap could wedge exact cleanup. At capacity, only terminal
   reconciled launches and their completion facts are compacted transactionally.
   Unresolved facts and resource/mount history remain. This preserves the bound
   while removing completed history as a cause of cleanup failure. Native
   --suite producers drives two live receipts with 1023 prior records. The unit
   test preserves a started, uncaptured failed create through compaction
   and still requires retirement refusal. Exhaustion entirely by unresolved facts
   remains a safe STORE_FULL boundary, not an unlimited retry guarantee.
2. Supported: failed finished producers had inconsistent capture boundaries.
   Every finite production caller now uses runProducerCommand for create, hook or
   workload effects. The generic nonproducer runner's type only permits none or
   delete. The shared producer boundary records a known completion, proves terminal
   groups, captures labelled outputs (or complete absence), seals reconciliation,
   then reports failure. Down uses the same boundary for imported completions and
   stopped live Tilt. Direct creators operate in k3d's namespace; hooks/workloads
   also use existing Compose root/launch provenance. No teardown authority changes.
3. Capture-time hypothesis: unchanged. A producer whose capture fails remains
   pending under the accepted provenance, and no deletion starts. No Docker/host
   clock agreement was established to add the proposed timestamp bound. This
   neighbor remains explicitly unqualified; no new security guarantee is claimed.
4. Read-only executor validation hot-journal window: unchanged and unqualified.
   Writable lifecycle recovery remains; an unknown non-delete completion still
   refuses. The optional note is not promoted to a generic cancellation claim.
5. Documentation clarified: restart qualification has down between runs. Compose
   in-place rebuild/recreate and transient parents before capture remain outside
   the qualified loop; inherited data can require its independent owner.
6. Added: status --json resource receipts carry deleted true/false. It denotes
   recorded tombstone/active receipt state, not a fresh physical-presence query.
   Unit receipt cycles and the native lifecycle loop check this field.

The initial capacity unit fixture incorrectly expected a never-granted intent
would block retirement; retirement correctly cancels such intents. The fixture
was changed to an actual started failed command, retaining the refusal assertion.
The standalone harness typecheck used an unavailable type-library alias; the
repository's tsconfig includes the harness and its normal typecheck is authoritative.

Matching specialist round 7, native Mac/final artifacts, owner-authorized cutover
and draft status remain coordinator gates. No new waiver or release authority.

Qualification retained the initial full-suite registry-advertise timeout. Its
known exit143 facts reconciled during exact cleanup, with the named cache kept.
The subsequent owned-API diagnostic/CI and initial repair serial all-suite
passed at unchanged 73114d2 inputs; the initial timeout remains unattributed.
The guest's first live 49153 run started after that API window, so its timeline
is not evidence of a collision. The version-only host probe's default-config
warning and its correction inside the view are disclosed in the new record.

A final registry-enabled partial-create probe exposed one success-only provenance
fallback left in the first repair. At 73114d2 / 4601b51c, k3d's registry had its
cluster/name labels but no io.silo labels; known exit1 was rejected where exit0
was accepted. The capture capability now requires a started producer with a
known exit by type, and both outcomes use the same registry provenance. The
permanent producer scenario enables the registry and requires its receipt.
The exact still-live red registry recovered through corrected public down with
its original ID, then cache-owner resolution and retirement; no manual registry
deletion or store reset. The first probe missed a registry-port setting, and its
fixture observer initially omitted the shortened registry name; these setup
errors and the retained red instance are explicitly preserved. Capture storage
now masks synthetic k3d token fields while in-memory verifier values remain
unchanged, preserving the full snapshot assertions.

The first final-source full run failed a second same-generation k3d startup
with a restarting load balancer. A fresh-allocation diagnostic passed, without
reproducing that exact restart. The final full run with a failure-only observer
and copied example passed at 3f87992 / 2e4f0501. The earlier failure remains
unattributed. The guest follow-up qualifies only the affected registry case at
these final inputs; its earlier four rows retain their own initial-repair scope.
