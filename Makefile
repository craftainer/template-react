# Image implementation of template-base's release contract (docs/TEMPLATE.md,
# "Release: a Makefile contract"). release.yml sets RELEASE_VERSION /
# RELEASE_TAG / RELEASE_ARCH / OCI_* -- see there. Per-instance values go in
# the optional image.mk (every variable below is `?=`); steps beyond the
# generic ones are extra prerequisites of release-check, set there too.
# Template-owned: a sync overwrites this file.
#
# What gets published is the tar `build` wrote to dist/ -- the one `sbom`
# described and `image-smoke` ran -- copied to the registry with skopeo
# rather than rebuilt, so the registry digest is the tested artifact's. The
# copy is `--all`: the tar's whole index (the image for RELEASE_ARCH plus any
# buildx attestation manifests: provenance and SBOM) is pushed, whatever the
# host's arch, so a non-native RELEASE_ARCH works and attestations survive.
# `created` is the commit time, so rebuilding the same commit yields the same
# labels; layer contents are not guaranteed bit-for-bit reproducible.

-include image.mk

.PHONY: repo-check release-arches build sbom release-assets publish publish-packages verify-published release-check finalize image-smoke check-arch
.DEFAULT_GOAL := release-arches

DOCKERFILE ?= Dockerfile
TARGET ?= runner
ARCHES ?= amd64 arm64
BUILD_ARGS ?=
EXTRA_LABELS ?=
OCI_DESCRIPTION ?=
OCI_LICENSE ?= GPL-3.0-only
COVERAGE_REPORT ?=
IMAGE_SMOKE_PORT ?= 8000
IMAGE_SMOKE_PATH ?= /health/live
IMAGE_SMOKE_RUN_ARGS ?=
IMAGE_SMOKE_TIMEOUT ?= 60

# renovate: datasource=docker depName=anchore/syft
SYFT_VERSION := v1.52.0

# Pinned by tag and digest; Renovate updates both together. Apache-2.0. The
# `-immutable` tag, not `vX.Y.Z`: quay.io rebuilds the plain tags daily and
# garbage-collects their old digests, which would break the digest pin.
SKOPEO_IMAGE := quay.io/skopeo/stable:v1.22.3-immutable@sha256:c0ee1f4edca5c01cb8d5611124f92f3cc47196ecab68aee5d0f90834e00574d5

# owner/repo: GITHUB_REPOSITORY in CI; inside the devcontainer (where
# release-check runs) it is unset, so derive it from the origin remote
# (ssh://[user@]host[:PORT]/o/r, scp-like and https forms, with or without
# credentials and .git; scripts/test-image-scripts.sh checks them). If git
# fails (no origin, "dubious ownership", ...) there is no guess: REPO stays
# empty, git's own error is kept in REPO_ERROR, and every target that needs
# REPO (via repo-check) prints it to stderr and fails.
ifeq ($(GITHUB_REPOSITORY),)
GIT_REMOTE := $(shell url=$$(git remote get-url origin 2>&1) && { printf 'ok '; printf '%s' "$$url" | sed -E 's|^[A-Za-z][A-Za-z0-9+.-]*://([^@/]*@)?([^/:]+):[0-9]+/|\2/|; s|^[A-Za-z][A-Za-z0-9+.-]*://||; s|^[^@/]*@||; s|^[^/:]+[:/]||; s|/$$||; s|\.git$$||'; } || printf 'err %s' "$$url")
ifeq ($(firstword $(GIT_REMOTE)),ok)
REPO := $(word 2,$(GIT_REMOTE))
else
REPO :=
REPO_ERROR := make: cannot derive the repository from the origin remote: $(wordlist 2,$(words $(GIT_REMOTE)),$(GIT_REMOTE)) (set GITHUB_REPOSITORY=owner/repo to override)
export REPO_ERROR
endif
else
REPO := $(GITHUB_REPOSITORY)
endif
OWNER := $(firstword $(subst /, ,$(REPO)))
IMAGE := $(notdir $(REPO))
ASSET_PREFIX := dist/$(IMAGE)-$(RELEASE_VERSION)
ASSET := $(ASSET_PREFIX)-$(RELEASE_ARCH)
RELEASE_URL := https://github.com/$(REPO)/releases/download/$(RELEASE_TAG)
OCI_NAME = $(shell printf '%s' '$(or $(OCI_IMAGE_NAME),$(REPO))' | tr '[:upper:]' '[:lower:]')

