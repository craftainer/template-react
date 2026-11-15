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
# from GitHub, Claude Code's release host and the registries intermittently
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
#   tools that do their own downloads (`uv python install`) and so can't be
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
    # connections and HTTP 408/429/5xx; DNS and connect failures (exit 6/7),
    # resets and truncated transfers (exit 18/52/55/56) are retried here, so a
    # permanent HTTP error (-f, exit 22) or a TLS failure still fails at once.
    # A timeout (28) is not: curl has already spent its --retry-max-time on it,
    # and looping again would multiply that. At most 4 tries here, each with
    # curl's own retries inside: bounded, and `retry` never wraps a fetch. A transfer curl can tell is cut short (a Content-Length
    # mismatch is exit 18, a cut chunked body 56) is therefore re-fetched
    # here, not by unpacking a broken file. Callers must write
    # to a file (-o): a re-run after a partial transfer would otherwise
    # duplicate stdout.
    local attempt=1 status=0
    while :; do
        status=0
        curl -fsSL --retry 5 --retry-max-time 60 --retry-connrefused \
            ${auth[@]+"${auth[@]}"} "$@" "$url" || status=$?
        case "$status" in
            6 | 7 | 18 | 52 | 55 | 56)
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

# Nothing here pipes a download into a shell or runs a vendor's install
# script: uv, prek and the Claude Code CLI are fetched as the release's own
# binaries and verified before anything runs, like node, snip and gh below.
# uv and prek publish a `<asset>.sha256` beside each release asset, which
# fetch_checked verifies. Claude Code signs its per-release manifest.json
# (SHA256 per platform) with an Anthropic GPG key, so install_claude checks
# the key's fingerprint against the pin below, then the signature, then the
# binary against the manifest -- the vendor's documented verification
# (https://code.claude.com/docs/en/setup, "Binary integrity and code
# signing").
#
# fetch_checked <url> <dir>: downloads <url> and <url>.sha256 into <dir> and
# aborts unless the file matches the checksum listed for its own name.
fetch_checked() {
    local url=$1 dir=$2 name
    name="${url##*/}"
    fetch_label="$name" fetch "$url" -o "${dir}/${name}"
    fetch_label="$name checksum" fetch "${url}.sha256" -o "${dir}/${name}.sha256"
    # awk selects the line for this exact name (a missing one fails), so
    # sha256sum never sees another asset's line or an empty input.
    (cd "$dir" && awk -v n="$name" '$2 == n { print; found = 1 } END { exit !found }' "${name}.sha256" | sha256sum -c -)
}

# install_checked_tarball <url> <dest dir> <member>...: fetch_checked's
# download of a .tar.gz release asset, then installs each <member> (a path
# inside the tarball, e.g. uv-x86_64-unknown-linux-gnu/uv) into <dest dir>
# with mode 0755. Fails closed: a failed download, an empty file, a checksum
# mismatch or a missing member aborts before anything is installed.
install_checked_tarball() {
    local url=$1 dest=$2 name dir member
    shift 2
    name="${url##*/}"
    tmp_path -d
    dir="$tmp_result"
    fetch_checked "$url" "$dir"
    if [ ! -s "${dir}/${name}" ]; then
        echo "downloaded ${name} is empty: ${url}" >&2
        return 1
    fi
    tar -xzf "${dir}/${name}" -C "$dir" "$@"
    for member in "$@"; do
        install -m755 -t "$dest" "${dir}/${member}"
    done
    rm -rf "$dir"
}

# Fingerprint of Anthropic's Claude Code release signing key (see the docs
# above); a key whose primary fingerprint differs is rejected.
claude_signing_fpr=31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE
claude_release_base=https://downloads.claude.ai/claude-code-releases
claude_key_url=https://downloads.claude.ai/keys/claude-code.asc

