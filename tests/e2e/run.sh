#!/usr/bin/env bash
# Runs the BFF end-to-end suite in the pinned Playwright image (the same one
# tests/visual/run.sh uses) against the lane that tests/e2e/lane.sh brought up.
#
#   pnpm exec vite build         # the SPA the BFF serves (dist/)
#   E2E_FASTAPI_DIR=... tests/e2e/lane.sh up
#   tests/e2e/run.sh
#   tests/e2e/lane.sh down
#
# Extra arguments go to `playwright test`. See README.md for the topology.
set -euo pipefail

# Must equal tests/visual/run.sh's IMAGE (and @playwright/test in package.json).
IMAGE="mcr.microsoft.com/playwright:v1.64.1-noble@sha256:7852dc5a7d72f5fe458a597d690f6c42fbc8e9e26ddfa95f8e6ef552558d9bbf"

cd "$(dirname "$0")/../.."

[ -f dist/index.html ] || { echo "dist/ is missing: run 'pnpm exec vite build' first" >&2; exit 1; }

project="${E2E_LANE_PROJECT:-bffe2e}"

container_of() {
  docker ps -q \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=$1"
}
ip_of() {
  docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$1"
}

keycloak="$(container_of keycloak)"
api="$(container_of myapp)"
valkey="$(container_of redis)"
[ -n "$keycloak" ] && [ -n "$api" ] && [ -n "$valkey" ] || {
  echo "the lane is not up (project $project): run tests/e2e/lane.sh up" >&2
  exit 1
}

# The suite shares Keycloak's network namespace: `localhost:8080` is Keycloak, as
# it is for the browser and in the tokens' `iss`, and the two BFFs the config
# starts (8081 and 5173, the origins the realm's `bff` client allows) are on
# `localhost` too, so Keycloak's back-channel logout reaches them. The API and
# Valkey are addressed by IP (no DNS assumption).
exec docker run --rm --ipc=host --init \
  --network "container:$keycloak" \
  -u "$(id -u):$(id -g)" -e HOME=/tmp -e CI="${CI:-}" \
  -e E2E_API_URL="http://$(ip_of "$api"):8000" \
  -e E2E_SESSION_STORE_URL="redis://$(ip_of "$valkey"):6379" \
  -v "$PWD:$PWD" -w "$PWD" "$IMAGE" \
  node_modules/.bin/playwright test --config tests/e2e/playwright.config.ts "$@"
