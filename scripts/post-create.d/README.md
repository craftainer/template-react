# scripts/post-create.d/

Instance-owned hook: extra steps an instance runs when the devcontainer
is created. This directory ships no scripts in base; a mid-layer template or an instance
adds `NN-name.sh` scripts here (see `docs/TEMPLATE.md`'s "Instance extension
points"). A script a template ships is `replace` tier in its sync manifest, so
a sync overwrites it; an instance's own script is listed in
`.github/template-sync-manifest.local.yml` so a sync leaves it alone.

- Every `*.sh` here runs as `vscode` inside the running devcontainer, with
  the compose stack up, in lexical filename order (use an `NN-` prefix,
  e.g. `10-migrate.sh`), after `../post-create.sh`'s own steps.
- A script pins its own tool versions as
  `# renovate: datasource=... depName=...` followed on the next line by
  `NAME_VERSION=x.y.z`, so Renovate can bump it.
