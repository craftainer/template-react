#!/usr/bin/env bash
# Enables pnpm via Corepack (bundled with the Node.js develop.sh installs):
# the prek hooks and CI invoke `pnpm` directly, and Corepack reads the
# pinned version from package.json's `packageManager` field -- matching
# app.Dockerfile's builder stage.
set -euo pipefail

node_bin_dir="$(dirname "$(readlink -f "$(command -v node)")")"
"${node_bin_dir}/corepack" enable --install-directory /usr/local/bin
