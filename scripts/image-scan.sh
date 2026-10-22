#!/usr/bin/env bash
# Scans the image tar `make build` left in dist/ for the current release
# version and arch for HIGH/CRITICAL vulnerabilities that have a fix, with
# Trivy. Skips when there is none. Which tar: RELEASE_ARCH (default: the
# host's) selects the arch; RELEASE_VERSION selects dist/*-<version>-<arch>.tar,
# and when unset the newest dist/*-<arch>.tar is used, so tars of older
# versions or other arches left in dist/ are never scanned.
# Run by the manual-stage `image-scan` pre-commit hook; needs Docker and
# network access (the vulnerability DB is cached in the trivy-cache volume).
#
# Trivy reads a `docker save` tar or an OCI layout *directory*, not the OCI
# layout tar buildx writes, so those tars are unpacked first. The arch in its
# name (<name>-<arch>.tar) selects the image manifest, so a buildx
# provenance/SBOM attestation manifest in the same tar is never scanned
# instead of the image.
#
# The Trivy image is pinned by digest as well as tag, as the mitigation for
# the March 2026 compromise of Trivy's releases and images
# (GHSA-69fq-xp46-6x23). Renovate bumps both together.
set -euo pipefail

trivy=aquasec/trivy:0.76.0@sha256:2416d1f74045b57274df1a340eee6b510cacd73c66a6ccb8da092b117eb7d222

case "$(uname -m)" in
    aarch64 | arm64) host_arch=arm64 ;;
    *) host_arch=amd64 ;;
esac
arch="${RELEASE_ARCH:-$host_arch}"

shopt -s nullglob
tars=()
if [[ -n "${RELEASE_VERSION:-}" ]]; then
    tars=(dist/*-"$RELEASE_VERSION-$arch".tar)
else
    newest=""
    for t in dist/*-"$arch".tar; do
        if [[ -z "$newest" || "$t" -nt "$newest" ]]; then newest="$t"; fi
    done
    if [[ -n "$newest" ]]; then tars=("$newest"); fi
fi
if [[ ${#tars[@]} -eq 0 ]]; then
    echo "image-scan: no linux/$arch image tar in dist/${RELEASE_VERSION:+ for $RELEASE_VERSION}, skipping"
    exit 0
fi

# Under dist/ (gitignored), not /tmp, so the path also exists for a Docker
# daemon that shares the workspace but not the caller's /tmp.
work="$(mktemp -d dist/.image-scan.XXXXXX)"
trap 'rm -rf "$work"' EXIT

status=0
for t in "${tars[@]}"; do
    name="$(basename "$t" .tar)"
    arch="${name##*-}"
    echo "image-scan: $t (linux/$arch)"
    if tar -tf "$t" manifest.json >/dev/null 2>&1; then
        # A `docker save` tar: Trivy reads it as is.
        mount=("$PWD/$t:/image.tar:ro")
        input=/image.tar
    else
        layout="$PWD/$work/$name"
        mkdir -p "$layout"
        tar -xf "$t" -C "$layout"
        chmod -R a+rX "$layout"
        mount=("$layout:/image:ro")
        input=/image
    fi
    docker run --rm -v trivy-cache:/root/.cache -v "${mount[0]}" "$trivy" \
        image --input "$input" --platform "linux/$arch" \
        --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 || status=1
done
exit "$status"
