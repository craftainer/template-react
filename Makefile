# The release contract release.yml drives -- see docs/TEMPLATE.md's
# "Release: a Makefile contract" section. This template itself ships no
# artifact, so every target is a documented no-op; an instance reimplements
# each target for its own artifact type (an OCI image, a package, a chart,
# ...) without needing to touch release.yml.

.PHONY: build sbom release-assets publish

build:
	@echo "template-base ships no artifact -- nothing to build."

sbom:
	@echo "template-base ships no artifact -- nothing to scan."

release-assets:
	@mkdir -p dist

publish:
	@echo "template-base ships no artifact -- nothing to publish."
