#!/bin/sh
set -eu
docker container create --name "${CONTAINER_PREFIX}inherited" --label "io.silo.project=$SILO_PROJECT_ID" --label "io.silo.generation=$SILO_GENERATION" --volumes-from f98a2785859f9106d7352cedf4a07c3b57d1998f1bcacabf8b9bebeb08e78925 redis:7-alpine > borrower.id
