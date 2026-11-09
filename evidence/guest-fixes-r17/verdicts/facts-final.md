# R17 factual follow-up

Verdict: prior three findings are corrected; one stale source-head sentence remains before publication. This is a read-only factual follow-up of the four stakeholder artifacts, with only this requested verdict written. No tests, source review, remote actions or process signaling were performed.

| Artifact/claim | Verdict | Evidence |
| --- | --- | --- |
| report.md: runtime6c250b4, fixture-only3c12074 and0cc8ffa | Supported | Local log and commit stats:0cc8ffa changes only src/core/lease_store.test.ts;3c12074 changes only the UDP fixture. |
| report.md: prior243/0 is bound to969a3a9; final delivery/teardown pending | Supported | push-code-pinned.log names969a3a9 and243/0. The corrected text explicitly calls the final receipts pending. This review does not certify final publication or teardown. |
| report.md: exact-head3c12074 run242/243 and focused correction before full delivery | Supported | gate-source-head.txt names3c12074; head-bound-prepush-gates.log reports242 pass/1 fail (capacity history case), exit1. capacity-drain-fix.log reports that focused case1 pass/0 fail, exit0. Full final hooks remain required. |
| pr-comment-r17.md: output stalls terminate in about31s governed by30s timeout | Supported | Named captures show30.696s stdout,30.884s native dual and30.508s JS dual. Previous within30s overstatement is removed. |
| pr-comment-r17.md: final comment requires a green full-suite receipt before application | Supported as pending condition | The artifact explicitly retains the failed head-bound run and requires actual final normal hooks. No final green delivery is claimed. |
| review-response-r17.md opening: “The last source commit,3c12074” | Stale/overstated | Current HEAD is0cc8ffa. Replace that sentence with both fixture-only follow-ups. Parent notified immediately. The later paragraph correctly describes the additional capacity fixture change. |
| review-response-r17.md: conditional6c approval, named output/UDP/checkpoint observations and unchanged owner conditions | Supported within retained evidence scopes | Same verdicts and captures checked in the first fact-check; no runtime change since6c250b4. Focused fixture success is not full-suite approval. |
| evidence README: historical243/0 exact-head distinction; head-bound242/243; focused case green | Supported | Prior unmarked run is now explicitly unmarked;969 push receipt and3c head receipt are distinguished. capacity-drain-fix.log is1/0. |
| Evidence README: five retained public hashes;13 docs per distribution;120 UDP observations;15.35MB output; FIFO outcomes | Supported, unchanged | All hashes were independently recomputed in the first check and matched. Named capture inputs and runtime remain unchanged; evidence remains scoped to its actual heads. |
| All four: original owner-only qualifications, draft status, no real-account qualification | Supported as retained scope | Linux/Rosetta, real-account journal, Docker timestamp/volume, executor/grant and cutover holds remain. The r16 specialist's original detailed conditions remain authoritative; no merge/release/waiver authority is inferred. |

The evidence README still describes final-push.log as the delivery receipt location. Read that together with the explicit pending delivery requirement; it is not evidence that the final push or hooks already completed. Final publication and teardown receipts must be updated outside git after their actual outcomes. Remote/live negative-action claims were not independently audited.
