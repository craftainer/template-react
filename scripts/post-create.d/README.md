# scripts/post-create.d/

Instance-owned hook: extra steps an instance runs when the devcontainer
is created. This directory ships only this file; an instance adds its
scripts here (see `docs/TEMPLATE.md`'s "Instance extension points").

- Every `*.sh` here runs as `vscode` inside the running devcontainer, with
  the compose stack up, in lexical filename order (use an `NN-` prefix,
  e.g. `10-migrate.sh`), after `../post-create.sh`'s own steps.
- A script pins its own tool versions as
  `# renovate: datasource=... depName=...` followed on the next line by
  `NAME_VERSION=x.y.z`, so Renovate can bump it.
