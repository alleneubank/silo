#!/bin/sh
set -eu
registry="${K3D_REGISTRY_NAME%%:*}"
id=$(docker run -d --name "$registry" --publish "127.0.0.1:$K3D_REGISTRY_PORT:5000" --label "k3d.cluster=$K3D_CLUSTER_NAME" --label "rehearsal.fixture=allocation-rehearsal-GAEE6n" redis:7-alpine sleep 900)
printf '%s\n' "$id" > squatter.id
exec sleep 900