# install_claude <version> <platform> <config dir> <dir>: <platform> is the
# manifest's platform key (linux-x64, linux-arm64). <dir> is a scratch
# directory that the vscode user can traverse. Installs as vscode.
install_claude() {
    local version=$1 platform=$2 config_dir=$3 dir=$4
    local key="${dir}/claude-code.asc" gnupg_home fpr status manifest_version checksum
    tmp_path -d
    gnupg_home="$tmp_result"
    fetch_label="Claude Code signing key" fetch "$claude_key_url" -o "$key"
    fpr="$(gpg --batch --homedir "$gnupg_home" --show-keys --with-colons "$key" |
        awk -F: '$1 == "fpr" && !seen++ { print $10 }')"
    if [ "$fpr" != "$claude_signing_fpr" ]; then
        echo "Claude Code signing key has fingerprint '${fpr}', expected ${claude_signing_fpr}" >&2
        return 1
    fi
    gpg --batch --quiet --homedir "$gnupg_home" --import "$key"
    fetch_label="Claude Code manifest" fetch "${claude_release_base}/${version}/manifest.json" -o "${dir}/manifest.json"
    fetch_label="Claude Code manifest signature" fetch "${claude_release_base}/${version}/manifest.json.sig" -o "${dir}/manifest.json.sig"
    # A bad, missing or unknown-key signature makes gpg exit non-zero.
    status="$(gpg --batch --homedir "$gnupg_home" --status-fd 1 --verify "${dir}/manifest.json.sig" "${dir}/manifest.json" 2> /dev/null)" || {
        echo "Claude Code manifest is not signed by ${claude_signing_fpr}" >&2
        return 1
    }
    # VALIDSIG's 12th field is the signing key's primary fingerprint.
    printf '%s\n' "$status" |
        awk -v fpr="$claude_signing_fpr" '$1 == "[GNUPG:]" && $2 == "VALIDSIG" && $12 == fpr { ok = 1 } END { exit !ok }' || {
        echo "Claude Code manifest is not signed by ${claude_signing_fpr}" >&2
        return 1
    }
    # Stop the gpg-agent/dirmngr the import started and remove the keyring,
    # so nothing lingers in the image layer.
    gpgconf --homedir "$gnupg_home" --kill all
    rm -rf "$gnupg_home"
    manifest_version="$(jq -er '.version' "${dir}/manifest.json")"
    if [ "$manifest_version" != "$version" ]; then
        echo "Claude Code manifest is for ${manifest_version}, expected ${version}" >&2
        return 1
    fi
    checksum="$(jq -er --arg p "$platform" '.platforms[$p].checksum' "${dir}/manifest.json")"
    if [[ ! $checksum =~ ^[0-9a-f]{64}$ ]]; then
        echo "Claude Code manifest has no valid checksum for ${platform}" >&2
        return 1
    fi
    fetch_label="Claude Code binary" fetch "${claude_release_base}/${version}/${platform}/claude" -o "${dir}/claude"
    (cd "$dir" && printf '%s  claude\n' "$checksum" | sha256sum -c -)
    chmod a+rx "${dir}/claude"
    # The verified binary installs itself (to ~/.local/share/claude and a
    # ~/.local/bin/claude link) without fetching anything else.
    sudo -u vscode env HOME=/home/vscode CLAUDE_CONFIG_DIR="$config_dir" \
        "${dir}/claude" install "$version"
}

run_uv_python_install() {
    sudo -u vscode env HOME=/home/vscode /usr/local/bin/uv python install "$python_version"
}

