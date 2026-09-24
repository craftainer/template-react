# syntax=docker/dockerfile:1.27
# Runtime image (builder → runner); the devcontainer image is the
# base-owned `Dockerfile`'s `develop` stage.

# NODE_VERSION/DEBIAN_VERSION must match the base-owned Dockerfile's, so
# the bundle is built with the same Node the devcontainer tests against --
# enforced by scripts/check-dockerfile-versions.sh.
# renovate: datasource=node-version depName=node
ARG NODE_VERSION=24.21.0
ARG DEBIAN_VERSION=trixie

# renovate: datasource=docker depName=nginxinc/nginx-unprivileged
ARG NGINX_VERSION=1.27.4-alpine

ARG SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ARG SSL_CERT_DIR=/etc/ssl/certs

########################################
# builder — installs deps with pnpm (the pinned version comes from
# package.json's own `packageManager` field, which Corepack reads) and
# builds the static SPA bundle.
########################################
FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim AS builder
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
# scripts/docker/nginx.conf.template -> /etc/nginx/conf.d/default.conf from
# real container env vars on every start; docker-entrypoint.d/ here adds
# one more such script for this app's own /config.js (its client-side
# runtime config), same mechanism, one level up the stack.
########################################
FROM nginxinc/nginx-unprivileged:${NGINX_VERSION} AS runner

# Defaults match the backend's own devcontainer (see docs/adrs/0001-...md
# and docs/adrs/0002-...md) -- correct for a local smoke-test of this
# image, not a real deployment, which must override all three.
ENV OIDC_AUTHORITY=http://localhost:8080/realms/template-fastapi \
    OIDC_CLIENT_ID=api \
    API_PROXY_TARGET=http://host.docker.internal:8000

COPY scripts/docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY scripts/docker/docker-entrypoint.d/20-envsubst-app-config.sh /docker-entrypoint.d/20-envsubst-app-config.sh
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
