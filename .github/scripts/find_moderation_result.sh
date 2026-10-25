#!/usr/bin/env bash
# Tells whether a moderation worker run uploaded a usable `moderation-result`
# artifact, for the check step of moderate-bug-fix-apply.yml and
# moderate-feature-build-apply.yml (see ../workflows/README.md's "Issue
# moderation" section). Usage: find_moderation_result.sh <owner/repo> <run-id>
#
# Writes `found=true` or `found=false` to $GITHUB_OUTPUT (stdout if unset).
# Asks the API for the artifact by name rather than listing the run's
# artifacts, which returns only the first 30 unless paginated. A missing
# artifact is expected (the worker's jobs were all skipped). An expired one
# is not: the worker did produce a result (the artifacts live for one day), so
# nothing being applied would be silent data loss behind a green job. It fails
# the script, as does any API failure (set -e) or an empty or unrecognised
# response, so a real error is never mistaken for "no result".
set -euo pipefail

repo="${1:?usage: find_moderation_result.sh <owner/repo> <run-id>}"
run_id="${2:?usage: find_moderation_result.sh <owner/repo> <run-id>}"

state=$(gh api "repos/${repo}/actions/runs/${run_id}/artifacts?name=moderation-result&per_page=100" \
  --jq '([.artifacts[] | select(.expired | not)] | length) as $live
    | if $live > 0 then "found" elif (.artifacts | length) > 0 then "expired" else "missing" end')

case "$state" in
  found) found=true ;;
  expired)
    echo "::error::The moderation-result artifact of run ${run_id} has expired before it was applied; re-run the worker workflow." >&2
    exit 1
    ;;
  missing)
    found=false
    echo "No moderation-result artifact on run ${run_id} (the worker run was skipped); nothing to apply."
    ;;
  *)
    echo "::error::Unexpected artifact lookup result '${state}' for run ${run_id}." >&2
    exit 1
    ;;
esac
echo "found=${found}" >> "${GITHUB_OUTPUT:-/dev/stdout}"
