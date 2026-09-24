#!/usr/bin/env bash
# NODE_VERSION and DEBIAN_VERSION are declared in both the base-owned
# Dockerfile (develop stage) and app.Dockerfile (builder stage); the
# runtime bundle must be built with the Node the devcontainer tests
# against. Exits 1 if either differs.
set -euo pipefail

status=0
for arg in NODE_VERSION DEBIAN_VERSION; do
    dev="$(grep -m1 "^ARG ${arg}=" Dockerfile | cut -d= -f2-)"
    app="$(grep -m1 "^ARG ${arg}=" app.Dockerfile | cut -d= -f2-)"
    if [[ "$dev" != "$app" ]]; then
        echo "${arg} mismatch: Dockerfile has '${dev}', app.Dockerfile has '${app}'" >&2
        status=1
    fi
done
exit "$status"
