#!/usr/bin/env bash
# Checks that an already-published release's tag points at the commit this
# release run built, for the `release` job of ../workflows/release.yml (see
# its "Check for an existing release" step).
# Usage: verify_release_tag.sh <owner/repo> <tag> <expected-sha>
# Exit:  0 = the tag resolves to <expected-sha>; 1 = it does not, or it could
#        not be resolved (fail closed: a published release always has its
#        tag, so an unresolvable one cannot be vouched for).
#
# Retries only what can pass on its own: up to TAG_LOOKUP_ATTEMPTS attempts
# (default 6) with a doubling delay starting at TAG_LOOKUP_DELAY seconds
# (default 5, capped at 60), about 2 minutes in all, for an HTTP 5xx, 408 or
# 429, a rate limit, or no HTTP status at all (a network error). That window
# outlasts a secondary rate limit, which GitHub documents as a wait of at
# least a minute. Any other status is permanent and fails at once, and so do
# a missing `gh` or token and a missing tag (HTTP 404, or 422 "No commit found
# for SHA"): retrying cannot restore a deleted tag. GitHub documents no
# read-after-write lag for refs, so a 404 on a just-created tag is not retried
# either; its error message says to re-run once the tag is visible.
# TAG_LOOKUP_ATTEMPTS must be a positive integer and TAG_LOOKUP_DELAY a
# non-negative one, or the script fails at once.
set -euo pipefail

repo="${1:?usage: verify_release_tag.sh <owner/repo> <tag> <expected-sha>}"
tag="${2:?usage: verify_release_tag.sh <owner/repo> <tag> <expected-sha>}"
expected="${3:?usage: verify_release_tag.sh <owner/repo> <tag> <expected-sha>}"
attempts="${TAG_LOOKUP_ATTEMPTS:-6}"
delay="${TAG_LOOKUP_DELAY:-5}"
max_delay=60

# Both knobs are used in arithmetic and `sleep`: reject anything else up front
# (fail closed), rather than let `set -e` die on a bash arithmetic error or
# misread a zero-padded 08 as octal, or loop zero times and report "after 0 attempt(s)".
if ! [[ "$attempts" =~ ^[1-9][0-9]?$ ]]; then
  echo "::error::TAG_LOOKUP_ATTEMPTS must be a positive integer (at most 99), got '${attempts}'." >&2
  exit 1
fi
if ! [[ "$delay" =~ ^(0|[1-9][0-9]{0,3})$ ]]; then
  echo "::error::TAG_LOOKUP_DELAY must be a non-negative integer of seconds without leading zeros (at most 9999), got '${delay}'." >&2
  exit 1
fi

err_file=$(mktemp)
trap 'rm -f "$err_file"' EXIT

tag_sha=
answered=false # whether the last lookup succeeded (with or without a sha)
made=0
for ((attempt = 1; attempt <= attempts; attempt++)); do
  made=$attempt
  # `// empty` turns a response without a sha into an empty string.
  status=0
  tag_sha=$(gh api "repos/${repo}/commits/refs/tags/${tag}" --jq '.sha // empty' 2> "$err_file") || status=$?
  if [ "$status" -eq 0 ]; then
    answered=true
    break
  fi
  tag_sha=
  # Every attempt's stderr goes to the log, labelled; only the last one decides
  # the final message below.
  sed "s/^/attempt ${attempt}\/${attempts}: /" "$err_file" >&2
  # `gh` missing, or run without a token: retrying cannot fix either. gh's
  # own messages for the latter (cli/cli) are "set the GH_TOKEN environment
  # variable" (automation, Actions) and "populate the GH_TOKEN environment
  # variable" (interactive), or GH_ENTERPRISE_TOKEN on a GHES host; other
  # stderr that merely names GH_TOKEN is not it.
  if [ "$status" -eq 127 ] || grep -Eq '(set|populate) the GH_[A-Z_]*TOKEN environment variable' "$err_file"; then
    break
  fi
  # An error with an HTTP status that is not transient is permanent.
  if grep -Eq '\(HTTP [0-9]{3}\)' "$err_file" && ! grep -Eqi '\(HTTP (5[0-9]{2}|408|429)\)|rate limit' "$err_file"; then
    break
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    echo "Tag lookup attempt ${attempt}/${attempts} failed; retrying in ${delay}s." >&2
    sleep "$delay"
    delay=$((delay * 2 > max_delay ? max_delay : delay * 2))
  fi
done

if [ -z "$tag_sha" ]; then
  if grep -Eq '\(HTTP (404|422)\)' "$err_file"; then
    echo "::error::Release ${tag} is published but its tag does not resolve to a commit (HTTP 404 or 422), so it cannot be checked against ${expected}. If the tag was deleted, restore it or delete the release and run the workflow again. If the release was only just created (for example by a concurrent run), re-run this job once the tag is visible."
  elif [ "$answered" = "true" ]; then
    echo "::error::The API answered without a commit sha for tag ${tag}, so it cannot be checked against ${expected}; not publishing under an unverified tag. Re-run the job; if it persists, check that the tag exists."
  else
    echo "::error::Could not resolve tag ${tag} to a commit after ${made} attempt(s), so cannot check it against ${expected}; not publishing under an unverified tag. Re-run the job if this was a transient API error or a rate limit; otherwise see the error above."
  fi
  exit 1
elif [ "$tag_sha" != "$expected" ]; then
  echo "::error::Release ${tag} already exists at commit ${tag_sha}, but this run built ${expected}; not publishing it under the same version. Run the workflow again to get the next version."
  exit 1
fi
echo "Release ${tag} points at ${expected}."
