#!/usr/bin/env bash
# shellcheck shell=bash
# Helpers shared by the issue-moderation scripts that handle a result produced
# by Claude (untrusted data): moderate_package_result.sh, moderate_verify_branch.sh,
# moderate_apply_result.sh and moderate_apply_triage.sh. Sourced, never run
# directly. See ../workflows/README.md's "Issue moderation" section and
# ../../docs/adrs/0001-harden-the-issue-moderation-workflows.md.

MODERATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Caps on what the (untrusted) result may put on the repository.
MAX_PATCH_BYTES=2097152
MAX_TEXT_CHARS=10000
MAX_TITLE_CHARS=200

# is_sha <value>: a full 40-character lowercase hex object name, nothing else
# (so it can never be read as a git option).
is_sha() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]]
}

# is_ancestor <sha> <ref-or-sha>: <sha> is the same commit as, or an ancestor
# of, the second argument. Asks the compare API instead of local history, so a
# shallow checkout and a long branch both work.
is_ancestor() {
  local status
  status="$(gh api "repos/$GITHUB_REPOSITORY/compare/$1...$2" --jq .status)" || return 1
  [ "$status" = ahead ] || [ "$status" = identical ]
}

# check_result_tree <base>: every path that differs between <base> and HEAD in
# the current repository passes moderate_check_paths.sh, and none is a symlink
# or a submodule. Prints the offenders to stderr. With <only_prefix>, every
# path must also start with it (the plan stage may change only docs/plans/).
check_result_tree() {
  local base="$1" only_prefix="${2:-}" tmp meta path mode bad=0
  local -a paths=()
  tmp="$(mktemp)" || return 1
  if ! git diff --raw -z --no-renames "$base" HEAD -- > "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  while IFS= read -r -d '' meta && IFS= read -r -d '' path; do
    read -r _ mode _ <<<"$meta"
    case "$mode" in
      120000 | 160000)
        echo "::error::$path is a symlink or submodule, which the automation never accepts" >&2
        bad=1
        ;;
      *) ;;
    esac
    paths+=("$path")
    if [ -n "$only_prefix" ] && [[ "$path" != "$only_prefix"* ]]; then
      echo "::error::$path is outside $only_prefix, the only place this stage may change" >&2
      bad=1
    fi
  done < "$tmp"
  rm -f "$tmp"
  [ "$bad" = 0 ] || return 1
  [ "${#paths[@]}" -gt 0 ] || return 0
  printf '%s\0' "${paths[@]}" | "$MODERATE_DIR/moderate_check_paths.sh"
}

# agent_file <file> <workspace>: succeeds only for a regular, non-symlink file
# that really lives under <workspace>/.moderation-out. The agent controls that
# directory, and a symlink in it would be read here on the runner, outside the
# container, and could carry a runner file into an issue comment.
agent_file() {
  local file="$1" workspace="$2" real root
  [ -f "$file" ] && [ ! -L "$file" ] || return 1
  real="$(realpath -e -- "$file")" || return 1
  # The directory name is appended to the resolved workspace, not resolved
  # itself, so a `.moderation-out` symlinked elsewhere fails the prefix test.
  root="$(realpath -e -- "$workspace")/.moderation-out" || return 1
  [[ "$real" == "$root/"* ]]
}
