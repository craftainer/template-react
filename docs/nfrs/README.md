# docs/nfrs/

Non-functional requirements: quality attributes the system must meet
(performance, security, availability, maintainability, etc.), as
distinct from `../frs/`'s "what the system does".

- Format: [`template.md`](template.md).
- Filename: `NFR-NNNN-short-title.md`, numbered sequentially from
  `NFR-0001`.

## Do

- Give every requirement a stable ID (`NFR-NNNN`) so code comments,
  tests, and ADRs can reference it without a full title.
- State a measurable target where possible, and how it's verified.
- Link a requirement to the stakeholder(s) who raised it in its
  `Source` section (`../stakeholders.md`), and to any ADR it prompted
  or depends on.
- Update a requirement's own `Status` in place as it moves from
  `Proposed` to `Implemented` — like an ADR, don't rewrite its
  substance after acceptance; record a changed requirement as a new
  one that supersedes the old, so history stays intact.

## Don't

- Duplicate an ADR's reasoning here — link to it instead.
- Renumber or delete a past requirement, even a superseded or
  rejected one — it stays as a record of what was considered and why.
