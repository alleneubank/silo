#!/bin/sh
set -eu
base=/tmp/post-recovery
docker events --filter type=network --filter type=volume --format '{{json .}}' | while IFS= read -r event; do
 if printf '%s\n' "$event" | jq -e '(.Actor.Attributes.name == "k3d-r6post-postcluster") or (.Actor.ID == "k3d-r6post-postcluster-images")' >/dev/null; then
  printf '%s\n' "$event" | tee -a /tmp/shared-resources "$base/resources/named-events.jsonl" >/dev/null
 fi
done
