#!/bin/sh
set -eu
fixture=$1; label=$2; shift 2
base=/tmp/post-recovery
setsid timeout 600 sh -c 'cd "$1"; shift; exec bun /opt/dist/cli.js "$@"' sh "$base/fixtures/$fixture" "$@" > "$base/logs/$label.log" 2>&1 &
p=$!; echo "$p" > "/tmp/pids/r6-confirm-post-$label.pid"
printf 'r6-post launch %s fixture %s pid %s\n' "$label" "$fixture" "$p" | tee -a /tmp/shared-resources "$base/resources/pids"
