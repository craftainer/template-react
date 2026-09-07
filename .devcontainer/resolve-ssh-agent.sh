#!/bin/sh
# Picks whichever of the two possible SSH agent sockets is actually usable
# and symlinks it to a stable path (see devcontainer.json's SSH_AUTH_SOCK).
#
# - /ssh-agent: the host's own SSH_AUTH_SOCK, bind-mounted directly.
# - /ssh-agent-macos: Docker Desktop's built-in agent-forwarding proxy,
#   always present at this fixed path inside the Desktop VM on macOS and
#   Windows.
#
# Both arrive owned root:root mode 660 regardless of platform or of who
# owns the socket on the host side — bind-mounting a socket special file
# carries over the owning uid/gid as seen inside the Desktop VM (root),
# not the host user's. `remoteUser` (vscode) can't connect to either as
# a result, so this chmods both to 666 first (harmless: these are
# forwarding sockets meant to be reachable by whatever connects to them,
# and chmod on a bind mount only touches this one inode, not host files).
# Needs passwordless sudo, already granted to vscode in the Dockerfile.
#
# ssh-add -l exit codes: 0 = agent reachable, has keys; 1 = agent reachable,
# no keys loaded yet; 2 = can't connect (dead, no agent, or the mount
# degraded to an anonymous volume). We only need "reachable", so treat 0
# and 1 as success.
set -eu

resolved=/home/vscode/.ssh-agent-resolved.sock
rm -f "$resolved"

for candidate in /ssh-agent-macos /ssh-agent; do
  [ -S "$candidate" ] && sudo chmod 666 "$candidate" 2>/dev/null || true
  status=0
  SSH_AUTH_SOCK="$candidate" ssh-add -l >/dev/null 2>&1 || status=$?
  if [ "$status" != 2 ]; then
    ln -s "$candidate" "$resolved"
    exit 0
  fi
done

# Neither socket is reachable (e.g. no agent running on the host, or a CI
# environment with no SSH_AUTH_SOCK at all) -- fall back to the plain
# forwarded socket so failures look the same as before this script existed.
ln -s /ssh-agent "$resolved"
