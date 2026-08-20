#!/bin/sh
# End-to-end proof of the SPEC invariant: Tilt does not outlive the silo
# process that started it.
#
# Kills silo with SIGKILL -- the case its signal handlers cannot cover -- and
# asserts the supervised Tilt tree is drained rather than reparented to init.
set -eu

die() {
  echo "FAIL: $*" >&2
  if [ -n "${silo_log:-}" ] && [ -f "$silo_log" ]; then
    echo "--- silo log ---" >&2
    sed -n '1,80p' "$silo_log" >&2
  fi
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

case "$(uname -s)" in
  Darwin | Linux | *BSD) ;;
  *) echo "skip: drain test requires a POSIX process-group platform" >&2; exit 0 ;;
esac

need tilt
need janitor
need bun

repo_root="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
tmp_dir=""
silo_pid=""
pgid=""

cleanup() {
  status=$?
  trap - EXIT INT TERM HUP
  [ -n "$silo_pid" ] && kill -9 "$silo_pid" 2>/dev/null
  # The sleeper ignores TERM by design, so KILL is the last cleanup line: a
  # failed assertion must not leave a dev process group behind.
  [ -n "$pgid" ] && kill -KILL "-$pgid" 2>/dev/null
  [ -n "$tmp_dir" ] && rm -rf "$tmp_dir"
  exit "$status"
}
trap cleanup EXIT INT TERM HUP

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/silo-drain.XXXXXX")"
pid_file="$tmp_dir/sleeper.pid"
silo_log="$tmp_dir/silo.log"

cat >"$tmp_dir/silo.toml" <<'TOML'
version = 1

[ports]
TILT_PORT = "random"
TOML

# serve_cmd as a list keeps one sh, which is the process-group leader janitor
# creates, so the PID it records equals the group's pgid. The trap makes the
# sleeper ignore SIGTERM, proving the grace-then-SIGKILL escalation path.
cat >"$tmp_dir/Tiltfile" <<TILTFILE
local_resource(
    'drain-sleeper',
    serve_cmd=['sh', '-c', 'trap "" TERM; echo \$\$ > "$pid_file"; while :; do sleep 1; done'],
)
TILTFILE

(
  cd "$tmp_dir"
  exec bun "$repo_root/src/cli.ts" up drain >"$silo_log" 2>&1
) &
silo_pid=$!

i=0
while [ "$i" -lt 90 ]; do
  if [ -s "$pid_file" ]; then
    sleeper_pid="$(sed -n '1p' "$pid_file")"
    pgid="$(ps -o pgid= -p "$sleeper_pid" 2>/dev/null | tr -d ' ')"
    if [ -n "$pgid" ] && kill -0 "-$pgid" 2>/dev/null; then
      break
    fi
  fi
  kill -0 "$silo_pid" 2>/dev/null || die "silo exited before the sleeper became observable"
  i=$((i + 1))
  sleep 1
done
[ -n "$pgid" ] || die "timed out waiting for the sleeper process group"
echo "ok: sleeper process group $pgid is up under silo pid $silo_pid"

# The case silo's SIGINT/SIGTERM handlers cannot cover.
kill -9 "$silo_pid" 2>/dev/null || true
wait "$silo_pid" 2>/dev/null || true
silo_pid=""

# janitor drains with SIGTERM, then escalates after its grace window.
i=0
while [ "$i" -lt 20 ]; do
  if ! kill -0 "-$pgid" 2>/dev/null; then
    echo "PASS: process group $pgid drained after silo was SIGKILLed"
    pgid=""
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

die "process group $pgid survived silo being SIGKILLed (orphaned to init)"
