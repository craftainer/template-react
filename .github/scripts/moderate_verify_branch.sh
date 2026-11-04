#!/usr/bin/env bash
# Run on the runner, from the trusted snapshot of the default branch, before
# Claude starts on a repro/plan branch: the branch must not differ from its
# merge base with the default branch in any path moderate_check_paths.sh denies
# (devcontainer, image build, hook config, scripts that run with credentials).
# The branch was created by moderate_apply_triage.sh from a checked patch, so
# this only fails when someone else pushed to it; then no Claude step runs and
# the packaging step reports the note below as a `needs-human` outcome.
#
# Usage (cwd = the checkout of the branch): moderate_verify_branch.sh <trusted_sha>
set -euo pipefail

# shellcheck source=moderate_lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/moderate_lib.sh"

trusted_sha="$1"
is_sha "$trusted_sha" || { echo "::error::trusted sha is not a full sha" >&2; exit 1; }

merge_base="$(git merge-base "$trusted_sha" HEAD)"
if ! check_result_tree "$merge_base"; then
  mkdir -p .moderation-out
  printf '%s\n' \
    "The branch changes a path the automation does not build on (CI, devcontainer, hook or release configuration, a symlink or a submodule), so no automated run was started. A maintainer needs to look at the branch." \
    > .moderation-out/outcome.md
  exit 1
fi
