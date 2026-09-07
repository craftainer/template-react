#!/bin/sh
# Renders public/config.js.template (copied verbatim into the built dist/
# by Vite, see vite.config.ts) into /config.js from real container env
# vars, on every container start -- the client-side counterpart to
# nginx's own built-in docker-entrypoint.d/20-envsubst-on-templates.sh,
# which does the same for nginx.conf.template. See
# docs/adrs/0002-same-origin-api-proxy.md's "Runtime-configurable
# production image".
set -eu

envsubst '${OIDC_AUTHORITY} ${OIDC_CLIENT_ID}' \
    < /usr/share/nginx/html/config.js.template \
    > /usr/share/nginx/html/config.js
