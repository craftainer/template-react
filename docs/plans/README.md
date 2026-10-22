# docs/plans/

Working plans for in-progress or upcoming app-specific work — the "how
and when," as distinct from `../adrs/`'s "why" for decisions already
made. A plan can reference an ADR it depends on or that it prompts.

- Format: [`template.md`](template.md).
- Filename: `YYYY-MM-short-title.md` (the month the plan was started),
  e.g. `2026-01-add-billing.md`.

## Execution section

A plan with more than one independent work item is executed by an
orchestrating session that only decides and raises gates, through
`plan-executor` subagents as executors and landers (see
`../../CLAUDE.md`, "Execute multi-item work as an orchestrator", and the
`plan-execution` skill; plans themselves are written with the
`plan-creation` skill, both in `../../.claude/skills/`). It
needs an `## Execution` section laid out so the orchestrator can turn
each item straight into a brief:

- **Work items:** each has an ID, the plan text it implements, a
  **write set** (exact files and directories), and its dependencies.
- **Waves:** items grouped so that every item in a wave has a write set
  disjoint from the others in that wave. A file nearly everything
  touches (a rename, dependency additions to `pyproject.toml` and the
  lockfile) goes in its own serial wave first, so later items never
  fight over it.
- **Interfaces:** where items in the same wave depend on each other,
  name the function or module contract between them, so both sides can
  be built in parallel against it.
- **Pre-assigned numbers:** sequentially numbered files (ADRs, NFRs,
  migrations) that parallel items create get their numbers fixed in the
  plan, so two items never pick the same one.
- **Serialized lanes:** anything sharing devcontainer services
  (integration and e2e suites, load tests and benchmarks) runs one at a
  time, outside the parallel waves, by a lander (never the orchestrator).
  Measurements also need a quiet window, with no parallel agents
  competing for CPU.
- **Standing approvals:** which merges and releases landers may do
  without asking (for example, template releases and merges in repos the
  plan creates); a PR the user merges is never among them.
- **User gates:** a table of every outward-facing or hard-to-reverse
  step (creating repos, pushing, opening PRs, publishing, tagging) that
  waits for the user's explicit yes, except what the plan's kickoff
  gate (G0) or its standing approvals grant landers (pushing and
  opening the wave PRs).
- **Decision log:** a dated table of settled decisions. Executors treat
  it as final, and the orchestrator appends to it as it resolves
  escalations.

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
