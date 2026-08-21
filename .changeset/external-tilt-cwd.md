---
"@0xbigboss/silo": patch
---

Detect a Tilt running outside silo by the directory it is actually running in.

The check built the pattern `tilt.*<project root>` and passed it to `pgrep -f`,
which matches a process's argv. silo starts Tilt with the project root as the
spawn cwd and a developer's own `tilt up` is just `tilt up`, so the path was
never in argv and the pattern could not match: `findTiltPidsInDir` always
returned nothing and the "Tilt already running outside silo" guard never fired.

Candidates are now attributed by reading each process's working directory
(`/proc/<pid>/cwd` on Linux, `lsof` elsewhere), and stacks silo started are
excluded by ancestry and process group rather than by pid alone — the `tilt up`
under a supervisor is a different pid from the one the lockfile records. The
error now names the pid it found.
