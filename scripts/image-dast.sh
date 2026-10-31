#!/usr/bin/env bash
# Passive DAST of the release image: loads the image tar `make build` left in
# dist/ for the current release version and arch, runs it exactly as
# image-smoke.sh does, waits for the smoke URL to answer 2xx, then runs the
# ZAP baseline scan (passive rules only, no attacks) against it. Skips when
# there is no tar. Run by the manual-stage `image-dast` pre-commit hook;
# needs Docker and network access (to pull the ZAP image).
#
# Which tar: RELEASE_ARCH (default: the host's) selects the arch;
# RELEASE_VERSION selects dist/*-<version>-<arch>.tar, and when unset the
# newest dist/*-<arch>.tar is used (as image-scan.sh does).
#
# The container is started the way image-smoke.sh starts it: skopeo.sh
# converts the tar for `docker load`, then `docker run -d -p 127.0.0.1::PORT`.
# The IMAGE_SMOKE_* settings (port, path, extra run args, timeout) and
# SKOPEO_IMAGE are read from the environment, or, when this is run outside
# `make` (the hook), from the Makefile and image.mk.
#   IMAGE_DAST_PATH         URL path the spider starts from (default:
#                           IMAGE_SMOKE_PATH)
#   IMAGE_DAST_SPIDER_MINS  minutes ZAP spiders for (default 1)
#   IMAGE_DAST_RULES        rule levels file (default .zap/rules.tsv, which
#                           the instance owns); skipped when it doesn't exist
#
# ZAP joins the app container's network namespace (`--network container:`),
# so it reaches the app on 127.0.0.1:PORT and nothing is exposed on the host
# network. Reports go to dist/dast/ (report.html, report.json).
#
# Exit codes of zap-baseline.py (https://www.zaproxy.org/docs/docker/baseline-scan/):
# 0 nothing found, 2 warnings only: both pass. 1 at least one rule at FAIL,
# 3 any other failure: both fail. `-I` is not used: it would also turn the
# FAIL level into a pass.
#
# The ZAP image is pinned by digest as well as tag. Renovate bumps both.
set -euo pipefail

zap=ghcr.io/zaproxy/zaproxy:2.17.0@sha256:030d3df57735dacbb83464854758e674dd9ad01d79d12a129a8e58b1fd384238

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

case "$(uname -m)" in
    aarch64 | arm64) host_arch=arm64 ;;
    *) host_arch=amd64 ;;
esac
arch="${RELEASE_ARCH:-$host_arch}"

