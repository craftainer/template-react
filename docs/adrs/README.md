# docs/adrs/

Architecture Decision Records: one file per significant, app-specific
decision and the reasoning behind it (not repository conventions —
those belong in each directory's own `README.md` instead).

- Format: [`template.md`](template.md) (Michael Nygard's ADR format —
  Status, Context, Decision, Consequences).
- Filename: `NNNN-short-title.md`, numbered sequentially from `0001`
  (e.g. `0001-use-postgres-for-primary-storage.md`).

## Do

- Copy `template.md` to a new numbered file for each decision worth
  recording — one that's costly to reverse, affects multiple parts of
  the app, or that a future contributor would otherwise have to
  rediscover by reading git history.
- Record a decision that reverses an earlier one as a new ADR that says
  so in its Context, and update the old ADR's Status to
  `Superseded by NNNN` — never edit an accepted ADR's Decision itself.

## Don't

- Record routine implementation choices with no real alternative
  considered — that's what the code and its comments are for.
- Renumber or delete a past ADR, even a superseded or rejected one — it
  stays as a record of what was considered and why.
