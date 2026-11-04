#!/bin/sh
# Live idempotence and force refusal share the owner-crash rehearsal.
set -eu
exec bun "$(dirname "$0")/allocation-rehearsal.ts" --suite live "$@"
