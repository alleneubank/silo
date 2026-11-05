# Coordinator proposal operations

Use the sealed exact-head operations in
~/.handoffs/boss-mobile-release/silo-redesign/pr-ops.md, written after this
record-only commit. This repository copy deliberately does not encode its own
self-referential commit SHA. Runtime source is
20997dc740bd1df00c351cb4db6b4ba20734e47b; artifact SHA-256 is
90a44fcc8641b959544e2cb9e9525d469b8749ea8abc680ababe87b7329e7e0f.

Artifacts: proposal branch feat/atomic-allocation, pr-body.md for draft PR #58,
and review-response-r3.md for its round-3 response. Push only the exact sealed
proposal SHA to refs/heads/feat/atomic-allocation using an explicit refspec.
No force is requested; expected prior remote head is
fff3083dc1974f1856835a5ed8424c7f26ebb19a. A differing remote head requires
inspection by the coordinator, never an unconditional overwrite.

Keep draft. specialist-request.md requests human-approved round 4 over the full
fd710d9d..sealed proposal SHA; corrected native Mac and final release-artifact
qualification remain pending. No merge, ready transition, release, npm
publication, host cutover or peer-resource operation is authorized by this file.
