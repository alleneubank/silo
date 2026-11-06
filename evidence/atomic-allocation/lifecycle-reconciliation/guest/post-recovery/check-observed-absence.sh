#!/bin/sh
set -eu
base=/tmp/post-recovery
jq -r 'select(.Id) | .Id' "$base/resources/objects.jsonl" | sort -u > "$base/resources/observed-container-ids.txt"
while read -r id; do
 if docker container inspect "$id" > "$base/inspect-result" 2>&1; then exit 45; fi
 printf 'absent container %s: ' "$id" >> "$base/logs/closeout-observed-absence.txt"
 cat "$base/inspect-result" >> "$base/logs/closeout-observed-absence.txt"
done < "$base/resources/observed-container-ids.txt"
jq -r '.Mounts[] | select(.Type=="volume") | .Name' "$base/resources/objects.jsonl" | sort -u > "$base/resources/observed-volume-names.txt"
while read -r id; do
 if docker volume inspect "$id" > "$base/inspect-result" 2>&1; then exit 46; fi
 printf 'absent volume %s: ' "$id" >> "$base/logs/closeout-observed-absence.txt"
 cat "$base/inspect-result" >> "$base/logs/closeout-observed-absence.txt"
done < "$base/resources/observed-volume-names.txt"
jq -r 'select(.Type=="network" and .Action=="create") | .Actor.ID' "$base/resources/events.jsonl" | sort -u > "$base/resources/observed-network-ids.txt"
while read -r id; do
 if docker network inspect "$id" > "$base/inspect-result" 2>&1; then exit 47; fi
 printf 'absent network %s: ' "$id" >> "$base/logs/closeout-observed-absence.txt"
 cat "$base/inspect-result" >> "$base/logs/closeout-observed-absence.txt"
done < "$base/resources/observed-network-ids.txt"
wc -l "$base/resources/observed-container-ids.txt" "$base/resources/observed-volume-names.txt" "$base/resources/observed-network-ids.txt"
