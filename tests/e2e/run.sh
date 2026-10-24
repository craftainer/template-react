#!/usr/bin/env bash
# Runs the admin's end-to-end journey in the pinned Playwright image (the same
# one tests/visual/run.sh uses) against a template-fastapi that is already
# running, and its Keycloak. See README.md for what to start first.
#
#   E2E_API_PROXY_TARGET=http://localhost:8010 tests/e2e/run.sh
#
# Extra arguments go to `playwright test`.
set -euo pipefail

# Must equal tests/visual/run.sh's IMAGE (and @playwright/test in package.json).
IMAGE="mcr.microsoft.com/playwright:v1.64.1-noble@sha256:7852dc5a7d72f5fe458a597d690f6c42fbc8e9e26ddfa95f8e6ef552558d9bbf"

cd "$(dirname "$0")/../.."

# The container shares this host's network (`--network host`), so the backend
# is reachable on localhost; Keycloak is resolved here and handed in, because
# its name only exists in the devcontainer's /etc/hosts.
keycloak_host="${E2E_KEYCLOAK_HOST:-keycloak}"
keycloak_ip="$(getent hosts "$keycloak_host" | awk '{print $1; exit}' || true)"
[ -n "$keycloak_ip" ] || { echo "cannot resolve $keycloak_host (set E2E_KEYCLOAK_HOST)" >&2; exit 1; }

exec docker run --rm --ipc=host --init --network host \
  --add-host "keycloak:$keycloak_ip" \
  -u "$(id -u):$(id -g)" -e HOME=/tmp -e CI="${CI:-}" \
  -e E2E_API_PROXY_TARGET="${E2E_API_PROXY_TARGET:-http://localhost:8000}" \
  -e E2E_OIDC_AUTHORITY="${E2E_OIDC_AUTHORITY:-http://keycloak:8080/realms/template-fastapi}" \
  -v "$PWD:$PWD" -w "$PWD" "$IMAGE" \
  node_modules/.bin/playwright test --config tests/e2e/playwright.config.ts "$@"
