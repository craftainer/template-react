# syntax=docker/dockerfile:1.28
# Runtime image (builder + bff-deploy -> runner), the repo's top-level
# Dockerfile; the devcontainer image is `.devcontainer/Dockerfile`'s `develop`
# stage.

# NODE_VERSION/DEBIAN_VERSION must match .devcontainer/Dockerfile's, so
# the bundle is built with the same Node the devcontainer tests against --
# enforced by scripts/check-dockerfile-versions.sh.
# renovate: datasource=node-version depName=node
ARG NODE_VERSION=24.22.1
ARG DEBIAN_VERSION=trixie

ARG SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ARG SSL_CERT_DIR=/etc/ssl/certs

########################################
# builder -- installs deps with pnpm (the pinned version comes from
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
# bff/package.json: bff/ is a workspace member, so the install needs it.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY bff/package.json bff/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

########################################
# bff-deploy -- the BFF's production dependency tree only, as a standalone
# directory (`pnpm deploy`), so the runner needs neither pnpm nor the
# workspace. bff/src is Node-typed TypeScript run directly (type stripping),
# so there is nothing to compile.
########################################
FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim AS bff-deploy
ARG SSL_CERT_FILE
ARG SSL_CERT_DIR
ENV SSL_CERT_FILE=${SSL_CERT_FILE} \
    SSL_CERT_DIR=${SSL_CERT_DIR}

RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY bff/package.json bff/package.json
COPY bff/src bff/src
RUN pnpm --filter ./bff deploy --prod /out

########################################
# runner -- Node, unprivileged (`node`, uid 1000), digest-pinned. Runs the
# BFF on 8080: it serves the built SPA (BFF_STATIC_DIR), the /bff/* auth
# routes and the reverse proxy to the API upstreams. Renovate updates the
# tag and digest together. Keep the tag equal to
# NODE_VERSION-DEBIAN_VERSION-slim (the digest is the multi-arch index's): a
# digest wins over the tag when Docker pulls, so the tag cannot be derived from
# the ARGs here; when the ARGs change, change this line with them (the
# builder's node binary is what the tests ran against). No script checks this
# yet.
########################################
# renovate: datasource=docker depName=node
FROM node:24.22.1-trixie-slim@sha256:89c5244bc22a9bc3287d89ebc7e49b9cb5bb84cd40e6175ac3421d5a9f68b95a AS runner

ENV NODE_ENV=production \
    BFF_STATIC_DIR=/app/dist
WORKDIR /app
# The BFF needs only the node binary. npm and corepack (bundled with the base
# image, with their own vendored dependencies) are never run here, and Trivy
# reports HIGH CVEs in npm's vendored brace-expansion and undici, so remove them.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=bff-deploy --chown=root:root /out /app
COPY --from=builder --chown=root:root /workspace/dist /app/dist
USER node

# The required runtime env (PUBLIC_ORIGIN, OIDC_ISSUER, OIDC_CLIENT_SECRET,
# SESSION_STORE_URL) has no default; the BFF refuses to start without it.
EXPOSE 8080
CMD ["node", "src/main.ts"]