# Values that may hold arbitrary characters travel through the environment,
# never through recipe text.
export OCI_DESCRIPTION
export IMAGE_SMOKE_RUN_ARGS IMAGE_SMOKE_PORT IMAGE_SMOKE_PATH IMAGE_SMOKE_TIMEOUT RELEASE_VERSION
export IMAGE_TAR_PREFIX = $(ASSET_PREFIX)
export SKOPEO_IMAGE ARCHES

# Only set in CI, by crazy-max/ghaction-github-runtime in release.yml.
ifdef ACTIONS_RUNTIME_TOKEN
CACHE := --cache-from type=gha,scope=$(RELEASE_ARCH) --cache-to type=gha,mode=max,scope=$(RELEASE_ARCH)
endif

# Recursive (`=`) so git runs only in recipes that build. Description and
# coverage-report are emitted only when set; the description is read from
# the environment so quotes, `$` and backticks in it are safe.
LABELS = \
	--label org.opencontainers.image.title=$(IMAGE) \
	--label org.opencontainers.image.source=https://github.com/$(REPO) \
	--label org.opencontainers.image.url=https://github.com/$(REPO) \
	--label org.opencontainers.image.version=$(RELEASE_VERSION) \
	--label org.opencontainers.image.revision=$(shell git rev-parse HEAD) \
	--label org.opencontainers.image.created=$(shell git log -1 --format=%cI) \
	--label org.opencontainers.image.licenses=$(OCI_LICENSE) \
	--label io.github.$(OWNER).sbom=$(RELEASE_URL)/$(IMAGE)-$(RELEASE_VERSION)-$(RELEASE_ARCH).spdx.json
LABELS += $${OCI_DESCRIPTION:+--label "org.opencontainers.image.description=$$OCI_DESCRIPTION"}
ifneq ($(COVERAGE_REPORT),)
LABELS += --label io.github.$(OWNER).coverage-report=$(RELEASE_URL)/$(COVERAGE_REPORT)
endif
LABELS += $(EXTRA_LABELS)

BUILD = docker buildx build -f $(DOCKERFILE) --target $(TARGET) \
	--platform linux/$(RELEASE_ARCH) $(BUILD_ARGS) $(LABELS) $(CACHE)

REPO_GUARD = test -n "$(REPO)" || { printf '%s\n' "$$REPO_ERROR" >&2; exit 1; }

# Prerequisite of every target whose output names the repo.
repo-check:
	@$(REPO_GUARD)

check-arch:
	@test -n "$(RELEASE_ARCH)" || { echo "RELEASE_ARCH is not set." >&2; exit 1; }

release-arches:
	@test -n "$(strip $(ARCHES))" || { echo "ARCHES is empty; list at least one arch in image.mk." >&2; exit 1; }
	@printf '[%s]\n' "$$(printf '"%s",' $(ARCHES) | sed 's/,$$//')"

build: check-arch repo-check
	mkdir -p dist
	$(BUILD) --output type=oci,dest=$(ASSET).tar .

sbom: check-arch repo-check
	docker run --rm -v "$(CURDIR)/dist:/dist" anchore/syft:$(SYFT_VERSION) \
		oci-archive:/$(ASSET).tar -o spdx-json=/$(ASSET).spdx.json

# Each arch is smoke-tested here, natively on its own runner, before publish.
release-assets: check-arch repo-check image-smoke
	test -f $(ASSET).tar && test -f $(ASSET).spdx.json

# Copies the tested tar from dist/ to the registry (skopeo copy --all
# oci-archive:... docker://...), records the pushed index digest in
# dist/<asset>.digest for finalize, and logs in through a throwaway authfile
# so the password never appears in a command line. Without --all skopeo
# copies one image chosen by the host's platform, which can fail or pick the
# wrong image for a non-native RELEASE_ARCH, and it drops the attestations.
publish: check-arch
ifeq ($(OCI_REGISTRY),)
	@echo "OCI_REGISTRY not set -- skipping publish."
