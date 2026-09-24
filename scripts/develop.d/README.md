# scripts/develop.d/

Instance-owned hook: extra devcontainer tooling an instance layers on top
of `../develop.sh`. This directory ships only this file; an instance adds
its scripts here (see `docs/TEMPLATE.md`'s "Instance extension points").

- Every `*.sh` here runs as root, in lexical filename order (use an `NN-`
  prefix, e.g. `10-apt.sh`), after `scripts/develop.sh`, during the
  `develop` stage build.
- `PYTHON_VERSION`, `UV_VERSION` and `NODE_VERSION` are in the
  environment, and `uv`, `python3`, `node` and `prek` are already on
  `PATH`.
- A script pins its own tool versions as
  `# renovate: datasource=... depName=...` followed on the next line by
  `NAME_VERSION=x.y.z`, so Renovate can bump it.
