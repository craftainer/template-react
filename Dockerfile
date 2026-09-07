# syntax=docker/dockerfile:1.27
# Three-stage build: develop (devcontainer, from template-base), builder,
# runner. Node.js is already installed in the develop stage as template-base's
# own infrastructure tooling (see its NODE_VERSION ARG below) -- this instance
# reuses that same pinned version as its application runtime rather than
# installing a second copy, per docs/TEMPLATE.md's "Versions and config".

ARG DEBIAN_VERSION=trixie

# renovate: datasource=github-releases depName=j178/prek
ARG PREK_VERSION=0.5.2

# renovate: datasource=npm depName=@anthropic-ai/claude-code
ARG CLAUDE_CODE_VERSION=2.1.263

# renovate: datasource=github-releases depName=edouard-claude/snip
ARG SNIP_VERSION=0.25.1

# uv itself isn't a project dependency manager here -- it's only the
# mechanism scripts/develop.sh uses to install an exact, checksum-verified
# CPython build (see PYTHON_VERSION below) rather than an unpinned apt
# package. Left on PATH afterward; harmless, and an instance that adds
# Python as its own application runtime can reuse it directly.
# renovate: datasource=github-releases depName=astral-sh/uv
ARG UV_VERSION=0.12.10

# python3 is infrastructure tooling, not an application runtime this
# template assumes: prek needs an interpreter to build the venv for any
# "language: python" hook (.pre-commit-config.yaml's pre-commit-hooks
# repo), and .github/scripts/*.py need one directly.
# renovate: datasource=python-version depName=python
ARG PYTHON_VERSION=3.14.0

# Node.js: template-base installs this as infrastructure tooling only (for
# npx/the clear-thought MCP server); this instance is what turns it into an
# application runtime too, reusing the same pinned version for both.
# renovate: datasource=node-version depName=node
ARG NODE_VERSION=24.20.0

# renovate: datasource=docker depName=nginxinc/nginx-unprivileged
ARG NGINX_VERSION=1.27.4-alpine

ARG APP_UID=1000

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
FROM mcr.microsoft.com/devcontainers/base:${DEBIAN_VERSION} AS develop
ARG PREK_VERSION
ARG CLAUDE_CODE_VERSION
ARG SNIP_VERSION
ARG UV_VERSION
ARG PYTHON_VERSION
ARG NODE_VERSION
ARG SSL_CERT_FILE
ARG SSL_CERT_DIR

ENV SSL_CERT_FILE=${SSL_CERT_FILE} \
    SSL_CERT_DIR=${SSL_CERT_DIR} \
    REQUESTS_CA_BUNDLE=${SSL_CERT_FILE} \
    CURL_CA_BUNDLE=${SSL_CERT_FILE}

COPY scripts/develop.sh /tmp/develop.sh
RUN bash /tmp/develop.sh "$PREK_VERSION" "$CLAUDE_CODE_VERSION" "$SNIP_VERSION" "$UV_VERSION" "$PYTHON_VERSION" "$NODE_VERSION"

USER vscode
WORKDIR /workspace
CMD ["sleep", "infinity"]

########################################
# builder — installs deps with pnpm (the pinned version comes from
# package.json's own `packageManager` field, which Corepack reads) and
# builds the static SPA bundle. A plain node image, not this Dockerfile's
# own `develop` stage -- that stage is the interactive devcontainer
# (Docker-in-Docker feature, `sleep infinity`, no app deps installed),
# not a build environment.
########################################
FROM node:${NODE_VERSION}-slim AS builder
ARG SSL_CERT_FILE
ARG SSL_CERT_DIR
ENV SSL_CERT_FILE=${SSL_CERT_FILE} \
    SSL_CERT_DIR=${SSL_CERT_DIR}

RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

########################################
# runner — nginx-unprivileged serving the built SPA and proxying /api to
# the real backend (see docs/adrs/0002-same-origin-api-proxy.md). Its own
# docker-entrypoint.d/20-envsubst-on-templates.sh already renders
# docker/nginx.conf.template -> /etc/nginx/conf.d/default.conf from real
# container env vars on every start; docker-entrypoint.d/ here adds one
# more such script for this app's own /config.js (its client-side
# runtime config), same mechanism, one level up the stack.
########################################
FROM nginxinc/nginx-unprivileged:${NGINX_VERSION} AS runner

# Defaults match the backend's own devcontainer (see docs/adrs/0001-...md
# and docs/adrs/0002-...md) -- correct for a local smoke-test of this
# image, not a real deployment, which must override all three.
ENV OIDC_AUTHORITY=http://localhost:8080/realms/template-fastapi \
    OIDC_CLIENT_ID=api \
    API_PROXY_TARGET=http://host.docker.internal:8000

COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/docker-entrypoint.d/20-envsubst-app-config.sh /docker-entrypoint.d/20-envsubst-app-config.sh
# The base image already switches to its unprivileged `nginx` user
# (uid/gid 101) -- root only for this one COPY+chown, since --chown alone
# reaches the *copied files* but not the pre-existing
# /usr/share/nginx/html directory entry itself (still root-owned there),
# and this stage's own docker-entrypoint.d script needs write access on
# that directory to create config.js at container start.
USER root
COPY --from=builder --chown=nginx:nginx /workspace/dist /usr/share/nginx/html
RUN chown nginx:nginx /usr/share/nginx/html
USER nginx

EXPOSE 8080
