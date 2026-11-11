#!/bin/sh
set -eu
docker compose --project-name "$COMPOSE_PROJECT_NAME" -f compose.yaml up -d