# xz-utils: Node's own release tarballs are .tar.xz. gnupg and jq: verifying
# the Claude Code manifest's signature and reading its checksum. They are
# kept afterwards, not purged: the devcontainer's own checks need them --
# jq for .claude/hooks/self-check.sh and the .github/scripts moderation
# scripts, gpg and jq for the install_claude tests in
# .github/scripts/test_release_scripts.py (which skip without them, so a
# purge would silently drop that coverage from `prek`). bubblewrap and
# socat: the dependencies of Claude Code's built-in sandbox on Linux, which
# the issue-moderation workflows require (run_claude.sh fails closed
# without it).
apt-get update
apt-get install -y --no-install-recommends gnupg jq xz-utils bubblewrap socat
apt-get clean
rm -rf /var/lib/apt/lists/*

# One arch mapping for every tool below: Debian's name, the Rust triple
# prefix of uv's and prek's release assets, Node's, and Claude Code's
# manifest platform key.
dpkg_arch="$(dpkg --print-architecture)"
case "$dpkg_arch" in
    amd64)
        rust_arch=x86_64
        node_arch=x64
        claude_platform=linux-x64
        ;;
    arm64)
        rust_arch=aarch64
        node_arch=arm64
        claude_platform=linux-arm64
        ;;
    *)
        echo "unsupported architecture: $dpkg_arch" >&2
        exit 1
        ;;
esac

uv_asset="uv-${rust_arch}-unknown-linux-gnu"
install_checked_tarball "https://github.com/astral-sh/uv/releases/download/${uv_version}/${uv_asset}.tar.gz" \
    /usr/local/bin "${uv_asset}/uv" "${uv_asset}/uvx"

# python3 isn't otherwise a dependency of this template -- it's
# infrastructure tooling only: prek (like pre-commit) needs *some*
# interpreter to build the venv for any "language: python" hook
# (.pre-commit-config.yaml's pre-commit-hooks repo -- trailing-whitespace,
# check-yaml, ...), and .github/scripts/*.py need one directly. uv is the
# mechanism for an exact, checksum-verified build (python-build-standalone)
# rather than an unpinned apt package; `uv python find` below resolves the
# path so it can be symlinked to a plain, unversioned `python3` on PATH --
# prek's own hook-venv creation looks for that directly, not via `uv run`.
# uv downloads the build itself, so a failed download is retried here.
retry run_uv_python_install
python_bin="$(sudo -u vscode env HOME=/home/vscode /usr/local/bin/uv python find "$python_version")"
ln -s "$python_bin" /usr/local/bin/python3
ln -s "$python_bin" /usr/local/bin/python

# Node.js, likewise infrastructure tooling only: the clear-thought MCP
# server in ../.mcp.json is the only thing that needs npx. Installed
# directly from nodejs.org's own release tarballs (checksum-verified
# against that release's published SHASUMS256.txt) rather than a
# devcontainer feature, so every tool this stage installs is pinned the
# same way, in the same place -- see .devcontainer/Dockerfile's NODE_VERSION ARG.
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
prek_asset="prek-${rust_arch}-unknown-linux-gnu"
install_checked_tarball "https://github.com/j178/prek/releases/download/v${prek_version}/${prek_asset}.tar.gz" \
    /usr/local/bin "${prek_asset}/prek"

# Created here, owned by vscode, because a fresh claude-config volume
# (compose.yml) copies this directory's ownership and mode on first mount;
# left to the install it could be missing or root-owned. 0700: it holds
# Claude Code's credentials.
sudo -u vscode install -d -m 0700 /home/vscode/.claude
# CLAUDE_CONFIG_DIR matches compose.yml's, so anything the install writes
# lands where Claude Code will look for it at runtime.
tmp_path -d
claude_tmpdir="$tmp_result"
chmod a+rx "$claude_tmpdir"
install_claude "$claude_code_version" "$claude_platform" /home/vscode/.claude "$claude_tmpdir"
rm -rf "$claude_tmpdir"
ln -s /home/vscode/.local/bin/claude /usr/local/bin/claude

# For the snip Claude Code PreToolUse hook -- see .claude/README.md. Not on
# PyPI/npm, so fetched as a release tarball and checksum-verified against
# the project's own published checksums.txt instead of trusting a
# curl-pipe-to-sh installer.
snip_arch="$dpkg_arch"
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
gh_arch="$dpkg_arch"
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
