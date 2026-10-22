#!/usr/bin/env bash
# Runs the visual-regression and axe suite inside the pinned Playwright image,
# the only renderer whose output is a valid baseline (ADR 0005).
#
#   tests/visual/run.sh            build Storybook, compare against baselines
#   tests/visual/run.sh update     build Storybook, rewrite the baselines
#
# Extra arguments after the mode go to `playwright test` (e.g. -g HeroesPage).
set -euo pipefail

# Must equal the @playwright/test version in package.json: the image ships
# exactly that version's browser build, and Playwright refuses a mismatch.
IMAGE="mcr.microsoft.com/playwright:v1.64.1-noble"

cd "$(dirname "$0")/../.."
mode="${1:-test}"
[ "$#" -gt 0 ] && shift

args=(--config tests/visual/playwright.config.ts)
[ "$mode" = update ] && args+=(--update-snapshots)

exec docker run --rm --ipc=host --init \
  -u "$(id -u):$(id -g)" -e HOME=/tmp -e CI="${CI:-}" \
  -v "$PWD:$PWD" -w "$PWD" "$IMAGE" \
  bash -c 'node_modules/.bin/storybook build --quiet && exec node_modules/.bin/playwright test "$@"' _ "${args[@]}" "$@"
