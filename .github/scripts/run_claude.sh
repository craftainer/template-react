#!/usr/bin/env bash
# Runs `claude -p` for one moderation stage, inside the devcontainer (see
# ../workflows/README.md's "Issue moderation" section). Shared by all four
# Claude-invoking moderation workflows so the model/effort/output-format
# pinning and the git identity used for commits stay in one place.
set -euo pipefail

prompt_file="$1"
allowed_tools="$2"
max_turns="$3"
timeout_seconds="$4"

export ANTHROPIC_API_KEY
ANTHROPIC_API_KEY="$(cat .secrets/claude.txt)"

# Every commit this pipeline makes carries this identity, distinct from the
# github-actions[bot] identity ../scripts/template_sync.py uses, so a
# Claude-authored commit is visibly attributable to this pipeline.
git config user.name "claude-moderator[bot]"
git config user.email "claude-moderator[bot]@users.noreply.github.com"

timeout "${timeout_seconds}s" claude -p "$(cat "$prompt_file")" \
  --model claude-sonnet-5 \
  --effort medium \
  --output-format json \
  --max-turns "$max_turns" \
  --allowedTools "$allowed_tools"
