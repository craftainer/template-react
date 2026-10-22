#!/usr/bin/env bash
# Runs the pinned skopeo image (SKOPEO_IMAGE, set by the Makefile) as the
# caller's user with HOME=/tmp, and dist/ mounted at /dist. Shared by
# `make publish` and image-smoke.sh so the invocation lives in one place.
#
# Usage: skopeo.sh [DOCKER_RUN_ARGS...] -- SKOPEO_ARGS...
#   DOCKER_RUN_ARGS  extra `docker run` words before `--` (e.g. -i,
#                    -v "$auth:/auth:ro")
#   SKOPEO_ARGS      passed to skopeo (e.g. copy oci-archive:/dist/x.tar ...)
#   SKOPEO_DIST_DIR  directory to mount at /dist (default: ./dist)
set -euo pipefail

: "${SKOPEO_IMAGE:?SKOPEO_IMAGE is required (set by the Makefile)}"

docker_args=()
while [[ $# -gt 0 && "$1" != "--" ]]; do
    docker_args+=("$1")
    shift
done
[[ $# -gt 0 ]] || { echo "usage: $0 [DOCKER_RUN_ARGS...] -- SKOPEO_ARGS..." >&2; exit 2; }
shift

# `${arr[@]+"${arr[@]}"}` below: an empty array is an unbound variable under
# `set -u` on bash older than 4.4 (macOS ships 3.2).
dist="$(cd "${SKOPEO_DIST_DIR:-dist}" && pwd)"

exec docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$dist:/dist" ${docker_args[@]+"${docker_args[@]}"} "$SKOPEO_IMAGE" "$@"
