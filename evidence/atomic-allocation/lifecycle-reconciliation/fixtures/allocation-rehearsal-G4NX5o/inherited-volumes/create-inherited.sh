#!/bin/sh
set -eu
docker container create --name "${CONTAINER_PREFIX}inherited" --label "io.silo.project=$SILO_PROJECT_ID" --label "io.silo.generation=$SILO_GENERATION" --volumes-from f0250dcd2c38d8574bb6a2ba2948b349b170643bc5f705e62f3889b450705906 redis:7-alpine > borrower.id
