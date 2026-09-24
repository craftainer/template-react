# .claude/

Project-scope Claude Code configuration, shared with every collaborator
who opens this repo (see the root `.gitignore`, which does *not* exclude
this directory).

- `settings.json` — enables official plugins from the built-in
  `claude-plugins-official` marketplace via `enabledPlugins`:
  - `context7` — pulls up-to-date, version-specific library
    documentation and examples into context from Context7's hosted
    remote MCP server (`https://mcp.context7.com/mcp`); no local
    install. Works anonymously; set a `CONTEXT7_API_KEY` env var for
    higher rate limits.
  - `security-guidance` — security review for Claude-generated code:
    pattern-based warnings on `Edit`/`Write`, an LLM diff review when
    Claude finishes a turn, and an agentic reviewer on `git commit`
    that traces cross-file data flow. Needs only Python 3.8+ on
    `PATH` — an instance without a Python runtime of its own should
    confirm this is still true before relying on it.

  `settings.json` also wires up the `PostToolUse` hook below.
- `hooks/self-check.sh` — after Claude edits a file, runs the fast,
  pre-commit-stage hooks from `../.pre-commit-config.yaml` (whitespace,
  YAML/TOML/JSON checks, ...) against just that file via `prek`, so
  issues are caught and auto-fixed immediately instead of first at commit
  time. An instance's own slower, pre-push-only hooks stay pre-push-only —
  too slow to run after every edit.
- The `PreToolUse` hook on `Bash` runs `snip hook`, the
  [snip](https://github.com/edouard-claude/snip) token-filtering proxy:
  it rewrites supported commands (`git` and others; an instance's own
  language tooling once it's added) to return only their signal
  (failures, diffs, summaries) instead of full output. `snip` itself is
  installed by `scripts/develop.sh`, pinned to `SNIP_VERSION` in the
  Dockerfile, and checksum-verified against its published release
  checksums — see "Versions and config" in `docs/TEMPLATE.md`. Chosen
  over the more popular
  [rtk](https://github.com/rtk-ai/rtk) because its filters are
  declarative YAML data (auditable) and it fails open (a broken filter
  passes the command through unfiltered rather than blocking it); rtk's
  larger community and multi-maintainer team are the tradeoff, so revisit
  this choice if `snip` goes unmaintained.
- `../.mcp.json` — project-scope MCP servers not available as a
  `claude-plugins-official` plugin, so they can't go through
  `enabledPlugins` above:
  - `clear-thought` (`@waldzellai/clear-thought-onepointfive`) — a
    local stdio MCP server exposing structured reasoning/mental-model
    tools, launched via `npx`. `npx` needs Node.js, which is the only
    reason `scripts/develop.sh` installs it (pinned via the Dockerfile's
    `NODE_VERSION` ARG) — Claude Code itself doesn't need it.

  An instance adds its own stack-specific MCP servers here (database,
  object storage, browser automation, ...), pinned to an exact
  version/commit the same way, and reading credentials via `${VAR}` from
  the same env vars its own `../.devcontainer/compose.yml` gives its dev
  service — never re-pinned a second time.

## Do

- Keep this file's `enabledPlugins` pinned to specific plugin names —
  don't rely on a whole marketplace being auto-installed.

## Don't

- Add personal preferences here — this file is committed and shared;
  use your own user-scope Claude Code settings for those instead.

## Removing a tool

- **snip**: delete the `PreToolUse` hook entry in `settings.json` and the
  `snip` install block (and `SNIP_VERSION` ARG in the Dockerfile) from
  `scripts/develop.sh`.
- **context7** / **security-guidance**: delete the plugin's
  `enabledPlugins` entry in `settings.json`.
- **clear-thought**: delete its entry from `../.mcp.json`; if nothing
  else needs Node.js, also remove its install block (and `NODE_VERSION`
  ARG) from `../Dockerfile`/`scripts/develop.sh`.
