#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): after Claude edits a file, run the fast,
# pre-commit-stage hooks from .pre-commit-config.yaml against just that
# file via prek -- reusing the same config as `git commit` would, instead
# of a second, separate set of checks -- so whitespace/lint issues are
# caught (and auto-fixed where possible) immediately, not first at commit
# time. An instance's own slower, pre-push-only hooks (type checker, test
# suite, lock-file check, ...) are deliberately excluded here: too slow to
# run after every single edit.
set -euo pipefail

input="$(cat)"
file_path="$(jq -r '.tool_input.file_path // empty' <<<"$input")"

[ -n "$file_path" ] || exit 0
[ -f "$file_path" ] || exit 0

project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
case "$file_path" in
  "$project_dir"/*) ;;
  *) exit 0 ;;
esac

command -v prek >/dev/null 2>&1 || exit 0

cd "$project_dir"
relative_path="${file_path#"$project_dir"/}"

if ! output="$(prek run --files "$relative_path" 2>&1)"; then
  echo "$output" >&2
  echo "prek found issues in $relative_path (fixed automatically where possible) -- review the diff." >&2
  exit 2
fi

exit 0
