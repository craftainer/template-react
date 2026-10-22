#!/usr/bin/env bash
# Loads the release image tar that `make build` left in dist/, runs it and
# polls a URL until it answers 2xx. Always removes the container; prints its
# logs on failure.
#
# Usage: image-smoke.sh   (configured by environment; `make image-smoke`
# sets these)
#   SKOPEO_IMAGE         required (the Makefile sets it); converts the tar for docker load
#   IMAGE_TAR_PREFIX     required; tar is "$IMAGE_TAR_PREFIX-<arch>.tar"
#                        (e.g. dist/template-docker-1.2.3)
#   RELEASE_VERSION      if that tar is missing (the image name may differ
#                        when the repository name can't be derived), the one
#                        dist/*-$RELEASE_VERSION-<arch>.tar is used instead
#   RELEASE_ARCH         arch to test; default: the host's. A missing tar
#                        for that arch is an error, so a run never passes
#                        without having tested an image. The one exception:
#                        RELEASE_ARCH unset and the host's arch not in
#                        ARCHES, i.e. this instance doesn't build it
#   ARCHES               space-separated arches the instance builds (the
#                        Makefile sets it); only used for that exception
#   IMAGE_SMOKE_PORT     container port (default 8000)
#   IMAGE_SMOKE_PATH     URL path (default /health/live)
#   IMAGE_SMOKE_RUN_ARGS extra `docker run` words, whitespace-separated and
#                        without embedded spaces or quotes, e.g. "-e FOO=bar"
#                        (read from the environment, never from recipe text)
#   IMAGE_SMOKE_TIMEOUT  seconds to wait (default 60)
set -euo pipefail

prefix="${IMAGE_TAR_PREFIX:?IMAGE_TAR_PREFIX is required}"
port="${IMAGE_SMOKE_PORT:-8000}"
path="${IMAGE_SMOKE_PATH:-/health/live}"
timeout="${IMAGE_SMOKE_TIMEOUT:-60}"
read -r -a run_args <<<"${IMAGE_SMOKE_RUN_ARGS:-}"

case "$(uname -m)" in
    aarch64 | arm64) host_arch=arm64 ;;
    *) host_arch=amd64 ;;
esac
arch="${RELEASE_ARCH:-$host_arch}"
tar="$prefix-$arch.tar"
if [[ ! -f "$tar" && -n "${RELEASE_VERSION:-}" ]]; then
    shopt -s nullglob
    candidates=("$(dirname "$prefix")"/*-"$RELEASE_VERSION-$arch".tar)
    if [[ ${#candidates[@]} -eq 1 ]]; then
        tar="${candidates[0]}"
    fi
fi
if [[ ! -f "$tar" ]]; then
    if [[ -z "${RELEASE_ARCH:-}" && -n "${ARCHES:-}" && " ${ARCHES} " != *" $host_arch "* ]]; then
        echo "image-smoke: this instance doesn't build $host_arch (ARCHES=$ARCHES), so there is no image to run on this host; each arch is smoke-tested by its own build leg. Skipping."
        exit 0
    fi
    echo "image-smoke: $tar not found; run 'make build' first." >&2
    exit 1
fi

cid=""
work=""
image=""
# shellcheck disable=SC2329  # invoked by the EXIT trap below
cleanup() {
    status=$?
    set +e
    if [[ -n "$cid" ]]; then
        if [[ $status -ne 0 ]]; then
            echo "image-smoke: container logs:" >&2
            docker logs "$cid" >&2 || true
        fi
        docker rm -f "$cid" >/dev/null 2>&1 || true
    fi
    [[ -z "$image" ]] || docker image rm "$image" >/dev/null 2>&1 || true
    [[ -z "$work" ]] || rm -rf "$work" || true
    exit "$status"
}
trap cleanup EXIT

# `docker load` can't read the OCI-layout tar buildx writes (no manifest.json;
# with attestations the index nests another index), so skopeo converts the
# one image for $arch into a docker-archive first. Both live under dist/,
# which is mounted at /dist, so the paths also exist for a Docker daemon
# that shares the workspace but not this process's /tmp.
: "${SKOPEO_IMAGE:?SKOPEO_IMAGE is required (set by the Makefile)}"
echo "image-smoke: loading $tar (linux/$arch)"
tar_dir="$(cd "$(dirname "$tar")" && pwd)"
work="$(mktemp -d "$tar_dir/.image-smoke.XXXXXX")"
# mktemp makes the directory 0700; with rootless or userns-remapped Docker
# the container's user can't write into it. It only exists inside dist/, for
# the length of this script.
chmod 0777 "$work"
# Run (and later remove) a private reference, so cleanup never touches an
# image that already existed.
image="image-smoke-$RANDOM$RANDOM:smoke"
SKOPEO_DIST_DIR="$tar_dir" bash "$(dirname "${BASH_SOURCE[0]}")/skopeo.sh" -- \
    --override-os linux --override-arch "$arch" \
    copy "oci-archive:/dist/$(basename "$tar")" \
    "docker-archive:/dist/$(basename "$work")/image.tar:$image"
docker load -i "$work/image.tar"

# ${run_args[@]+...}: an empty array is unbound under `set -u` on bash < 4.4.
cid="$(docker run -d -p "127.0.0.1::${port}" ${run_args[@]+"${run_args[@]}"} "$image")"
# No `| head -n1`: head closing the pipe early can SIGPIPE `docker port`,
# which fails the pipeline under pipefail. Take the first line in the shell.
ports="$(docker port "$cid" "${port}/tcp")"
mapped="${ports%%$'\n'*}"
mapped="${mapped##*:}"
if [[ -z "$mapped" ]]; then
    echo "image-smoke: container publishes no host port for ${port}/tcp" >&2
    exit 1
fi
url="http://127.0.0.1:${mapped}${path}"

echo "image-smoke: waiting up to ${timeout}s for $url"
deadline=$((SECONDS + timeout))
while ((SECONDS < deadline)); do
    if [[ "$(docker inspect -f '{{.State.Running}}' "$cid")" != "true" ]]; then
        echo "image-smoke: container exited before answering" >&2
        exit 1
    fi
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then
        echo "image-smoke: $url answered 2xx"
        exit 0
    fi
    sleep 1
done
echo "image-smoke: timed out after ${timeout}s waiting for $url" >&2
exit 1
