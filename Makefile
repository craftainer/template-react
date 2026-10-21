# Image implementation of template-base's release contract (docs/TEMPLATE.md,
# "Release: a Makefile contract"). release.yml sets RELEASE_VERSION /
# RELEASE_TAG / RELEASE_ARCH / OCI_* -- see there. Per-instance values go in
# the optional image.mk (every variable below is `?=`); steps beyond the
# generic ones are extra prerequisites of release-check, set there too.
# Template-owned: a sync overwrites this file.
#
# What gets published is the tar `build` wrote to dist/ -- the one `sbom`
# described and `image-smoke` ran -- copied to the registry with skopeo
# rather than rebuilt, so the registry digest is the tested artifact's.
# `created` is the commit time, so rebuilding the same commit yields the same
# labels; layer contents are not guaranteed bit-for-bit reproducible.

-include image.mk

.PHONY: release-arches build sbom release-assets publish release-check finalize image-smoke check-arch
.DEFAULT_GOAL := release-arches

DOCKERFILE ?= Dockerfile
TARGET ?= runner
ARCHES ?= amd64 arm64
BUILD_ARGS ?=
EXTRA_LABELS ?=
OCI_DESCRIPTION ?=
OCI_LICENSE ?= GPL-3.0-or-later
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
# (ssh, scp-like and https forms, with or without credentials and .git);
# the directory name is the last resort.
REPO := $(or $(GITHUB_REPOSITORY),$(shell git remote get-url origin 2>/dev/null | sed -E 's|^[a-z+]+://([^@/]*@)?([^/:]+):[0-9]+/|\2/|; s|^[a-z+]+://||; s|^[^@/]*@||; s|^[^/:]+[:/]||; s|/$$||; s|\.git$$||'),$(notdir $(CURDIR)))
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
export SKOPEO_IMAGE

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

check-arch:
	@test -n "$(RELEASE_ARCH)" || { echo "RELEASE_ARCH is not set." >&2; exit 1; }

release-arches:
	@test -n "$(strip $(ARCHES))" || { echo "ARCHES is empty; list at least one arch in image.mk." >&2; exit 1; }
	@printf '[%s]\n' "$$(printf '"%s",' $(ARCHES) | sed 's/,$$//')"

build: check-arch
	mkdir -p dist
	$(BUILD) --output type=oci,dest=$(ASSET).tar .

sbom: check-arch
	docker run --rm -v "$(CURDIR)/dist:/dist" anchore/syft:$(SYFT_VERSION) \
		oci-archive:/$(ASSET).tar -o spdx-json=/$(ASSET).spdx.json

# Each arch is smoke-tested here, natively on its own runner, before publish.
release-assets: check-arch image-smoke
	test -f $(ASSET).tar && test -f $(ASSET).spdx.json

# Copies the tested tar from dist/ to the registry (skopeo copy
# oci-archive:... docker://...), records the pushed manifest digest in
# dist/<asset>.digest for finalize, and logs in through a throwaway authfile
# so the password never appears in a command line.
publish: check-arch
ifeq ($(OCI_REGISTRY),)
	@echo "OCI_REGISTRY not set -- skipping publish."
else
	@test -f $(ASSET).tar || { echo "$(ASSET).tar not found; run 'make build' first." >&2; exit 1; }
	@auth="$$(mktemp -d)" && trap 'rm -rf "$$auth"' EXIT && \
	printf '%s' "$$OCI_REGISTRY_PASSWORD" | bash scripts/skopeo.sh -i -v "$$auth:/auth" -- \
		login --authfile /auth/auth.json -u "$$OCI_REGISTRY_USERNAME" --password-stdin "$(OCI_REGISTRY)" && \
	bash scripts/skopeo.sh -v "$$auth:/auth:ro" -- \
		copy --authfile /auth/auth.json --digestfile /$(ASSET).digest \
		oci-archive:/$(ASSET).tar docker://$(OCI_REGISTRY)/$(OCI_NAME):$(RELEASE_VERSION)-$(RELEASE_ARCH)
endif

# Smoke-tests the tar in dist/ for RELEASE_ARCH (default: the host's arch).
# image.mk's IMAGE_SMOKE_* values reach the script through the environment.
image-smoke:
	bash scripts/image-smoke.sh

# No recipe by design: image.mk adds steps as prerequisites, so Make never
# sees two recipes for one target. Runs the host-arch smoke test again
# inside the devcontainer, with the instance's backing services up.
release-check: image-smoke

# One manifest list over the per-arch digests publish recorded, so it
# references exactly the images that were tested and pushed. Logs in with a
# throwaway DOCKER_CONFIG so the password isn't left in ~/.docker/config.json.
finalize:
ifeq ($(OCI_REGISTRY),)
	@echo "OCI_REGISTRY not set -- no manifest list to create."
else
	@export DOCKER_CONFIG="$$(mktemp -d)" && trap 'rm -rf "$$DOCKER_CONFIG"' EXIT && \
	printf '%s' "$$OCI_REGISTRY_PASSWORD" | docker login "$(OCI_REGISTRY)" -u "$$OCI_REGISTRY_USERNAME" --password-stdin && \
	srcs="" && for a in $(ARCHES); do \
		d="$$(cat dist/$(IMAGE)-$(RELEASE_VERSION)-$$a.digest)" || exit 1; \
		srcs="$$srcs $(OCI_REGISTRY)/$(OCI_NAME)@$$d"; \
	done && \
	docker buildx imagetools create --tag $(OCI_REGISTRY)/$(OCI_NAME):$(RELEASE_VERSION) $$srcs
endif
