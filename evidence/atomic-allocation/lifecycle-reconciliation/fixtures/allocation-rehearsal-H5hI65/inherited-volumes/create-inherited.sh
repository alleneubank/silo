#!/bin/sh
set -eu
docker container create --name "${CONTAINER_PREFIX}inherited" --label "io.silo.project=$SILO_PROJECT_ID" --label "io.silo.generation=$SILO_GENERATION" --volumes-from 68f8fc8d6f7f32a1fd1fc917c91ba3a1812cd7e91800ad317294e42901b4444a redis:7-alpine > borrower.id
