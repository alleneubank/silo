#!/bin/sh
set -eu
base=/tmp/post-recovery
for n in restart failed peerone peertwo foreign envonly cluster; do
 (cd "$base/fixtures/$n"; bun /opt/dist/cli.js status --json) > "$base/logs/$n-final-status.json"
 jq -e '.project.phase=="unallocated" and (.project.claims|length)==0 and (.project.resources|length)==0 and (.project.launches|length)==0' "$base/logs/$n-final-status.json" >> "$base/logs/closeout-claims.txt"
done
jq -c '.project.resources[]' "$base/logs/restart-status2.json" "$base/logs/failed-before-clean.json" "$base/logs/cluster-status2.json" | tee -a /tmp/shared-resources "$base/resources/receipts.jsonl" >/dev/null
jq -r '[.kind,.id]|@tsv' "$base/resources/receipts.jsonl" "$base/resources/network-receipts.jsonl" | sort -u > "$base/resources/receipt-objects.tsv"
while read -r kind id; do
 if docker "$kind" inspect "$id" > "$base/inspect-result" 2>&1; then exit 50; fi
 printf 'absent %s %s: ' "$kind" "$id" >> "$base/logs/closeout-receipt-absence.txt"
 cat "$base/inspect-result" >> "$base/logs/closeout-receipt-absence.txt"
done < "$base/resources/receipt-objects.tsv"
jq -r '.anonymousVolumes[]?.name' "$base/resources/receipts.jsonl" | sort -u > "$base/resources/receipt-anonymous-volumes.txt"
while read -r id; do
 if docker volume inspect "$id" > "$base/inspect-result" 2>&1; then exit 51; fi
 printf 'absent anonymous volume %s: ' "$id" >> "$base/logs/closeout-receipt-absence.txt"
 cat "$base/inspect-result" >> "$base/logs/closeout-receipt-absence.txt"
done < "$base/resources/receipt-anonymous-volumes.txt"
sh "$base/check-observed-absence.sh" > "$base/logs/observed-object-counts.txt"
jq -r '.Actor.Attributes.container // empty' "$base/resources/named-events.jsonl" | sort -u > "$base/resources/cache-network-user-ids.txt"
while read -r id; do
 if docker container inspect "$id" > "$base/inspect-result" 2>&1; then exit 52; fi
 printf 'absent cache/network user container %s: ' "$id" >> "$base/logs/closeout-user-absence.txt"
 cat "$base/inspect-result" >> "$base/logs/closeout-user-absence.txt"
done < "$base/resources/cache-network-user-ids.txt"
for f in /tmp/pids/r6-confirm-post-*.pid; do
 p=$(cat "$f")
 if ps -o pid=,ppid=,pgid=,uid=,args= -p "$p" >> "$base/logs/closeout-processes.txt"; then exit 53; fi
 printf 'absent recorded pid %s\n' "$p" >> "$base/logs/closeout-pid-absence.txt"
done
docker ps -a --filter name=r6post --no-trunc --format '{{.ID}} {{.Names}}' > "$base/logs/closeout-name-containers.txt"
docker network ls --filter name=r6post --no-trunc --format '{{.ID}} {{.Name}}' > "$base/logs/closeout-name-networks.txt"
docker volume ls --filter name=r6post --format '{{.Name}}' > "$base/logs/closeout-name-volumes.txt"
jq -n --slurpfile a "$base/logs/cluster-status1.json" --slurpfile b "$base/logs/cluster-status2.json" '{generationBefore:$a[0].project.generation,generationAfter:$b[0].project.generation,firstIds:[$a[0].project.resources[].id],secondHistoryIds:[$b[0].project.resources[].id],ci:[$b[0].project.launches[]|select(.kind=="tilt-ci")|{phase,exitCode}]}' > "$base/logs/cluster-comparison.json"
wc -l "$base/resources/receipt-objects.tsv" "$base/resources/receipt-anonymous-volumes.txt" "$base/resources/cache-network-user-ids.txt" "$base/logs/closeout-pid-absence.txt"
cat "$base/logs/observed-object-counts.txt" "$base/logs/closeout-name-containers.txt" "$base/logs/closeout-name-networks.txt" "$base/logs/closeout-name-volumes.txt"
