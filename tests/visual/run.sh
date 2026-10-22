#!/usr/bin/env bash
# Runs the visual-regression and axe suite inside the pinned Playwright image,
# the only renderer whose output is a valid baseline (ADR 0005).
#
#   tests/visual/run.sh            build Storybook, compare against baselines
#   tests/visual/run.sh update     build Storybook, rewrite the baselines
#
# Extra arguments after the mode go to `playwright test` (e.g. -g HeroesPage).
set -euo pipefail

# The tag must equal the @playwright/test version in package.json: the image
# ships exactly that version's browser build, and Playwright refuses a
# mismatch. The digest (the multi-arch index) pins the exact bytes and is
# bumped together with the tag.
IMAGE="mcr.microsoft.com/playwright:v1.64.1-noble@sha256:7852dc5a7d72f5fe458a597d690f6c42fbc8e9e26ddfa95f8e6ef552558d9bbf"

cd "$(dirname "$0")/../.."
mode=test
case "${1:-}" in test | update) mode="$1" && shift ;; esac

# The baselines are arm64 renders (ADR 0005) and node_modules is mounted from
# the host, so an amd64 host can neither compare nor update them.
if [ "$(uname -m)" != aarch64 ] && [ "$(uname -m)" != arm64 ]; then
  echo "tests/visual/run.sh needs an arm64 host (baselines are arm64, ADR 0005); CI runs it." >&2
  exit 1
fi

args=(--config tests/visual/playwright.config.ts)
[ "$mode" = update ] && args+=(--update-snapshots)

exec docker run --rm --ipc=host --init \
  -u "$(id -u):$(id -g)" -e HOME=/tmp -e CI="${CI:-}" \
  -v "$PWD:$PWD" -w "$PWD" "$IMAGE" \
  bash -c 'node_modules/.bin/storybook build --quiet && exec node_modules/.bin/playwright test "$@"' _ "${args[@]}" "$@"
