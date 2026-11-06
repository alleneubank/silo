#!/bin/sh
set -eu
base=/tmp/post-recovery
mkdir -p "$base/logs" "$base/resources" "$base/fixtures"
bun /opt/dist/cli.js doc config > "$base/logs/doc-config.txt"
bun /opt/dist/cli.js doc tilt > "$base/logs/doc-tilt.txt"
cat > "$base/observe.sh" <<'WATCH'
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
WATCH
for spec in restart:39211:39212 failed:39213:39214 peerone:39215:39216 peertwo:39217:39218 foreign:39219:39220 envonly:39223:39224 cluster:39221:39222; do
 n=${spec%%:*}; rest=${spec#*:}; app=${rest%%:*}; tilt=${rest#*:}; d=$base/fixtures/$n
 mkdir -p "$d"
 cat > "$d/silo.toml" <<TOML
version = 1
prefix = "r6post"
[ports]
REDIS_PORT = $app
TILT_PORT = $tilt
[hosts]
APP_HOST = "\${name}.localhost"
TILT_HOST = "127.0.0.1"
[tilt]
webMode = "prod"
TOML
 cat > "$d/compose.yaml" <<'YAML'
services:
  redis:
    image: redis:7-alpine
    ports:
      - "127.0.0.1:${REDIS_PORT}:6379"
    labels:
      io.silo.project: "${SILO_PROJECT_ID}"
      io.silo.generation: "${SILO_GENERATION}"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 1s
      timeout: 1s
      retries: 20
networks:
  default:
    name: "${DOCKER_NETWORK}"
    labels:
      io.silo.project: "${SILO_PROJECT_ID}"
      io.silo.generation: "${SILO_GENERATION}"
YAML
 cat > "$d/Tiltfile" <<'TILT'
docker_compose('compose.yaml', project_name=os.getenv('COMPOSE_PROJECT_NAME'))
TILT
 if [ "$n" = failed ]; then
  cat >> "$d/Tiltfile" <<'TILT'
local_resource('dependent-failure', 'exit 42', resource_deps=['redis'])
TILT
 fi
 if [ "$n" = cluster ]; then
  cat >> "$d/silo.toml" <<'TOML'
[k3d]
enabled = true
kubeconfigPath = "kubeconfig"
args = ["--image=rancher/k3s:v1.33.7-k3s1"]
TOML
  cat > "$d/Tiltfile" <<'TILT'
local_resource('cluster-ready', 'kubectl get nodes')
TILT
 fi
 (cd "$d"; bun /opt/dist/cli.js env "post$n" --json) > "$base/logs/$n-env.json" 2> "$base/logs/$n-env.stderr"
 project=$(sed -n 's/^SILO_PROJECT_ID=//p' "$d/.localnet.env")
 setsid timeout 1800 sh "$base/observe.sh" "$n" --filter "label=io.silo.project=$project" > "$base/logs/observer-$n.stdout" 2> "$base/logs/observer-$n.stderr" &
 p=$!; echo "$p" > "/tmp/pids/r6-confirm-post-watch-$n.pid"
 printf 'r6-post watcher %s project %s pid %s\n' "$n" "$project" "$p" | tee -a /tmp/shared-resources "$base/resources/pids"
done
