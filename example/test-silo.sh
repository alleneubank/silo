#!/bin/sh
# Native backend lifecycle in an owned fixture; never reset this directory's state.
set -eu
exec bun "$(dirname "$0")/../scripts/allocation-rehearsal.ts" --suite backend "$@"
