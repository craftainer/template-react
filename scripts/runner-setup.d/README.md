# scripts/runner-setup.d/

Instance hook directory for the runner stage of the top-level
`Dockerfile`. `../runner-setup.sh` (template-owned, `replace` tier) creates
the group-0 runtime user, makes the home directory and `/app/data`
group-writable (and nothing else under `/app`), then runs every `*.sh` here in glob order as
`bash NN-name.sh APP_UID`, still as root, in the same `RUN` layer.

Empty apart from this file in the template. An instance adds files such as
`10-ca-certificates.sh` (install extra packages, create extra writable
directories) instead of editing `runner-setup.sh`.

## Do

- Number files (`NN-name.sh`) so the order is explicit.
- Use `set -euo pipefail` and give any extra *writable* directory (cache,
  uploads) group-0 ownership and `g+rwX`, as `runner-setup.sh` does for
  `/app/data`. App code is not writable: the `Dockerfile` copies it after
  this runs, with `--chown=<uid>:0` and a read-only `--chmod`.

## Don't

- Edit `../runner-setup.sh`; a template sync overwrites it.
- Put build-stage steps here; this runs in the `runner` stage only.
