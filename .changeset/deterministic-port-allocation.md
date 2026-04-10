---
"@0xbigboss/silo": patch
---

Add a machine-wide port registry (`~/.silo/instances/`) so two silo instances (e.g. different worktrees) get guaranteed-disjoint port sets, even on a cold machine where nothing is bound yet. Before allocating, silo reads peer instances' registered ports and excludes them; after allocating, it registers its own. Registry entries are garbage-collected when their project's `.silo.lock` disappears. Fixes overlapping `NEXTJS_PORT`/`TILT_PORT`/etc. across worktrees.
