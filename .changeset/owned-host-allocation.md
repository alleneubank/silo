---
"@0xbigboss/silo": minor
---

Honor explicit Tilt hosts, support project-relative `k3d.kubeconfigPath`, and
add `tilt.webMode = "prod"` for embedded production web assets.

Preserve peer port reservations during reads, including stale entries. Refuse
allocation when peer records or liveness cannot be read reliably, and publish
the current project's reservation atomically. Owners retire their own entries
with `silo down --clean`; allocators still require external serialization.
