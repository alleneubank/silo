#!/bin/sh
# Requires an explicitly disposable OS account; see macos-rehearsal.md.
set -eu
exec bun "$(dirname "$0")/allocation-rehearsal.ts" --suite live "$@"
