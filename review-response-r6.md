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
   test preserves a genuinely started, uncaptured failed create through compaction
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