else
	@$(REPO_GUARD)
	@test -f $(ASSET).tar || { echo "$(ASSET).tar not found; run 'make build' first." >&2; exit 1; }
	@auth="$$(mktemp -d)" && chmod 0777 "$$auth" && trap 'rm -rf "$$auth"' EXIT && \
	printf '%s' "$$OCI_REGISTRY_PASSWORD" | bash scripts/skopeo.sh -i -v "$$auth:/auth" -- \
		login --authfile /auth/auth.json -u "$$OCI_REGISTRY_USERNAME" --password-stdin "$(OCI_REGISTRY)" && \
	bash scripts/skopeo.sh -v "$$auth:/auth:ro" -- \
		copy --all --authfile /auth/auth.json --digestfile /$(ASSET).digest \
		oci-archive:/$(ASSET).tar docker://$(OCI_REGISTRY)/$(OCI_NAME):$(RELEASE_VERSION)-$(RELEASE_ARCH)
endif

# Once, after the GitHub release exists, and only when the instance sets
# PYPI_PUBLISH, NPM_PUBLISH or CARGO_PUBLISH. template-docker ships an image,
# not a package, so like base's default this fails loudly when one of those is
# set rather than silently releasing without its package. This Makefile is
# template-owned (a sync overwrites it), so an instance cannot replace the
# target locally: one that publishes packages needs the upload added here, in
# template-docker.
publish-packages:
	@set -e; \
	for v in PYPI_PUBLISH NPM_PUBLISH CARGO_PUBLISH; do \
	  if [ -n "$$(printenv $$v)" ]; then \
	    echo "error: this instance sets $$v but its Makefile doesn't implement publish-packages; add the package upload to template-docker's Makefile (see docs/TEMPLATE.md)" >&2; \
	    exit 1; \
	  fi; \
	done; \
	echo "template-docker ships no package -- nothing to publish."

# Once, after publish-packages succeeded, and only when the instance sets
# PYPI_PUBLISH, NPM_PUBLISH or CARGO_PUBLISH: check the published release
# from the registry (e.g. install it). A no-op by default: there is nothing
# to verify unless an instance implements it.
verify-published:
	@echo "template-docker ships no package -- nothing to verify."

# Smoke-tests the tar in dist/ for RELEASE_ARCH (default: the host's arch).
# image.mk's IMAGE_SMOKE_* values reach the script through the environment.
image-smoke: repo-check
	bash scripts/image-smoke.sh

# No recipe by design: image.mk adds steps as prerequisites, so Make never
# sees two recipes for one target. Runs the host-arch smoke test again
# inside the devcontainer, with the instance's backing services up.
release-check: image-smoke

# One manifest list over the per-arch digests publish recorded (each an
# index of image + attestations; imagetools create merges their manifests),
# so it references exactly the images that were tested and pushed. Logs in
# with a throwaway DOCKER_CONFIG so the password isn't left in
# ~/.docker/config.json. The Docker CLI looks for plugins in
# $DOCKER_CONFIG/cli-plugins, so a user-installed buildx would vanish with
# the swap: the user's cli-plugins directory is linked into the throwaway one.
finalize:
ifeq ($(OCI_REGISTRY),)
	@echo "OCI_REGISTRY not set -- no manifest list to create."
else
	@$(REPO_GUARD)
	@orig="$${DOCKER_CONFIG:-$$HOME/.docker}" && export DOCKER_CONFIG="$$(mktemp -d)" && trap 'rm -rf "$$DOCKER_CONFIG"' EXIT && \
	if [ -d "$$orig/cli-plugins" ]; then ln -s "$$orig/cli-plugins" "$$DOCKER_CONFIG/cli-plugins"; fi && \
	printf '%s' "$$OCI_REGISTRY_PASSWORD" | docker login "$(OCI_REGISTRY)" -u "$$OCI_REGISTRY_USERNAME" --password-stdin && \
	srcs="" && for a in $(ARCHES); do \
		d="$$(cat dist/$(IMAGE)-$(RELEASE_VERSION)-$$a.digest)" || exit 1; \
		srcs="$$srcs $(OCI_REGISTRY)/$(OCI_NAME)@$$d"; \
	done && \
	docker buildx imagetools create --tag $(OCI_REGISTRY)/$(OCI_NAME):$(RELEASE_VERSION) $$srcs && \
	rm -f dist/$(IMAGE)-$(RELEASE_VERSION)-*.digest
endif
