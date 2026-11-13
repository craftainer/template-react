#!/usr/bin/env bash
# Enables pnpm via Corepack: the prek hooks and CI invoke `pnpm` directly, and
# Corepack reads the pinned version from package.json's `packageManager`
# field. Corepack ships with Node.js up to 24.x but not from 25.0.0 on
# (https://github.com/nodejs/corepack#how-to-install), so it is installed from
# npm when the Node here lacks it.
set -euo pipefail

# renovate: datasource=npm depName=corepack
COREPACK_VERSION=0.36.0

node_bin_dir="$(dirname "$(readlink -f "$(command -v node)")")"
if [[ ! -x "${node_bin_dir}/corepack" ]]; then
    "${node_bin_dir}/npm" install --global --no-audit --no-fund --silent "corepack@${COREPACK_VERSION}"
fi
# A global npm install links the binary next to node, so this finds either.
"${node_bin_dir}/corepack" enable --install-directory /usr/local/bin
