#!/usr/bin/env bash
# Packages a Claude job's result -- a git patch plus outcome metadata, never
# anything executed -- for the privileged "apply" job of the same workflow to
# consume via a job-to-job artifact. See ../workflows/README.md's "Issue
# moderation" section: keeping push/PR/label-write capability out of the job
# that runs Claude against untrusted issue text is what closes CodeQL's
# actions/untrusted-checkout alert -- this job never holds a write-scoped
# GITHUB_TOKEN.
#
# Runs on the runner, from the trusted snapshot of the default branch (never
# from the tree Claude edited), and does not trust that tree's git config: the
# commits are fetched into a fresh bare repository and read there.
#
# Usage: moderate_package_result.sh <base_sha> <out_dir> <workspace> <mode>
#   mode build   fix/build: .moderation-out/outcome.md explains a non-result
#   mode triage  triage: .moderation-out/triage.json = {"action","comment"}
# Needs GITHUB_ISSUE_NUMBER in the environment.
set -euo pipefail

# shellcheck source=moderate_lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/moderate_lib.sh"

base_sha="$1"
out_dir="$2"
workspace="$3"
mode="$4"

case "$mode" in build | triage) ;; *)
  echo "::error::unknown mode '$mode'" >&2
  exit 1
  ;;
esac
[[ "${GITHUB_ISSUE_NUMBER:-}" =~ ^[0-9]+$ ]] || { echo "::error::GITHUB_ISSUE_NUMBER is not numeric" >&2; exit 1; }

mkdir -p "$out_dir"
safe="$(mktemp -d)"
trap 'rm -rf "$safe"' EXIT
git init -q --bare "$safe"

# Number of new commits on top of base_sha in the agent's repository (0 when
# the history was rewritten so that base_sha is no longer an ancestor).
commits=0
if is_sha "$base_sha" \
  && git --git-dir="$safe" -c protocol.file.allow=always fetch -q --no-tags --no-write-fetch-head \
    -- "$workspace" "+HEAD:refs/heads/result" \
  && git --git-dir="$safe" merge-base --is-ancestor "$base_sha" refs/heads/result; then
  commits="$(git --git-dir="$safe" rev-list --count "$base_sha..refs/heads/result")"
fi

# Patch, when there is something to apply and it is small enough.
have_patch=0
too_large=0
if [ "$commits" -gt 0 ]; then
  git --git-dir="$safe" format-patch "$base_sha..refs/heads/result" --binary --stdout > "$out_dir/patch.diff"
  if [ "$(wc -c < "$out_dir/patch.diff")" -gt "$MAX_PATCH_BYTES" ]; then
    rm -f "$out_dir/patch.diff"
    too_large=1
  else
    have_patch=1
  fi
fi

if [ "$mode" = build ]; then
  outcome=failed
  subject=""
  body="The automated run ended without a commit or an explanation (it may have crashed or hit its turn/time limit)."
  marker="$workspace/.moderation-out/outcome.md"
  if [ "$too_large" = 1 ]; then
    outcome=needs-human
    body="The automated change is larger than the ${MAX_PATCH_BYTES}-byte limit for an unattended run."
  elif [ "$have_patch" = 1 ]; then
    outcome=built
    subject="$(git --git-dir="$safe" log -1 --format=%s refs/heads/result)"
    body="$(git --git-dir="$safe" log -1 --format=%b refs/heads/result)"
  elif agent_file "$marker" "$workspace"; then
    outcome=needs-human
    body="$(head -c 20000 "$marker")"
  fi
  jq -n \
    --arg issue "$GITHUB_ISSUE_NUMBER" \
    --arg base_sha "$base_sha" \
    --arg outcome "$outcome" \
    --arg subject "$subject" \
    --arg body "$body" \
    '{issue_number: $issue, base_sha: $base_sha, outcome: $outcome, subject: $subject, body: $body}' \
    > "$out_dir/meta.json"
else
  action=failed
  comment=""
  result="$workspace/.moderation-out/triage.json"
  if [ "$too_large" = 0 ] && agent_file "$result" "$workspace" \
    && jq -e '(.action | type == "string") and (.comment | type == "string")' "$result" > /dev/null 2>&1; then
    action="$(jq -r '.action' "$result")"
    comment="$(jq -r '.comment[0:20000]' "$result")"
  fi
  jq -n \
    --arg issue "$GITHUB_ISSUE_NUMBER" \
    --arg base_sha "$base_sha" \
    --arg action "$action" \
    --arg comment "$comment" \
    '{issue_number: $issue, base_sha: $base_sha, action: $action, comment: $comment}' \
    > "$out_dir/meta.json"
fi
