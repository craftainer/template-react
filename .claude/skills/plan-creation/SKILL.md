---
name: plan-creation
description: Write a plan under docs/plans/ (and, for plans that need user setup, its pre-flight runbook) for multi-step or multi-item work, laid out so an orchestrator can execute it with parallel plan-executor subagents. Use when the user asks for a plan, a roadmap, or how to approach a large change.
---

# Plan creation

Produce a plan file under `docs/plans/` that someone else, usually a fresh
orchestrating session using the `plan-execution` skill, can execute
without coming back to ask. The plan file's format and lifecycle are in
`docs/plans/README.md` and `docs/plans/template.md`; this skill is how to
get to a good one.

## 1. Explore before writing

- Read the `README.md`s on the path to every directory the plan touches
  (`CLAUDE.md`, "Before writing anything"), the ADRs and NFRs it builds
  on, and any plan still in progress under `docs/plans/`. A new plan that
  touches files an unfinished plan is still changing must say it starts
  after that plan's close-out.
- For other repos the plan touches, look at their actual state (shallow
  clones in the scratchpad), not their names: what they contain, whether
  they're wired into template sync, what their latest releases are.
- Use a subagent for any sweep that would pull many files into context.
- Check the machine: free memory, CPU count, which toolchains this
  devcontainer has. These set the concurrency limit and decide whether
  executors need toolchain containers for other repos.

## 2. Research the open questions

- Libraries and frameworks: context7 first.
- Practices, standards, registry behavior: WebSearch/WebFetch, preferring
  primary sources (official docs, RFCs, maintainers). Cite the URLs in the
  plan.
- Anything outward-facing the plan will create (repo names, package names
  on each registry): check it's free now, and say so in the plan.
- Registry and platform quirks that would stop an unattended run (a
  registry with no pending trusted publishers needs a first-publish token;
  a ruleset the agent can't apply; a permission rule that would prompt)
  belong in the pre-flight runbook, found now rather than mid-run.

## 3. Ask the user what isn't yours to decide

Per `CLAUDE.md` ("Decide alone only where a common best practice
exists"): naming, public API shape, visual design, licensing and genuine
trade-offs go to the user. Ask them now, during planning, with
`AskUserQuestion` (2–4 options, trade-offs, your lean first and marked),
so the run doesn't stop for them later. Record each answer in the plan's
Decision log as "user decision". Decisions that can only be made after
research during execution become explicit gates in the plan instead.

## 4. Write the plan

Follow `docs/plans/template.md`. For a plan with more than one
independent work item, the Execution section needs everything
`docs/plans/README.md`'s "Execution section" lists, plus:

- **Orchestrator and executor models**, and the **concurrency target**:
  a rolling queue (start the next ready item whenever one finishes), with
  limits inside it for memory-heavy work (e.g. compiled-language builds)
  and zero parallel agents during measurements.
- **Worktrees:** `isolation: "worktree"` for this repo; for other repos,
  one local clone at `.claude/worktrees/ext-<repo>` and one
  `git worktree add` per item on `wip/<ID>`.
- **Toolchains:** where an executor runs another repo's checks (that
  repo's own devcontainer image, joined to this devcontainer's services).
- **"Done when"** for every brief: the repo's own
  `prek run --all-files --hook-stage manual`, run with new files staged
  (`git add -A` first: some hooks skip untracked files).
- **Work items:** ID (unique across active plans), what it implements,
  exact write set, dependencies. The first item in every repo adds all of
  that repo's new dependencies and its lockfile, alone. Research items
  are report-only and feed the Decision log.
- **Interfaces** between items running in parallel, as names and
  signatures both sides code against.
- **Pre-assigned numbers** for ADRs, NFRs and migrations, per repo.
- **Serialized lanes** (verification, release, benchmarks, e2e).
- **User gates** table, and **standing approvals** (what the orchestrator
  may do without asking: creating named repos, pushing branches, opening
  PRs, triggering template releases).
- **Decision log** seeded with every decision made while planning.

Keep the "why" short and link sources; put rationale that outlives the
plan into the ADRs the plan's items write.

## 5. Write the pre-flight runbook (when the user has setup to do)

If anything only the user can do must happen before kickoff (accounts,
registry publishers or tokens, org secrets, renaming repos, rebuilding the
devcontainer, local permission rules, machine resources), write
`docs/plans/<plan-filename>-preflight.md` next to the plan:

- **Checklist** at the top, one line per step.
- **Part 1, decisions:** each open question as tick boxes, recommended
  option first, so the user answers everything once.
- **Part 2, setup:** per step, where to click or what to run (exact URLs,
  field values, commands), and a **Check** line saying how to confirm it
  worked.
- **Kickoff:** a fresh session, what to verify (`/agents`, `/mcp`,
  `gh auth status`), and the exact message to send.
- A closing list of what the orchestrator will still come back for.

The runbook belongs to the plan and is deleted with it.

## 6. Verify and hand over

Run the repo's checks on the new files and show the output. Close with a
commit message for the user (`CLAUDE.md`, "Report changes after
executing"); don't commit unless asked.
