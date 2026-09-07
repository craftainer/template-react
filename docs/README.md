# docs/

Knowledge about what this application does and why — not how the
repository is laid out or how it's developed (each directory's own
`README.md` covers that; see the root `README.md`) and not the
AI-assisted coding workflow (`CLAUDE.md` at the repo root covers that).

- `architecture.md` — infrastructure/deployment view: services, how
  they connect, and the devcontainer vs. smoke-test stacks.
- `system-design.md` — application-level view: layering, request flow,
  and key design decisions.
- `adrs/` — Architecture Decision Records: app-specific decisions and
  the reasoning behind them. See `adrs/README.md`.
- `plans/` — working plans for in-progress or upcoming work. See
  `plans/README.md`.
- `frs/` — functional requirements: what the system must do. See
  `frs/README.md`.
- `nfrs/` — non-functional requirements: quality attributes the system
  must meet. See `nfrs/README.md`.
- `stakeholders.md` — the stakeholder register: who has a stake in the
  app, their interest, and their influence.
- `glossary.md` — domain terminology, so a requirement or ADR can use a
  term precisely instead of redefining it inline.

Otherwise empty for now; add pages here as the app grows.

## Do

- Write about the product/domain here: what the app does, why a
  decision was made, how a feature is meant to behave.

## Don't

- Duplicate structural or syntax information that already lives in a
  directory `README.md`.
