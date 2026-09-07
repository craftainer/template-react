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

# xz-utils: Node's own release tarballs are .tar.xz.
apt-get update
apt-get install -y --no-install-recommends xz-utils
apt-get clean
rm -rf /var/lib/apt/lists/*

curl -LsSf "https://releases.astral.sh/github/uv/releases/download/${uv_version}/uv-installer.sh" \
    | sudo -u vscode env HOME=/home/vscode INSTALLER_NO_MODIFY_PATH=1 sh
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
# same way, in the same place -- see the Dockerfile's NODE_VERSION ARG.
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
node_tmpdir="$(mktemp -d)"
curl -LsSf -o "${node_tmpdir}/${node_asset}.tar.xz" \
    "https://nodejs.org/dist/v${node_version}/${node_asset}.tar.xz"
curl -LsSf -o "${node_tmpdir}/SHASUMS256.txt" \
    "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt"
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
curl -LsSf "https://github.com/j178/prek/releases/download/v${prek_version}/prek-installer.sh" \
    | sudo -u vscode env HOME=/home/vscode INSTALLER_NO_MODIFY_PATH=1 sh
ln -s /home/vscode/.local/bin/prek /usr/local/bin/prek

curl -fsSL https://claude.ai/install.sh \
    | sudo -u vscode env HOME=/home/vscode bash -s "$claude_code_version"
ln -s /home/vscode/.local/bin/claude /usr/local/bin/claude

# For the snip Claude Code PreToolUse hook -- see .claude/README.md. Not on
# PyPI/npm, so fetched as a release tarball and checksum-verified against
# the project's own published checksums.txt instead of trusting a
# curl-pipe-to-sh installer.
snip_arch="$(dpkg --print-architecture)"
snip_asset="snip_${snip_version}_linux_${snip_arch}.tar.gz"
snip_tmpdir="$(mktemp -d)"
sudo chmod a+rwx "$snip_tmpdir"
curl -LsSf -o "${snip_tmpdir}/${snip_asset}" \
    "https://github.com/edouard-claude/snip/releases/download/v${snip_version}/${snip_asset}"
curl -LsSf -o "${snip_tmpdir}/checksums.txt" \
    "https://github.com/edouard-claude/snip/releases/download/v${snip_version}/checksums.txt"
(cd "$snip_tmpdir" && grep " ${snip_asset}\$" checksums.txt | sha256sum -c -)
tar -xzf "${snip_tmpdir}/${snip_asset}" -C "$snip_tmpdir" snip
sudo -u vscode install -Dm755 "${snip_tmpdir}/snip" /home/vscode/.local/bin/snip
rm -rf "$snip_tmpdir"
ln -s /home/vscode/.local/bin/snip /usr/local/bin/snip
