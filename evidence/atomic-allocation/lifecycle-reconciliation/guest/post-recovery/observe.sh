#!/bin/sh
set -eu
base=/tmp/post-recovery
label=$1
shift
docker events "$@" --format '{{json .}}' | while IFS= read -r event; do
 printf '%s\n' "$event" | tee -a /tmp/shared-resources "$base/resources/events.jsonl" >/dev/null
 type=$(printf '%s\n' "$event" | jq -r .Type)
 action=$(printf '%s\n' "$event" | jq -r .Action)
 id=$(printf '%s\n' "$event" | jq -r .Actor.ID)
 if [ "$type" = container ] && { [ "$action" = create ] || [ "$action" = start ]; }; then
   docker container inspect "$id" 2>> "$base/logs/observer-$label.stderr" | jq -c '.[]|{Id,Name,Created,Mounts,Labels:.Config.Labels}' | tee -a /tmp/shared-resources "$base/resources/objects.jsonl" >/dev/null || true
 fi
done
