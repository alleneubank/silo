---
"@0xbigboss/silo": patch
---

Seed ephemeral port allocation from a hash of the instance name so two silo instances (e.g. different worktrees) get disjoint port windows on a cold machine where nothing is bound yet. Fixes overlapping `NEXTJS_PORT`/`TILT_PORT`/etc. across worktrees.
