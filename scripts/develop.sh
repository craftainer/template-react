#!/usr/bin/env bash
# Sets up the `develop` stage on top of Microsoft's generic base
# devcontainer image (which already provides the `vscode` user, git, sudo,
# and curl). Installs only the language-agnostic AI-assisted-workflow
# tooling this template requires everywhere; an instance's own
# scripts/develop.sh (or an addition to this one) installs its language
# runtime and any stack-specific CLI on top -- see docs/TEMPLATE.md.
set -euo pipefail

prek_version=$1
claude_code_version=$2
snip_version=$3
uv_version=$4
python_version=$5
node_version=$6
gh_version=$7

# Network resilience. CI runners share IPs, so unauthenticated downloads
# from GitHub, the Claude Code installer and the registries intermittently
# fail with HTTP 429. Two measures, neither of which changes what is
# installed:
#
# - fetch: curl with bounded retries (--retry: transient failures only --
#   timeouts and HTTP 408/429/500/502/503/504; curl honours a server's
#   Retry-After and otherwise backs off exponentially: 1s, 2s, 4s, ...)
#   and, for github.com / api.github.com URLs only, an
#   Authorization header when GITHUB_TOKEN is set. GITHUB_TOKEN arrives as
#   a BuildKit secret (the Dockerfile's `RUN --mount=type=secret,
#   id=github_token,env=GITHUB_TOKEN`), never a build arg, so it is not
#   baked into a layer. The header is read from a private temp file
#   (`-H @file`) so the token never appears in a process's argument list.
#   `-L` without `--location-trusted` is deliberate: curl drops a custom
#   Authorization header (including one from `-H @file`) when a redirect
#   leaves the original host (GitHub release downloads redirect to
#   objects.githubusercontent.com), so the token never reaches another host. That needs curl >= 7.58
#   (older versions forwarded it, CVE-2018-1000007).
#   Without a token (a local build) nothing changes.
#   `--retry-all-errors` is deliberately absent: with `-f` it also retried
#   permanent 404/403 responses, and multiplied with `retry` below.
# - cleanup: every temp file or directory is registered with `tmp_path`
#   and removed by one EXIT/INT/TERM trap, so a failed step (set -e), a
#   failed checksum or a kill never leaves the bearer-token header file or
#   a download directory behind.
# - retry: reruns a step a bounded number of times with doubling delays, for
#   installers that do their own downloads inside the script and so can't be
#   wrapped by fetch. Never put a `fetch` inside a `retry`: their retries
#   would multiply.
cleanup_paths=()
cleanup() {
    [ "${#cleanup_paths[@]}" -eq 0 ] || rm -rf "${cleanup_paths[@]}" || true
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
# tmp_path <mktemp args...>: creates the temp path into $tmp_result and
# registers it for cleanup. Call it (and `fetch`, which uses it) in the
# main shell only, never inside $(...), a pipeline or a background job: a
# subshell's registration is lost.
tmp_result=""
fetch_label="" # optional: what the next fetch downloads, for its failure message
tmp_path() {
    tmp_result="$(mktemp "$@")"
    cleanup_paths+=("$tmp_result")
}

fetch() {
    local url=$1
    shift
    # `${auth[@]+...}` below: an empty array is an unbound variable under
    # `set -u` on bash < 4.4.
    local auth=()
    if [ -n "${GITHUB_TOKEN:-}" ]; then
        case "$url" in
            https://github.com/* | https://api.github.com/*)
                tmp_path
                printf 'Authorization: Bearer %s\n' "$GITHUB_TOKEN" > "$tmp_result"
                auth=(-H "@${tmp_result}")
                ;;
        esac
    fi
    # curl's --retry (+ --retry-connrefused) covers timeouts, refused
    # connections and HTTP 408/429/5xx; resets and truncated transfers
    # (exit 18/52/55/56) are retried here, so a permanent HTTP error (-f,
    # exit 22), DNS or TLS failure still fails at once. Callers must write
    # to a file (-o): a re-run after a partial transfer would otherwise
    # duplicate stdout.
    local attempt=1 status=0
    while :; do
        status=0
        curl -fsSL --retry 5 --retry-max-time 60 --retry-connrefused \
            ${auth[@]+"${auth[@]}"} "$@" "$url" || status=$?
        case "$status" in
            18 | 52 | 55 | 56)
                if [ "$attempt" -lt 4 ]; then
                    echo "curl exit $status; retrying ($attempt/3): $url" >&2
                    sleep $((attempt * 2))
                    attempt=$((attempt + 1))
                    continue
                fi
                ;;
        esac
        break
    done
    # Remove the token header file as soon as it is unused; the trap is the
    # backstop for a kill in between.
    [ ${#auth[@]} -eq 0 ] || rm -f "${auth[1]#@}"
    if [ "$status" -ne 0 ]; then
        echo "failed to download ${fetch_label:-file} (curl exit ${status}): ${url}" >&2
    fi
    return "$status"
}

retry() {
    local attempt=1 max=4 delay=5
    until "$@"; do
        if [ "$attempt" -ge "$max" ]; then
            echo "giving up after $max attempts: $*" >&2
            return 1
        fi
        echo "attempt $attempt/$max failed; retrying in ${delay}s: $*" >&2
        sleep "$delay"
        attempt=$((attempt + 1))
        delay=$((delay * 2))
    done
}

# Installers are downloaded to a file and then run, never piped straight
# from curl: a retried download would otherwise re-emit the script into a
# shell that is already executing its first, truncated part. The file is
# world-readable because the installer runs as the vscode user.
#
# download_installer <name> <url>: <name> labels fetch's failure message
# (a variable assignment scoped to that one call), since `set -e` would
# otherwise abort without saying which installer failed. fetch itself reports,
# so it still runs under `set -e` (not inside an `||` list, which would
# disable it).
installer_script=""
download_installer() {
    rm -f "$installer_script"
    tmp_path
    installer_script="$tmp_result"
    chmod a+r "$installer_script"
    fetch_label="$1 installer" fetch "$2" -o "$installer_script"
}

# The installers do their own downloads. prek's comes only from github.com,
# so it gets the token (PREK_GITHUB_TOKEN, passed through the environment
# so it never appears in an argument list). uv's tries releases.astral.sh
# first, a third-party host, so UV_GITHUB_TOKEN is deliberately not set; the
# Claude installer downloads from claude.ai, not GitHub.
#
# Each installer script is downloaded once, by `fetch`, which has its own
# retries; only running it is wrapped in `retry`, for the downloads the
# installer does itself. Wrapping the download in `retry` too would multiply
# the two layers of retries (up to 4 x 4 x 6 attempts for one script).
run_uv_installer() {
    sudo -u vscode env HOME=/home/vscode INSTALLER_NO_MODIFY_PATH=1 sh "$installer_script"
}

# An empty PREK_GITHUB_TOKEN is the same as unset to the installer (it tests
# `[ -n "${AUTH_TOKEN:-}" ]`), so a local build sends no header.
run_prek_installer() {
    PREK_GITHUB_TOKEN="${GITHUB_TOKEN:-}" sudo --preserve-env=PREK_GITHUB_TOKEN -u vscode \
        env HOME=/home/vscode INSTALLER_NO_MODIFY_PATH=1 sh "$installer_script"
}

run_claude_installer() {
    sudo -u vscode env HOME=/home/vscode bash "$installer_script" "$claude_code_version"
}

# xz-utils: Node's own release tarballs are .tar.xz.
apt-get update
apt-get install -y --no-install-recommends xz-utils
apt-get clean
rm -rf /var/lib/apt/lists/*

download_installer uv "https://releases.astral.sh/github/uv/releases/download/${uv_version}/uv-installer.sh"
retry run_uv_installer
ln -s /home/vscode/.local/bin/uv /usr/local/bin/uv
ln -s /home/vscode/.local/bin/uvx /usr/local/bin/uvx

# python3 isn't otherwise a dependency of this template -- it's
# infrastructure tooling only: prek (like pre-commit) needs *some*
# interpreter to build the venv for any "language: python" hook
# (.pre-commit-config.yaml's pre-commit-hooks repo -- trailing-whitespace,
# check-yaml, ...), and .github/scripts/*.py need one directly. uv is the
# mechanism for an exact, checksum-verified build (python-build-standalone)
# rather than an unpinned apt package; `uv python find` below resolves the
# path so it can be symlinked to a plain, unversioned `python3` on PATH --
# prek's own hook-venv creation looks for that directly, not via `uv run`.
sudo -u vscode env HOME=/home/vscode /usr/local/bin/uv python install "$python_version"
python_bin="$(sudo -u vscode env HOME=/home/vscode /usr/local/bin/uv python find "$python_version")"
ln -s "$python_bin" /usr/local/bin/python3
ln -s "$python_bin" /usr/local/bin/python

# Node.js, likewise infrastructure tooling only: the clear-thought MCP
# server in ../.mcp.json is the only thing that needs npx. Installed
# directly from nodejs.org's own release tarballs (checksum-verified
# against that release's published SHASUMS256.txt) rather than a
# devcontainer feature, so every tool this stage installs is pinned the
# same way, in the same place -- see .devcontainer/Dockerfile's NODE_VERSION ARG.
node_dpkg_arch="$(dpkg --print-architecture)"
case "$node_dpkg_arch" in
    amd64) node_arch=x64 ;;
    arm64) node_arch=arm64 ;;
    *)
        echo "unsupported architecture for Node.js install: $node_dpkg_arch" >&2
        exit 1
        ;;
esac
node_asset="node-v${node_version}-linux-${node_arch}"
tmp_path -d
node_tmpdir="$tmp_result"
fetch "https://nodejs.org/dist/v${node_version}/${node_asset}.tar.xz" -o "${node_tmpdir}/${node_asset}.tar.xz"
fetch "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" -o "${node_tmpdir}/SHASUMS256.txt"
(cd "$node_tmpdir" && grep " ${node_asset}.tar.xz\$" SHASUMS256.txt | sha256sum -c -)
mkdir -p /usr/local/lib/nodejs
tar -xJf "${node_tmpdir}/${node_asset}.tar.xz" -C /usr/local/lib/nodejs
rm -rf "$node_tmpdir"
ln -s "/usr/local/lib/nodejs/${node_asset}/bin/node" /usr/local/bin/node
ln -s "/usr/local/lib/nodejs/${node_asset}/bin/npm" /usr/local/bin/npm
ln -s "/usr/local/lib/nodejs/${node_asset}/bin/npx" /usr/local/bin/npx

# prek (https://prek.j178.dev/) is installed as a standalone tool, not a
# project dependency of any particular language's package manager -- every
# instance, regardless of language, is expected to run
# `prek run --all-files --hook-stage manual` (see checks.yml).
download_installer prek "https://github.com/j178/prek/releases/download/v${prek_version}/prek-installer.sh"
retry run_prek_installer
ln -s /home/vscode/.local/bin/prek /usr/local/bin/prek

download_installer claude https://claude.ai/install.sh
retry run_claude_installer
ln -s /home/vscode/.local/bin/claude /usr/local/bin/claude

# For the snip Claude Code PreToolUse hook -- see .claude/README.md. Not on
# PyPI/npm, so fetched as a release tarball and checksum-verified against
# the project's own published checksums.txt instead of trusting a
# curl-pipe-to-sh installer.
snip_arch="$(dpkg --print-architecture)"
snip_asset="snip_${snip_version}_linux_${snip_arch}.tar.gz"
tmp_path -d
snip_tmpdir="$tmp_result"
sudo chmod a+rwx "$snip_tmpdir"
fetch "https://github.com/edouard-claude/snip/releases/download/v${snip_version}/${snip_asset}" -o "${snip_tmpdir}/${snip_asset}"
fetch "https://github.com/edouard-claude/snip/releases/download/v${snip_version}/checksums.txt" -o "${snip_tmpdir}/checksums.txt"
(cd "$snip_tmpdir" && grep " ${snip_asset}\$" checksums.txt | sha256sum -c -)
tar -xzf "${snip_tmpdir}/${snip_asset}" -C "$snip_tmpdir" snip
sudo -u vscode install -Dm755 "${snip_tmpdir}/snip" /home/vscode/.local/bin/snip
rm -rf "$snip_tmpdir"
ln -s /home/vscode/.local/bin/snip /usr/local/bin/snip

# GitHub CLI: CLAUDE.md's workflow drives GitHub (PRs, workflow runs,
# releases) through `gh`, so it's part of the base toolset rather than a
# per-instance add-on. Fetched as a release tarball and checksum-verified
# against the release's own checksums file, like snip above. Its login
# state lives in the gh-config volume (.devcontainer/compose.yml), so a
# rebuild doesn't require `gh auth login` again.
gh_arch="$(dpkg --print-architecture)"
gh_asset="gh_${gh_version}_linux_${gh_arch}"
tmp_path -d
gh_tmpdir="$tmp_result"
fetch "https://github.com/cli/cli/releases/download/v${gh_version}/${gh_asset}.tar.gz" -o "${gh_tmpdir}/${gh_asset}.tar.gz"
fetch "https://github.com/cli/cli/releases/download/v${gh_version}/gh_${gh_version}_checksums.txt" -o "${gh_tmpdir}/checksums.txt"
(cd "$gh_tmpdir" && grep " ${gh_asset}.tar.gz\$" checksums.txt | sha256sum -c -)
tar -xzf "${gh_tmpdir}/${gh_asset}.tar.gz" -C "$gh_tmpdir" "${gh_asset}/bin/gh"
install -Dm755 "${gh_tmpdir}/${gh_asset}/bin/gh" /usr/local/bin/gh
rm -rf "$gh_tmpdir"
# Pre-create the gh-config volume's mount point owned by vscode, so a new
# named volume is initialized with that ownership instead of root's.
sudo -u vscode mkdir -p /home/vscode/.config/gh
