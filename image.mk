# template-react's values for template-docker's image release Makefile
# (`-include image.mk`); see docs/TEMPLATE.md's "Image layer". Merge tier: an
# instance edits this file for its own values and a sync keeps them.

# DOCKERFILE and TARGET keep template-docker's defaults (`Dockerfile`,
# `runner`); ARCHES, OCI_LICENSE too. No APP_VERSION/APP_COMMIT build args:
# the SPA bundle embeds neither. No COVERAGE_REPORT: no coverage asset is
# released.

# The runner is Node (unprivileged) running bff/ on 8080. /health/live is 200
# without Valkey or the IdP (both are connected lazily), but loadConfig still
# needs the four required env vars, so the smoke run sets dummy values (no
# whitespace: the script splits this on spaces). NODE_ENV=production in the
# image refuses a plaintext non-loopback session-store URL, hence rediss://.
IMAGE_SMOKE_PORT := 8080
IMAGE_SMOKE_PATH := /health/live
IMAGE_SMOKE_RUN_ARGS := -e PUBLIC_ORIGIN=https://app.example.test -e OIDC_ISSUER=https://idp.example.test/realms/smoke -e OIDC_CLIENT_SECRET=smoke-dummy-secret -e SESSION_STORE_URL=rediss://valkey.invalid:6379

# The unit tests that were release-check's whole recipe before the image
# smoke test joined it as a prerequisite.
# .PHONY so a directory named unit-tests can't make Make skip the tests.
.PHONY: unit-tests
release-check: unit-tests
unit-tests:
	pnpm test
