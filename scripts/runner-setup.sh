#!/usr/bin/env bash
# Prepares the runner stage's runtime user for arbitrary-UID platforms
# (e.g. OpenShift, which ignores an image's own UID and always runs it
# under group 0), and a numeric (not named) final USER in the Dockerfile.
#
# Run it BEFORE copying app content. It creates the user and group 0
# ownership only where the app writes at runtime: the home directory and
# /app/data (group read/write/execute). /app itself stays root-owned and not
# writable. Then COPY app code with `--chown=<uid>:0` as
# read-only: 0550 directories, 0440 files, set with numeric modes per kind
# (`find -type d/-type f ... chmod`, or `--chmod=0550`/`0440` per source). Not
# the symbolic `--chmod=u=rX,g=rX,o=`: it left files unreadable on GitHub's
# stock-runner Docker even with dockerfile:1.28. Either way
# it needs no recursive chgrp/chmod (which would copy every file into a new
# layer) and the runtime user can't modify it. Other writable directories
# (caches, upload dirs) are created by runner-setup.d hooks.
#
# Optional: an instance whose runner image needs no such user (an nginx runner
# with its own non-root user) never calls this script.
#
# Usage: runner-setup.sh APP_UID
#
# Afterwards runs every runner-setup.d/*.sh next to this script, in glob
# order, as `bash NN-name.sh APP_UID`; see runner-setup.d/README.md.
set -euo pipefail

app_uid=$1
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

useradd --create-home --uid "$app_uid" --gid 0 appuser
chgrp -R 0 /home/appuser
chmod -R g+rwX /home/appuser

install -d -m 0755 /app
install -d -o "$app_uid" -g 0 -m 0770 /app/data

shopt -s nullglob
for hook in "$here"/runner-setup.d/*.sh; do
    bash "$hook" "$app_uid"
done
