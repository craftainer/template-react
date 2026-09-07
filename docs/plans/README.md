# docs/plans/

Working plans for in-progress or upcoming app-specific work — the "how
and when," as distinct from `../adrs/`'s "why" for decisions already
made. A plan can reference an ADR it depends on or that it prompts.

- Format: [`template.md`](template.md).
- Filename: `YYYY-MM-short-title.md` (the month the plan was started),
  e.g. `2026-01-add-billing.md`.

## Do

- Update a plan's own Status as work progresses, in place — a plan is a
  living document until it's marked `Done` or `Abandoned`.
- Once a plan's work has been executed, either delete the file, or — if
  it captured knowledge worth keeping (an ADR-worthy decision, reference
  material for future work) — fold that into an ADR (`../adrs/`, if it
  involved a significant, reversible-at-cost decision) or `../` (product
  knowledge), then remove the plan file. Either way, a plan under this
  directory is transient and doesn't linger once its work is done; print
  a brief commit message summarizing the change for the user to use (not
  create the commit yourself, unless asked).

## Don't

- Use a plan file for a decision record — a plan can point at an ADR,
  but the decision and its reasoning belong in `../adrs/`.
- Leave a finished plan's file in place "as a record" — that's what
  folding its outcome into an ADR or `../` and removing the file is for;
  an untouched pile of `Done` plan files just makes the active ones
  harder to find.
