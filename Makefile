# template-react's implementation of template-base's release contract
# (docs/TEMPLATE.md, "Release: a Makefile contract"): the app.Dockerfile
# `runner` image, per arch, combined into one multi-arch tag by finalize.
# release.yml sets RELEASE_VERSION / RELEASE_TAG / RELEASE_ARCH / OCI_*.

.PHONY: release-arches build sbom release-assets publish release-check finalize

ARCHES := amd64 arm64
REPO := $(or $(GITHUB_REPOSITORY),craftainer/template-react)
IMAGE := $(notdir $(REPO))
ASSET := dist/$(IMAGE)-$(RELEASE_VERSION)-$(RELEASE_ARCH)
OCI_NAME := $(shell printf '%s' '$(or $(OCI_IMAGE_NAME),$(REPO))' | tr '[:upper:]' '[:lower:]')

# renovate: datasource=docker depName=anchore/syft
SYFT_VERSION := v1.18.1

# Only set in CI, where release.yml exposes the Actions cache runtime.
ifdef ACTIONS_RUNTIME_TOKEN
CACHE := --cache-from type=gha,scope=$(RELEASE_ARCH) --cache-to type=gha,mode=max,scope=$(RELEASE_ARCH)
endif

# `created` is the commit time, so build and publish (separate make
# invocations) produce identical labels and therefore the same image.
LABELS := \
	--label org.opencontainers.image.title=$(IMAGE) \
	--label org.opencontainers.image.source=https://github.com/$(REPO) \
	--label org.opencontainers.image.version=$(RELEASE_VERSION) \
	--label org.opencontainers.image.revision=$(shell git rev-parse HEAD) \
	--label org.opencontainers.image.created=$(shell git log -1 --format=%cI) \
	--label org.opencontainers.image.licenses=GPL-3.0

BUILD := docker buildx build -f app.Dockerfile --target runner \
	--platform linux/$(RELEASE_ARCH) $(LABELS) $(CACHE)

release-arches:
	@python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' $(ARCHES)

build:
	mkdir -p dist
	$(BUILD) --output type=oci,dest=$(ASSET).tar .

sbom:
	docker run --rm -v "$(CURDIR)/dist:/dist" anchore/syft:$(SYFT_VERSION) \
		oci-archive:/$(ASSET).tar -o spdx-json=/$(ASSET).spdx.json

release-assets:
	test -f $(ASSET).tar && test -f $(ASSET).spdx.json

# OCI_REGISTRY_PASSWORD is a PAT (write:packages for ghcr.io) -- release.yml
# grants GITHUB_TOKEN no packages scope.
publish:
ifeq ($(OCI_REGISTRY),)
	@echo "OCI_REGISTRY not set -- skipping publish."
else
	@printf '%s' "$$OCI_REGISTRY_PASSWORD" | docker login "$(OCI_REGISTRY)" -u "$$OCI_REGISTRY_USERNAME" --password-stdin
	$(BUILD) --push -t $(OCI_REGISTRY)/$(OCI_NAME):$(RELEASE_VERSION)-$(RELEASE_ARCH) .
endif

release-check:
	pnpm test

finalize:
ifeq ($(OCI_REGISTRY),)
	@echo "OCI_REGISTRY not set -- no manifest list to create."
else
	@printf '%s' "$$OCI_REGISTRY_PASSWORD" | docker login "$(OCI_REGISTRY)" -u "$$OCI_REGISTRY_USERNAME" --password-stdin
	docker buildx imagetools create --tag $(OCI_REGISTRY)/$(OCI_NAME):$(RELEASE_VERSION) \
		$(foreach a,$(ARCHES),$(OCI_REGISTRY)/$(OCI_NAME):$(RELEASE_VERSION)-$(a))
endif
