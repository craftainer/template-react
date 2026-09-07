# .github/

- `workflows/` — GitHub Actions; see its own `README.md`.
- `scripts/` — helper scripts used by the workflows; see its own
  `README.md`.
- `renovate.json` — weekly update PRs for GitHub Actions, every
  Dockerfile/compose image tag repo-wide (scanned recursively, unlike
  Dependabot), and the `# renovate:` comment-annotated version pins in the
  Dockerfile. An instance's own `renovate.json` additions cover its
  language's own package manifest (e.g. `pyproject.toml`, `Cargo.toml`,
  `package.json`). All patch/minor updates are grouped into a single
  weekly PR that automerges once required checks pass; all major updates
  are grouped into a separate PR for manual review.
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
