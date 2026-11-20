---
"@0xbigboss/silo": minor
---

silo now ships its own Janitor 0.3.1 (macOS arm64/x86_64, Linux aarch64/x86_64) and no longer needs `janitor` on PATH; a Janitor on PATH is ignored. On first use silo copies the binary to `~/.silo/janitor/<version>-<digest>/janitor`. `SILO_JANITOR=<path>` runs another Janitor binary instead. Projects can drop their Janitor pin once they require this release.
