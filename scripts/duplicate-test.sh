#!/bin/sh
# End-to-end proof that `silo up` does not fork a second stack for a project
# that already has one live.
#
# Boots a real silo instance, runs `silo up` again, and asserts the second run
# reused the first rather than starting another Tilt. Then proves the escape
# hatch: `silo up --force` starts a parallel stack without clobbering the
# record of the one it left running.
set -eu

first_log=""
reuse_log=""
forced_log=""

die() {
  echo "FAIL: $*" >&2
  for log in "$first_log" "$reuse_log" "$forced_log"; do
    if [ -n "$log" ] && [ -f "$log" ]; then
      echo "--- $log ---" >&2
      sed -n '1,60p' "$log" >&2
    fi
  done
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

case "$(uname -s)" in
  Darwin | Linux | *BSD) ;;
  *) echo "skip: duplicate test requires a POSIX process-group platform" >&2; exit 0 ;;
esac

need tilt
need janitor
need bun

repo_root="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
tmp_dir=""
first_pid=""
reuse_pid=""
forced_pid=""
third_pid=""

cleanup() {
  status=$?
  trap - EXIT INT TERM HUP
  drained=""
  if [ -n "$first_pid" ]; then
    kill -9 "$first_pid" 2>/dev/null || true
    drained=1
  fi
  if [ -n "$reuse_pid" ]; then
    kill -9 "$reuse_pid" 2>/dev/null || true
    drained=1
  fi
  if [ -n "$forced_pid" ]; then
    kill -9 "$forced_pid" 2>/dev/null || true
    drained=1
  fi
  if [ -n "$third_pid" ]; then
    kill -9 "$third_pid" 2>/dev/null || true
    drained=1
  fi
  # janitor drains each Tilt when its silo parent dies; give it the grace
  # window before the temp dir (and the Tiltfile) disappear.
  if [ -n "$drained" ]; then
    sleep 7
  fi
  if [ -n "$tmp_dir" ]; then
    rm -rf "$tmp_dir"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM HUP

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/silo-duplicate.XXXXXX")"
lock_file="$tmp_dir/.silo.lock"
first_log="$tmp_dir/first.log"
reuse_log="$tmp_dir/reuse.log"
forced_log="$tmp_dir/forced.log"

# Evaluates one expression against the lockfile instance, bound to `i`.
# Quiet on failure: a half-written lockfile is a retry, not an error.
lock_eval() {
  SILO_LOCK="$lock_file" bun -e \
    "const l = await Bun.file(process.env.SILO_LOCK).json();
     const i = l.instance;
     process.stdout.write(String($1))" 2>/dev/null
}

# Bounded wait for a silo process to exit after being signalled.
await_exit() {
  i=0
  while [ "$i" -lt 40 ]; do
    kill -0 "$1" 2>/dev/null || return 0
    i=$((i + 1))
    sleep 1
  done
  return 1
}

cat >"$tmp_dir/silo.toml" <<'TOML'
version = 1

[ports]
TILT_PORT = "random"
API_PORT = "random"
TOML

cat >"$tmp_dir/Tiltfile" <<'TILTFILE'
local_resource('idle', serve_cmd=['sh', '-c', 'while :; do sleep 1; done'])
TILTFILE

(
  cd "$tmp_dir"
  exec bun "$repo_root/src/cli.ts" up demo >"$first_log" 2>&1
) &
first_pid=$!

i=0
while [ "$i" -lt 90 ]; do
  if [ -f "$lock_file" ] && [ "$(lock_eval 'i.tiltPid ?? ""')" != "" ]; then
    break
  fi
  kill -0 "$first_pid" 2>/dev/null || die "silo exited before recording a Tilt"
  i=$((i + 1))
  sleep 1
done

tracked_pid="$(lock_eval 'i.tiltPid ?? ""')"
[ -n "$tracked_pid" ] || die "timed out waiting for the first stack to record a Tilt"
echo "ok: first stack up (Tilt pid $tracked_pid, ports $(lock_eval 'Object.values(i.ports).join(",")'))"

# 1. A second `up` must report the live instance and exit 0. Unguarded, it
#    attaches to a second Tilt in the foreground and never returns, so the
#    wait is bounded: a hang is the failure, not a slow pass.
(
  cd "$tmp_dir"
  exec bun "$repo_root/src/cli.ts" up >"$reuse_log" 2>&1
) &
reuse_pid=$!

i=0
while [ "$i" -lt 60 ]; do
  kill -0 "$reuse_pid" 2>/dev/null || break
  i=$((i + 1))
  sleep 1
done
if kill -0 "$reuse_pid" 2>/dev/null; then
  kill -9 "$reuse_pid" 2>/dev/null || true
  reuse_pid=""
  die "second 'silo up' never exited; it started a second stack instead of reusing"
fi

reuse_status=0
wait "$reuse_pid" || reuse_status=$?
reuse_pid=""
[ "$reuse_status" -eq 0 ] ||
  die "second 'silo up' exited $reuse_status; expected an idempotent no-op"

grep -q "already running" "$reuse_log" ||
  die "second 'silo up' did not report the running instance"
grep -q "Starting Tilt" "$reuse_log" &&
  die "second 'silo up' started a second Tilt"
[ "$(lock_eval 'i.tiltPid ?? ""')" = "$tracked_pid" ] ||
  die "second 'silo up' overwrote the tracked Tilt pid"
kill -0 "$first_pid" 2>/dev/null || die "second 'silo up' disturbed the first stack"
echo "ok: second 'silo up' reused the live instance and exited 0"

# 2. `--force` is the deliberate parallel stack, and must not erase the record
#    of the stack it leaves running.
(
  cd "$tmp_dir"
  exec bun "$repo_root/src/cli.ts" up --force >"$forced_log" 2>&1
) &
forced_pid=$!

i=0
while [ "$i" -lt 90 ]; do
  if [ "$(lock_eval 'i.disownedTilts?.length ?? 0')" != "0" ] &&
    [ "$(lock_eval 'i.tiltPid ?? ""')" != "" ]; then
    break
  fi
  kill -0 "$forced_pid" 2>/dev/null || die "forced 'silo up' exited before starting Tilt"
  i=$((i + 1))
  sleep 1
done

forced_tracked="$(lock_eval 'i.tiltPid ?? ""')"
[ -n "$forced_tracked" ] || die "timed out waiting for the parallel stack to start"
[ "$forced_tracked" != "$tracked_pid" ] || die "forced 'silo up' did not start a second Tilt"

[ "$(lock_eval "i.disownedTilts.some((d) => d.pid === $tracked_pid)")" = "true" ] ||
  die "forced 'silo up' dropped the record of the stack it left running"
[ -n "$(lock_eval "i.disownedTilts.find((d) => d.pid === $tracked_pid)?.ports?.TILT_PORT ?? ''")" ] ||
  die "disowned record does not name the ports the stack still owns"

overlap="$(lock_eval \
  'Object.values(i.ports).filter((p) => i.disownedTilts.some((d) => Object.values(d.ports).includes(p))).join(",")')"
[ -z "$overlap" ] || die "parallel stack took port(s) $overlap from the disowned stack"

kill -0 "$tracked_pid" 2>/dev/null || die "forced 'silo up' stopped the first stack"
echo "ok: 'silo up --force' started a parallel stack and disowned the first (pid $tracked_pid)"

# 3. `--clean` erases the lockfile and the project's port reservations, which
#    are the only record of a disowned stack. It must refuse while one runs.
if (cd "$tmp_dir" && bun "$repo_root/src/cli.ts" down --clean >"$tmp_dir/clean.log" 2>&1); then
  die "'silo down --clean' erased the record of a running disowned stack"
fi
grep -q "would erase the only record" "$tmp_dir/clean.log" ||
  die "'silo down --clean' failed for the wrong reason"
[ -f "$lock_file" ] || die "'silo down --clean' removed the lockfile anyway"
echo "ok: 'silo down --clean' refused while a disowned stack was running"

# 4. The displaced `silo up` still holds the old pid. When it exits it must
#    clean up after itself without taking the replacement's ownership with it.
kill -TERM "$first_pid" 2>/dev/null || true
await_exit "$first_pid" || die "displaced 'silo up' did not exit on SIGTERM"
first_pid=""

[ "$(lock_eval 'i.tiltPid ?? ""')" = "$forced_tracked" ] ||
  die "displaced stack's exit erased the replacement's ownership"
[ "$(lock_eval 'i.disownedTilts?.length ?? 0')" = "0" ] ||
  die "displaced stack exited but is still recorded as running"
echo "ok: the displaced stack exited without disturbing the replacement"

# 5. A stack left running with nobody owning the lockfile -- a handover that
#    failed, or a replacement that exited -- must not be silently duplicated.
(
  cd "$tmp_dir"
  exec bun "$repo_root/src/cli.ts" up --force >"$tmp_dir/third.log" 2>&1
) &
third_pid=$!

i=0
while [ "$i" -lt 90 ]; do
  if [ "$(lock_eval 'i.disownedTilts?.length ?? 0')" != "0" ] &&
    [ "$(lock_eval "i.tiltPid ?? \"\"")" != "$forced_tracked" ] &&
    [ "$(lock_eval 'i.tiltPid ?? ""')" != "" ]; then
    break
  fi
  kill -0 "$third_pid" 2>/dev/null || die "third 'silo up' exited before starting Tilt"
  i=$((i + 1))
  sleep 1
done
[ "$(lock_eval 'i.disownedTilts?.length ?? 0')" != "0" ] ||
  die "timed out waiting for the third stack to disown the second"

kill -TERM "$third_pid" 2>/dev/null || true
await_exit "$third_pid" || die "third 'silo up' did not exit on SIGTERM"
third_pid=""

[ "$(lock_eval 'i.tiltPid ?? ""')" = "" ] ||
  die "the exiting owner left its pid in the lockfile"

if (cd "$tmp_dir" && bun "$repo_root/src/cli.ts" up >"$tmp_dir/blocked.log" 2>&1); then
  die "'silo up' started a stack beside a running one that owns no lockfile"
fi
grep -q "no longer own the lockfile" "$tmp_dir/blocked.log" ||
  die "'silo up' failed for the wrong reason"
echo "ok: 'silo up' refused to start beside a running stack that owns no lockfile"

echo "PASS: silo up is idempotent, --force keeps the displaced stack on record"
