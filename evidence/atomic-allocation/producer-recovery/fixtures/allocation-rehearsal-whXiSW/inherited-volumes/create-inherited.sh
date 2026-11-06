#!/bin/sh
set -eu
docker container create --name "${CONTAINER_PREFIX}inherited" --label "io.silo.project=$SILO_PROJECT_ID" --label "io.silo.generation=$SILO_GENERATION" --volumes-from 8f265351b47b89727dd8b7bf3aeb0ed15ab043b5b02562ccd3fb6591817c36d1 redis:7-alpine > borrower.id
