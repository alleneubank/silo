---
"@0xbigboss/silo": patch
---

CLI commands print the next correct command at stop points: Tilt API port on
`silo status` / already-running `up`, "did not start Tilt" on `silo env`,
kept k3d cluster on `silo down`, install URLs for missing tools, and available
topics for unknown `silo doc` names.
