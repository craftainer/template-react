#!/usr/bin/env bash
# Brings up, and tears down, the backing services of the e2e lane: template-fastapi's
# own Postgres, S3, Valkey ("redis"), MQTT and Keycloak stack services plus its API
# (the `myapp` service running uvicorn, see lane.compose.yml). Nothing else is
# started: no Selenium, no Umami, and no second Valkey (template-fastapi's `redis`
# service is the same image and command as this repo's stack/valkey).
#
#   E2E_FASTAPI_DIR=/path/to/clean/template-fastapi/checkout tests/e2e/lane.sh up
#   tests/e2e/lane.sh down
#
# E2E_FASTAPI_DIR is a git-only clone of template-fastapi's main (the realm with the
# `bff` client is in it since BK1). Compose project name: E2E_LANE_PROJECT
# (default bffe2e). `down` removes the containers, their volumes and the built image.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
project="${E2E_LANE_PROJECT:-bffe2e}"
fastapi="${E2E_FASTAPI_DIR:-}"

[ -n "$fastapi" ] && [ -f "$fastapi/.devcontainer/compose.yml" ] || {
  echo "set E2E_FASTAPI_DIR to a template-fastapi checkout" >&2
  exit 1
}

compose=(docker compose -p "$project"
  -f "$fastapi/.devcontainer/compose.yml"
  -f "$fastapi/.devcontainer/compose.instance.yml"
  -f "$here/lane.compose.yml")

case "${1:-}" in
  up)
    # --no-deps: myapp's depends_on also lists Selenium, which the lane leaves out.
    # Infrastructure first (to healthy), then the API, which needs it at startup.
    "${compose[@]}" up -d --wait --no-deps postgres s3 redis mqtt keycloak
    "${compose[@]}" up -d --wait --no-deps --build myapp
    ;;
  down)
    "${compose[@]}" down --volumes --remove-orphans --rmi local
    ;;
  ps)
    "${compose[@]}" ps
    ;;
  *)
    echo "usage: $0 up|down|ps" >&2
    exit 2
    ;;
esac
