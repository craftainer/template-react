#!/usr/bin/env bash
# Devcontainer postCreateCommand: base setup, then the instance's own
# scripts/post-create.d/*.sh hook.
set -euo pipefail

git config --global --add safe.directory /workspace
prek install

for f in /workspace/scripts/post-create.d/*.sh; do
  [ -e "$f" ] || continue
  echo "==> $f"
  bash "$f"
done
