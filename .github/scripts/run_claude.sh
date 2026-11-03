#!/usr/bin/env bash
# Runs `claude -p` for one moderation stage, inside the devcontainer (see
# ../workflows/README.md's "Issue moderation" section). Shared by all four
# Claude-invoking moderation workflows so the model/effort/output-format
# pinning, the git identity and the permission hardening stay in one place.
#
# The workflow copies this file from a trusted snapshot of the default branch
# to .moderation-tools/run_claude.sh before it starts (moderate_prepare.sh); it
# never runs the copy that sits in the checked-out tree.
#
# The Anthropic API key arrives ONLY in the environment of this process
# (devcontainers/ci's `env:` input -> `devcontainer exec --remote-env`). It is
# never written to a file in the workspace.
set -euo pipefail

prompt_file="$1"
allowed_tools="$2"
max_turns="$3"
timeout_seconds="$4"

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "::error::ANTHROPIC_API_KEY is not set in the environment of run_claude.sh" >&2
  exit 1
fi
[[ "$max_turns" =~ ^[0-9]+$ && "$timeout_seconds" =~ ^[0-9]+$ ]] || {
  echo "::error::max turns and timeout must be integers" >&2
  exit 1
}

# An instance's optional extra tools (the MODERATION_EXTRA_TOOLS repository
# variable) arrive as data in the environment, never spliced into a command.
if [ -n "${MODERATION_EXTRA_TOOLS:-}" ]; then
  allowed_tools="$allowed_tools,$MODERATION_EXTRA_TOOLS"
fi

# Every commit this pipeline makes carries this identity, distinct from the
# github-actions[bot] identity ../scripts/template_sync.py uses, so a
# Claude-authored commit is visibly attributable to this pipeline. Set through
# the environment, not `git config`, so nothing is written to .git/config.
export GIT_AUTHOR_NAME="claude-moderator[bot]"
export GIT_COMMITTER_NAME="claude-moderator[bot]"
export GIT_AUTHOR_EMAIL="claude-moderator[bot]@users.noreply.github.com"
export GIT_COMMITTER_EMAIL="claude-moderator[bot]@users.noreply.github.com"

# Strip credentials from the environment of everything Claude starts (Bash
# commands, hooks, MCP servers); only claude itself keeps the key.
export CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1

# Network allow-list for the sandbox below: comma-separated hosts, set by the
# workflow (github.com/api.github.com for triage's `gh issue view`, github.com
# for prek's hook-repo clones, plus the optional MODERATION_EXTRA_DOMAINS
# repository variable). The Anthropic API is not on it: claude itself is not
# sandboxed, only the commands it starts.
domains_json=""
IFS=',' read -ra domains <<< "${MODERATION_ALLOWED_DOMAINS:-}"
for d in "${domains[@]}"; do
  [ -n "$d" ] || continue
  [[ "$d" =~ ^[A-Za-z0-9*.-]+$ ]] || { echo "::error::bad domain '$d' in MODERATION_ALLOWED_DOMAINS" >&2; exit 1; }
  domains_json="$domains_json${domains_json:+,}\"$d\""
done
[ -n "$domains_json" ] || { echo "::error::MODERATION_ALLOWED_DOMAINS is empty" >&2; exit 1; }

# Inline `--settings` is the command-line level of Claude Code's settings
# precedence, above the project's own .claude/settings*.json, and leaves no
# file for the agent to edit mid-run.
#
# permissions.deny outranks every allow rule and keeps the FILE tools (which
# the sandbox does not cover) away from the process environment
# (/proc/<pid>/environ holds the key), this tooling directory and .git.
#
# sandbox: Claude Code's built-in sandbox (bubblewrap + socat on Linux) wraps
# every Bash command and the processes it starts -- prek hooks, tests, code the
# agent wrote. failIfUnavailable makes claude exit at startup when it cannot
# start, and allowUnsandboxedCommands=false removes the retry-outside-the-
# sandbox escape, so a runner or container that cannot sandbox fails closed
# instead of running unsandboxed. enableWeakerNestedSandbox is deliberately NOT
# set: it would bind-mount the container's /proc, exposing the claude process's
# environment. autoAllowBashIfSandboxed=false keeps --allowedTools in force for
# Bash. Network is limited to the allow-list above (strictAllowlist: refuse,
# do not prompt); the key is unset in every sandboxed command, and the
# credential locations of the container user are unreadable.
settings='{"permissions":{"deny":["Read(//proc/**)","Read(//sys/**)","Read(~/.claude/**)","Read(~/.config/gh/**)","Edit(./.moderation-tools/**)","Edit(./.git/**)"]},'
settings="$settings"'"sandbox":{"enabled":true,"failIfUnavailable":true,"allowUnsandboxedCommands":false,"autoAllowBashIfSandboxed":false,'
settings="$settings"'"network":{"allowedDomains":['"$domains_json"'],"strictAllowlist":true},'
settings="$settings"'"filesystem":{"allowWrite":["~/.cache"],"denyRead":["~/.claude","~/.config/gh","~/.ssh","~/.aws","~/.netrc","~/.git-credentials"]},'
settings="$settings"'"credentials":{"envVars":[{"name":"ANTHROPIC_API_KEY","mode":"deny"}]}}}'

timeout "${timeout_seconds}s" claude -p "$(cat "$prompt_file")" \
  --model claude-sonnet-5 \
  --effort medium \
  --output-format json \
  --max-turns "$max_turns" \
  --settings "$settings" \
  --allowedTools "$allowed_tools"
