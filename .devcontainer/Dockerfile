# syntax=docker/dockerfile:1.28@sha256:bb22d9815c728170f72750f4e5b0d672e06176142e1d602c7e66c050100b7e5b
# Single-stage build: develop (the devcontainer image). Built with the repo
# root as context (see compose.yml). The repo-root Dockerfile is reserved for
# an instance's own runtime image -- see docs/TEMPLATE.md's "Contents" and
# "Instance extension points".

# renovate: datasource=github-releases depName=j178/prek
ARG PREK_VERSION=0.5.9

# renovate: datasource=npm depName=@anthropic-ai/claude-code
ARG CLAUDE_CODE_VERSION=2.1.316

# renovate: datasource=github-releases depName=edouard-claude/snip
ARG SNIP_VERSION=0.25.2

# renovate: datasource=github-releases depName=cli/cli
ARG GH_VERSION=2.103.3

# uv itself isn't a project dependency manager here -- it's only the
# mechanism scripts/develop.sh uses to install an exact, checksum-verified
# CPython build (see PYTHON_VERSION below) rather than an unpinned apt
# package. Left on PATH afterward; harmless, and an instance that adds
# Python as its own application runtime can reuse it directly.
# renovate: datasource=github-releases depName=astral-sh/uv
ARG UV_VERSION=0.13.6

# python3 is infrastructure tooling, not an application runtime this
# template assumes: prek needs an interpreter to build the venv for any
# "language: python" hook (.pre-commit-config.yaml's pre-commit-hooks
# repo), and .github/scripts/*.py need one directly.
# renovate: datasource=python-version depName=python
ARG PYTHON_VERSION=3.14.8

# Node.js is infrastructure tooling too, not an application runtime: npx
# (the clear-thought MCP server in .mcp.json) is the only thing that
# needs it.
# renovate: datasource=node-version depName=node
ARG NODE_VERSION=24.22.2

ARG SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ARG SSL_CERT_DIR=/etc/ssl/certs

########################################
# develop — interactive devcontainer image, based on Microsoft's generic
# base devcontainer image. No *application* language runtime is assumed
# here — an instance adds its own (Python via uv, Rust via rustup, Go,
# Node.js, OpenTofu/Ansible, ...) on top of this stage, following the same
# ARG/scripts/develop.sh pattern established below. The Python and Node.js
# this stage does install are infrastructure tooling only -- see the ARG
# comments above.
########################################
# A literal tag plus digest, not an ARG: Renovate's dockerfile manager then
# bumps the tag and re-pins the digest together (pinDigests in
# .github/renovate.json). The syntax frontend on line 1 is pinned the same
# way. Digests are of the multi-arch index (amd64 and arm64).
FROM mcr.microsoft.com/devcontainers/base:trixie@sha256:71b6fe7c4e07ec747a94a72b2a17f2f8c286eaa7b1c59862888df764efb8b6c6 AS develop
ARG PREK_VERSION
ARG CLAUDE_CODE_VERSION
ARG SNIP_VERSION
ARG UV_VERSION
ARG PYTHON_VERSION
ARG NODE_VERSION
ARG GH_VERSION
ARG SSL_CERT_FILE
ARG SSL_CERT_DIR

ENV SSL_CERT_FILE=${SSL_CERT_FILE} \
    SSL_CERT_DIR=${SSL_CERT_DIR} \
    REQUESTS_CA_BUNDLE=${SSL_CERT_FILE} \
    CURL_CA_BUNDLE=${SSL_CERT_FILE}

COPY scripts/develop.sh /tmp/develop.sh
# github_token is an optional BuildKit secret (compose.yml's build.secrets,
# or `docker build --secret id=github_token,env=GITHUB_TOKEN`), mounted for
# this one instruction only: it authenticates develop.sh's GitHub downloads
# against CI rate limits (HTTP 429) without ever entering a layer or the
# image config, as a build ARG would. Absent (a local build), it is simply
# unset and downloads go unauthenticated.
RUN --mount=type=secret,id=github_token,env=GITHUB_TOKEN \
    bash /tmp/develop.sh "$PREK_VERSION" "$CLAUDE_CODE_VERSION" "$SNIP_VERSION" "$UV_VERSION" "$PYTHON_VERSION" "$NODE_VERSION" "$GH_VERSION"

# Instance hook: scripts/develop.d/*.sh, see that directory's README.md.
COPY scripts/develop.d/ /tmp/develop.d/
RUN for f in /tmp/develop.d/*.sh; do [ -e "$f" ] || continue; echo "==> $f"; bash "$f" || exit 1; done

USER vscode
WORKDIR /workspace
CMD ["sleep", "infinity"]