shopt -s nullglob
tar=""
if [[ -n "${RELEASE_VERSION:-}" ]]; then
    matches=(dist/*-"$RELEASE_VERSION-$arch".tar)
    if [[ ${#matches[@]} -gt 0 ]]; then tar="${matches[0]}"; fi
else
    for t in dist/*-"$arch".tar; do
        if [[ -z "$tar" || "$t" -nt "$tar" ]]; then tar="$t"; fi
    done
fi
if [[ -z "$tar" ]]; then
    echo "image-dast: no linux/$arch image tar in dist/${RELEASE_VERSION:+ for $RELEASE_VERSION}, skipping"
    exit 0
fi

# Outside `make` the smoke settings are not in the environment; ask make for
# them (it applies the defaults and image.mk). A caller's own values win.
if [[ -z "${SKOPEO_IMAGE:-}" ]]; then
    mkfile="$(mktemp)"
    cat >"$mkfile" <<'EOF_MK'
image-dast-vars:
	@printf '%s\n' "$$SKOPEO_IMAGE" "$$IMAGE_SMOKE_PORT" "$$IMAGE_SMOKE_PATH" "$$IMAGE_SMOKE_RUN_ARGS" "$$IMAGE_SMOKE_TIMEOUT"
EOF_MK
    vars="$(GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-o/r}" make -s --no-print-directory -f Makefile -f "$mkfile" image-dast-vars)"
    rm -f "$mkfile"
    {
        IFS= read -r SKOPEO_IMAGE
        IFS= read -r mk_port
        IFS= read -r mk_path
        IFS= read -r mk_run_args
        IFS= read -r mk_timeout
    } <<<"$vars"
    : "${IMAGE_SMOKE_PORT:=$mk_port}" "${IMAGE_SMOKE_PATH:=$mk_path}" "${IMAGE_SMOKE_RUN_ARGS:=$mk_run_args}" "${IMAGE_SMOKE_TIMEOUT:=$mk_timeout}"
fi
export SKOPEO_IMAGE
port="${IMAGE_SMOKE_PORT:-8000}"
path="${IMAGE_DAST_PATH:-${IMAGE_SMOKE_PATH:-/health/live}}"
smoke_path="${IMAGE_SMOKE_PATH:-/health/live}"
timeout="${IMAGE_SMOKE_TIMEOUT:-60}"
spider_mins="${IMAGE_DAST_SPIDER_MINS:-1}"
rules="${IMAGE_DAST_RULES:-.zap/rules.tsv}"
if [[ -n "${IMAGE_DAST_RULES:-}" && ! -f "$IMAGE_DAST_RULES" ]]; then
    echo "image-dast: IMAGE_DAST_RULES=$IMAGE_DAST_RULES does not exist" >&2
    exit 1
fi
read -r -a run_args <<<"${IMAGE_SMOKE_RUN_ARGS:-}"

cid=""
work=""
image=""
# shellcheck disable=SC2329  # invoked by the EXIT trap below
cleanup() {
    status=$?
    set +e
    if [[ -n "$cid" ]]; then
        if [[ $status -ne 0 ]]; then
            echo "image-dast: container logs:" >&2
            docker logs "$cid" >&2 || true
        fi
        docker rm -f "$cid" >/dev/null 2>&1 || true
    fi
    [[ -z "$image" ]] || docker image rm "$image" >/dev/null 2>&1 || true
    [[ -z "$work" ]] || rm -rf "$work" || true
    exit "$status"
}
trap cleanup EXIT

# Same load as image-smoke.sh: the tar is an OCI layout `docker load` can't
# read, so skopeo converts the image for $arch into a docker-archive under
# dist/ (mounted at /dist, so the path also exists for a Docker daemon that
# shares the workspace but not this process's /tmp).
echo "image-dast: loading $tar (linux/$arch)"
tar_dir="$(cd "$(dirname "$tar")" && pwd)"
work="$(mktemp -d "$tar_dir/.image-dast.XXXXXX")"
# 0777: the container's user (ZAP runs as uid 1000) must be able to write
# the reports here, also with rootless or userns-remapped Docker.
chmod 0777 "$work"
image="image-dast-$RANDOM$RANDOM:dast"
SKOPEO_DIST_DIR="$tar_dir" bash "$root/scripts/skopeo.sh" -- \
    --override-os linux --override-arch "$arch" \
    copy "oci-archive:/dist/$(basename "$tar")" \
    "docker-archive:/dist/$(basename "$work")/image.tar:$image"
docker load -i "$work/image.tar"
rm -f "$work/image.tar"

# ${run_args[@]+...}: an empty array is unbound under `set -u` on bash < 4.4.
cid="$(docker run -d -p "127.0.0.1::${port}" ${run_args[@]+"${run_args[@]}"} "$image")"
ports="$(docker port "$cid" "${port}/tcp")"
mapped="${ports%%$'\n'*}"
mapped="${mapped##*:}"
if [[ -z "$mapped" ]]; then
    echo "image-dast: container publishes no host port for ${port}/tcp" >&2
    exit 1
fi
url="http://127.0.0.1:${mapped}${smoke_path}"

echo "image-dast: waiting up to ${timeout}s for $url"
deadline=$((SECONDS + timeout))
ready=""
while ((SECONDS < deadline)); do
    if [[ "$(docker inspect -f '{{.State.Running}}' "$cid")" != "true" ]]; then
        echo "image-dast: container exited before answering" >&2
        exit 1
    fi
    if curl -fsS --max-time 5 -o /dev/null "$url" 2>/dev/null; then
        ready=1
        break
    fi
    sleep 1
done
if [[ -z "$ready" ]]; then
    echo "image-dast: timed out after ${timeout}s waiting for $url" >&2
    exit 1
fi

zap_args=(-t "http://127.0.0.1:${port}${path}" -m "$spider_mins" -r report.html -J report.json)
if [[ -f "$rules" ]]; then
    cp "$rules" "$work/rules.tsv"
    chmod a+r "$work/rules.tsv"
    zap_args+=(-c rules.tsv)
fi

echo "image-dast: ZAP baseline against ${zap_args[1]} (rules: ${rules})"
zap_status=0
docker run --rm --network "container:$cid" -v "$work:/zap/wrk:rw" "$zap" \
    zap-baseline.py "${zap_args[@]}" || zap_status=$?

if [[ -f "$work/report.html" || -f "$work/report.json" ]]; then
    rm -rf dist/dast
    mkdir -p dist/dast
    for f in report.html report.json; do
        if [[ -f "$work/$f" ]]; then cp "$work/$f" "dist/dast/$f"; fi
    done
fi
echo "image-dast: reports in dist/dast/"

case "$zap_status" in
    0) echo "image-dast: no findings" ;;
    2) echo "image-dast: warnings only (exit 2), counted as a pass" ;;
    1)
        echo "image-dast: at least one rule at FAIL (see .zap/rules.tsv)" >&2
        exit 1
        ;;
    *)
        echo "image-dast: zap-baseline.py failed (exit $zap_status)" >&2
        exit 1
        ;;
esac
