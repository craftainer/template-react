# docs/frs/

Functional requirements: what the system must do. Distinct from
`../adrs/`'s "why" for decisions already made, `../nfrs/`'s quality
attributes, and `../plans/`'s "how and when" for in-progress work — a
requirement can motivate an ADR or a plan, but belongs here first.

- Format: [`template.md`](template.md).
- Filename: `FR-NNNN-short-title.md`, numbered sequentially from
  `FR-0001`.

## Do

- Give every requirement a stable ID (`FR-NNNN`) so code comments,
  tests, and ADRs can reference it without a full title.
- Link a requirement to the stakeholder(s) who raised it in its
  `Source` section (`../stakeholders.md`), and to any ADR it prompted
  or depends on.
- Update a requirement's own `Status` in place as it moves from
  `Proposed` to `Implemented` — like an ADR, don't rewrite its
  substance after acceptance; record a changed requirement as a new
  one that supersedes the old, so history stays intact.

## Don't

- Duplicate an ADR's reasoning here — link to it instead.
- Record an implementation detail with no stakeholder-visible
  behavior behind it; that belongs in code/tests, not a requirement.
- Renumber or delete a past requirement, even a superseded or
  rejected one — it stays as a record of what was considered and why.
