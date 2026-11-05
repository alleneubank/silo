# Addendum 1 (silo-redesign), 2026-11-05T02:21Z: the human's answer to your question 1

Human decision (2026-11-05T02:21Z, via coordinator question widget): "Remove with the container (Recommended)". Option text, verbatim: "Silo never
deletes a volume by name. It removes each container it recorded together with that container's anonymous volumes (docker rm -v), so
Docker deletes only volumes it created for that container. A crash mid-cleanup can leak a volume (reported, never someone else's).
Then the 4th specialist round and the macOS run."

This replaces the brief's unique-name construction (Outcome 1). Exact action:
1. No code path deletes a volume by name (remove a21f710's name-based anonymous-volume deletion). Anonymous volumes are removed only as
   part of removing the receipted parent container with its anonymous volumes (docker rm -v / the API's v=true on that exact container
   ID). Verify against Docker's documented behavior that this never removes a named volume or a volume another container still uses,
   and say what happens to an anonymous volume shared via volumes-from.
2. Receipts: keep recording parents and their anonymous mount names for audit and leak reporting only, not as deletion authority.
   After cleanup, any receipted anonymous volume still present is reported as leaked with its name; never deleted by silo.
   Retirement/forced replacement: define and test what they require now (leak reported vs refusal), and keep claims safe.
3. Round 3's should-fix (stranded failed-deletion receipt) still applies to whatever deletion records remain; fix it or show the
   redesign removes the case.
4. Tests that fail on fff3083: same-second same-name replacement and replacement between inspect and delete are preserved (silo no
   longer deletes by name); the crash case; parent removal deletes its anonymous volumes. Then the brief's gates, Linux rehearsal
   (onyx limits as stated), macos-rehearsal.md, PR body, pr-ops.md and specialist-request.md for round 4.
