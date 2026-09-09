# The release contract release.yml drives -- see docs/TEMPLATE.md's
# "Release: a Makefile contract" section. This instance's one release
# artifact is the `runner` stage's production image, tagged with
# RELEASE_VERSION and published to GHCR.

RELEASE_VERSION ?= dev
IMAGE_NAME ?= ghcr.io/craftainer/template-react
IMAGE := $(IMAGE_NAME):$(RELEASE_VERSION)

# renovate: datasource=docker depName=anchore/syft
SYFT_VERSION = v1.18.1

.PHONY: build sbom release-assets publish

build:
	docker build --target runner --tag $(IMAGE) .

sbom:
	@mkdir -p dist
	docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
		anchore/syft:$(SYFT_VERSION) $(IMAGE) -o cyclonedx-json > dist/sbom.cdx.json

release-assets:
	@mkdir -p dist

publish:
	@if [ -z "$$GITHUB_TOKEN" ] && [ -z "$$GHCR_TOKEN" ]; then \
		echo "No GHCR credentials in the environment -- skipping publish."; \
	else \
		docker push $(IMAGE); \
	fi
