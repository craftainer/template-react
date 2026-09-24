#!/usr/bin/env bash
# Installs the app's dependencies into node_modules, which the prek hooks
# (oxlint/prettier/tsc/vitest) and `pnpm dev` all run from.
set -euo pipefail

cd /workspace
pnpm install --frozen-lockfile
