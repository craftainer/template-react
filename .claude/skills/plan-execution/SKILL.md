---
name: plan-execution
description: Execute a docs/plans/ plan, or any task that splits into several independent items, as the orchestrator - briefing plan-executor subagents in their own worktrees, answering their escalations with researched decisions, merging, verifying and running the user gates. Use when the user asks to execute or continue a plan.
---

# Plan execution (orchestrator)

The main session orchestrates; it doesn't implement work items itself.
Executors are `plan-executor` subagents: their side of the protocol
(brief contents, write-set rules, escalation triggers, report format) is
in `.claude/agents/plan-executor.md` and isn't repeated here. Plan layout
is in `docs/plans/README.md`.

## Before the first item

1. Read the plan in full, its Decision log (settled; don't reopen) and
   its pre-flight runbook if there is one. Confirm the kickoff gate (G0)
   with the user unless the kickoff message grants it.
2. Note the plan's concurrency target, limits and standing approvals.
   Anything outside the standing approvals is asked for individually.
3. Set up what items need: clones and worktrees for other repos,
   toolchain images, the integration branch named in the plan.

## The queue

- Keep the plan's target number of executors running. Waves define
  dependencies, not batches: whenever an executor reports, start the
  next **ready** item (dependencies merged and verified, write set
  disjoint from every running item), critical path first, then the item
  that unblocks the most.
- Start each with the `Agent` tool, `subagent_type: "plan-executor"`,
  the model the plan names, and `isolation: "worktree"` (this repo) or an
  explicit worktree path (other repos), in the background.
- A brief holds: the goal quoted from the plan plus the Decision log
  rows that apply, the exact write set, the interfaces to provide or rely
  on, and "Done when". Nothing the executor would have to guess.
- Respect the plan's limits inside the target (e.g. one agent compiling
  a heavy language at a time; no agents during a measurement window).

## When an executor reports

**`done`:** read the diff, not just the summary. Every changed file is
inside the write set; `CHECKS` shows real output with new files staged.
Merge into the integration branch, run the verification lane, update the
plan's Status, then start the next ready item.

**`escalate`:** research before deciding:

1. context7 for the library or framework involved;
2. WebSearch/WebFetch for the exact error text, the tool's issue tracker,
   changelog and official docs (primary sources over blog posts);
3. this repo's ADRs, NFRs, READMEs and the plan's Decision log.

Then:

- **If the research converges** on a common best practice, or the plan,
  an ADR or an NFR requires one option: decide, add a Decision log row
  (decision, reason, source URLs), and **resume the same executor** with
  `SendMessage`, quoting the row. Start a new executor only if the old
  one's context is unusable.
- **If it doesn't** (sources disagree, a real trade-off, taste or
  convention), it's the user's decision (`CLAUDE.md`). Ask with the
  question in one sentence, 2–4 options with trade-offs, the sources and
  why they don't settle it, and your lean labeled as a lean. Pause only
  that item; keep the queue running. Record the answer as "user
  decision".
- Scope changes, security or licensing trade-offs, deleting anything the
  plan didn't create, and anything outside the standing approvals also go
  to the user.
- If the same item escalates twice on the same approach, re-plan the item
  (split it, change the approach, record why) instead of trying a third
  variation.

## Serialized lanes

Run these yourself, one at a time, never in parallel executors:

- **Verification:** after each merge, the repo's full suite including
  integration and e2e (they share the devcontainer's services and ports).
  On red: revert that merge on the integration branch, send the failing
  output to the owning executor as an escalation-style message, and keep
  the queue moving.
- **Releases**, in the plan's dependency order, each behind its gate.
- **Measurements**, only in quiet windows with no executors running.

## Gates and the user

- Batch same-kind gates in a wave (PR merges, releases) into one request.
  Batch non-blocking questions too.
- Show evidence with every gate: check output, CI links, release runs.
- After each merged batch, add a dated progress bullet to the plan's
  Status, so a fresh session can resume from the plan alone.

## Close-out

Final verification lane over every repo the plan touched; fold what's
worth keeping into ADRs and docs; ask for the final gate; then delete the
plan (and its runbook) per `docs/plans/README.md`, and give the user a
commit message.
