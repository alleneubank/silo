# Addendum 5 — anonymous service-volume cleanup

**Supported product defect.** At 5d2c870 the copied full example's public
`down --delete-cluster --clean` exits zero and releases claims while Redis's
image-created anonymous `/data` volume survives. Before teardown, all four
containers' Mounts and image volume declarations were recorded. Of seven
unique mounted volumes, the six k3d volumes disappear and Redis's remains.
This reproduces on Linux; no macOS/OrbStack-specific cause is needed.

The earlier Linux six-volume audit did include image-declared anonymous
volumes: one named k3d images volume plus four k3s node children and one registry
child. It did not include Redis. Its scoped absence claim remains valid;
it never established complete copied-example anonymous cleanup.

Correction `a21f710896528aeaed5a6c142abc13a80895f1ba` stores anonymous child identity and destination inside
the immutable container receipt. Historical parent receipts survive container
deletion; clean and explicit cluster deletion remove exact recorded children
without force/prune. Both retirement and forced replacement prove every
recorded child absent. Explicit sources confer no child authority; ambiguous
inherited provenance refuses. Failed child deletion retries before unresolved
request adjudication and keeps claims until it succeeds.

Evidence: [anonymous-volume record](evidence/atomic-allocation/anonymous-volumes/README.md).
The native regression fails first on the actual leaked volume. All 130 Bun
tests, typecheck/lint/knip/jscpd/build pass; the public suite passes across 234 recorded commands, including expected
refusals; all 17 final cleanup commands exit zero. The full copied example passes web/API health and
removes all seven recorded mounted volumes, including Redis. The fresh guest is green; the closing audit records 26 retired projects, zero
claims/active resources, 621 absent recorded PID/group handles and 122 absent
recorded object handles (59 volume names). Some guest candidates were never
created; these are absence checks.

The first implementation's in-use retry encountered incorrect ordering;
its original failure and successful recovery are retained. This is not
called pre-existing or flaky. No assertion was weakened. No waiver added.
Specialist round 3 of 3 belongs to the coordinator and is pending; this runtime
needs native Mac requalification. Historical unattributed volumes stay untouched.
Intended semver remains 1.0.0. No Git network operation or publication ran here.
