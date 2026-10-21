# template-react's values for template-docker's image release Makefile
# (`-include image.mk`); see docs/TEMPLATE.md's "Image layer". Merge tier: an
# instance edits this file for its own values and a sync keeps them.

# DOCKERFILE and TARGET keep template-docker's defaults (`Dockerfile`,
# `runner`); ARCHES, OCI_LICENSE too. No APP_VERSION/APP_COMMIT build args:
# the SPA bundle embeds neither. No COVERAGE_REPORT: no coverage asset is
# released.

# The runner is nginx-unprivileged on 8080 serving the SPA. Its env defaults
# point API_PROXY_TARGET at host.docker.internal, which a plain `docker run`
# on Linux can't resolve, and nginx refuses to start on an unresolvable
# upstream -- so the smoke run points it at loopback instead (the smoke test
# never calls /api).
IMAGE_SMOKE_PORT := 8080
IMAGE_SMOKE_PATH := /
IMAGE_SMOKE_RUN_ARGS := -e API_PROXY_TARGET=http://127.0.0.1:8000

# The unit tests that were release-check's whole recipe before the image
# smoke test joined it as a prerequisite.
release-check: unit-tests
unit-tests:
	pnpm test
