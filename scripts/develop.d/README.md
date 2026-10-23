# scripts/develop.d/

Instance-owned hook: extra devcontainer tooling an instance layers on top
of `../develop.sh`. Base ships no scripts here; mid-layer templates may. A mid-layer template or an
instance adds `NN-name.sh` scripts here (see `docs/TEMPLATE.md`'s "Instance extension
points"). A script a template ships is `replace` tier in its sync manifest, so
a sync overwrites it; an instance's own script is listed in
`.github/template-sync-manifest.local.yml` so a sync leaves it alone.

- Every `*.sh` here runs as root, in lexical filename order (use an `NN-`
  prefix, e.g. `10-apt.sh`), after `scripts/develop.sh`, during the
  `develop` stage build.
- `PYTHON_VERSION`, `UV_VERSION` and `NODE_VERSION` are in the
  environment, and `uv`, `python3`, `node` and `prek` are already on
  `PATH`.
- A script pins its own tool versions as
  `# renovate: datasource=... depName=...` followed on the next line by
  `NAME_VERSION=x.y.z`, so Renovate can bump it.
