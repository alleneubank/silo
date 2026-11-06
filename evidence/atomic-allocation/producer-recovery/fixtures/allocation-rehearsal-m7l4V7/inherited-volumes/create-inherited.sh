#!/bin/sh
set -eu
docker container create --name "${CONTAINER_PREFIX}inherited" --label "io.silo.project=$SILO_PROJECT_ID" --label "io.silo.generation=$SILO_GENERATION" --volumes-from 1ed70beaa97f666c432d8aa3e427d792edfd4940bd7aa70ea372aef8b1bd38e1 redis:7-alpine > borrower.id
