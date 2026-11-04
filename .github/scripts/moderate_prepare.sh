#!/usr/bin/env bash
# Run on the runner, from the trusted snapshot of the default branch, in the
# workspace the Claude step will use. Installs the trusted copies of what the
# Claude step executes or reads as configuration, and the scratch directory
# Claude writes its result to, then hides both from git so an agent's
# `git add -A` cannot commit them:
#
#   .moderation-tools/run_claude.sh               the launcher
#   .moderation-tools/prompts/                    the stage prompts
#   .moderation-tools/pre-commit-config.yaml      the hook config prek runs
#   .moderation-out/                              Claude's result files
#
# The tree Claude edits is never the source of any of these, so a changed
# `.pre-commit-config.yaml` or run_claude.sh in it is never executed with the
# API key present. See ../workflows/README.md's "Issue moderation".
#
# Usage: moderate_prepare.sh <trusted_dir>   (cwd = the workspace)
set -euo pipefail

trusted="$1"

mkdir -p .moderation-tools/prompts .moderation-out
install -m 755 "$trusted/.github/scripts/run_claude.sh" .moderation-tools/run_claude.sh
cp -- "$trusted"/.github/scripts/prompts/*.md .moderation-tools/prompts/
cp -- "$trusted/.pre-commit-config.yaml" .moderation-tools/pre-commit-config.yaml

exclude="$(git rev-parse --git-path info/exclude)"
mkdir -p "$(dirname "$exclude")"
printf '%s\n' '/.moderation-tools/' '/.moderation-out/' >> "$exclude"
