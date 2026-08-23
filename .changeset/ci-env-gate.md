---
"@0xbigboss/silo": minor
---

`silo ci` now sets `CI=true` in the environment it hands Tilt, and no longer
requires `GITHUB_ENV`.

Tiltfiles commonly gate e2e resources on `os.environ.get("CI") == "true"`.
GitHub Actions sets `CI` for free, so workflows never state it and the gap is
invisible until you run locally: the gated resources stay manual, never
execute, and `tilt ci` still exits 0 reporting success, because every workload
it did build is healthy. Assertions that never ran cannot fail. Running those
resources is what `silo ci` is for, so it now says so itself.

Expect previously-skipped resources to start running locally. In CI nothing
changes, since `CI` was already set there.

The `$GITHUB_ENV` export is now skipped with a warning when the variable is
absent, in both `silo ci` and `silo env` — `CI=true` alone never promised that
file exists. Passing `--export-ci` explicitly still fails when there is nowhere
to write, because the caller asked for the export.
