---
"@0xbigboss/silo": patch
---

Point every repository URL at `alleneubank/silo`, the current owner of the
repo. The old `0xBigBoss/silo` paths still redirect on github.com, but npm
compares `repository.url` to `GITHUB_REPOSITORY` verbatim when it generates
provenance, so the stale owner would fail the publish outright. The plugin
marketplace id moves with it: install with `silo@alleneubank-silo`.
