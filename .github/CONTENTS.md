# .github/

- `workflows/` — GitHub Actions; see its own `README.md`.
- `scripts/` — helper scripts used by the workflows; see its own
  `README.md`.
- `renovate.json` — weekly update PRs for GitHub Actions, every
  Dockerfile/compose image tag repo-wide (scanned recursively, unlike
  Dependabot), and the `# renovate:` comment-annotated version pins in
  `.devcontainer/Dockerfile` (and an instance's top-level runtime
  `Dockerfile`). `Makefile` and `image.mk` `*_VERSION` pins carry the same
  marker; the hadolint image in `.pre-commit-config.yaml`, the Trivy
  image in `scripts/image-scan.sh` and the skopeo image in the `Makefile`
  (the last two by tag and digest) have their own regex managers. An instance's own `renovate.json` additions cover its
  language's own package manifest (e.g. `pyproject.toml`, `Cargo.toml`,
  `package.json`). All patch/minor updates are grouped into a single
  weekly PR that automerges once required checks pass; all major updates
  are grouped into a separate PR for manual review. A Python minor
  upgrade (e.g. 3.14 to 3.15) also gets its own PR for manual review:
  it passes this repo's checks, but for an instance running Python as
  its app runtime it's a runtime upgrade (its runtime `Dockerfile` must
  match, and its tools must support the new version). Devcontainer
  features are left out: Renovate can't regenerate their lockfile, so
  they're bumped by hand (see `../.devcontainer/README.md`).
- `ISSUE_TEMPLATE/` — issue forms (bug report, feature request) shown
  when opening a new issue.
- `PULL_REQUEST_TEMPLATE.md` — prefills the description box for new PRs.

## Do

- Keep workflow logic that's longer than a few lines in `scripts/` and
  call it from the workflow YAML, rather than growing a shell script
  inline in `run:`.

## Don't

- Pin an Action to a floating tag like `@v7` or `@main` — pin the exact
  patch version (see `docs/TEMPLATE.md`'s "Versions and config"
  section).
