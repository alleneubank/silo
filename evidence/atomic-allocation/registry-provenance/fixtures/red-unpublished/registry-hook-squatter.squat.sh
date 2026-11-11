#!/bin/sh
set -eu
registry="${K3D_REGISTRY_NAME%%:*}"
id=$(docker run -d --name "$registry" --label "k3d.cluster=$K3D_CLUSTER_NAME" --label "rehearsal.fixture=allocation-rehearsal-3qvPH1" redis:7-alpine sleep 900)
printf '%s\n' "$id" > squatter.id
