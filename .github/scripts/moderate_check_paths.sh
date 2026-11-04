#!/usr/bin/env bash
# Path allow-list for anything the issue-moderation automation (Claude, via a
# patch) is allowed to change. Reads NUL-separated repository paths on stdin;
# prints each denied path to stderr and exits 1 if there was any.
#
# Denied: everything that decides what runs with credentials later -- CI and
# its scripts, the devcontainer and image build, the hook configuration, the
# release and Make machinery, and Claude's own configuration. A fix that really
# needs one of these is not built automatically: it becomes a `needs-human`
# note for a maintainer. See ../workflows/README.md's "Issue moderation".
set -euo pipefail

denied=0
while IFS= read -r -d '' path; do
  case "$path" in
    .github/* | .devcontainer/* | .claude/* | .vscode/* | .mcp.json | \
      .pre-commit-config.yaml | .pre-commit-config.yml | .gitattributes | .gitmodules | \
      Makefile | */Makefile | GNUmakefile | */GNUmakefile | makefile | */makefile | *.mk | \
      scripts/release* | scripts/develop.sh | scripts/post-create.sh | \
      scripts/develop.d/* | scripts/post-create.d/* | \
      Dockerfile* | */Dockerfile* | dockerfile* | */dockerfile* | *.Dockerfile | *.dockerfile | \
      compose*.y*ml | */compose*.y*ml | docker-compose*.y*ml | */docker-compose*.y*ml)
      echo "::error::denied path: $path" >&2
      denied=1
      ;;
    *) ;;
  esac
done

exit "$denied"
