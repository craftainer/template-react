---
name: plan-execution
description: Execute a docs/plans/ plan, or any task that splits into several independent items, as the orchestrator - briefing plan-executor subagents (executors and landers) in their own worktrees, answering their escalations with researched decisions and running the user gates. Use when the user asks to execute or continue a plan.
---

# Plan execution (orchestrator)

The main session orchestrates; it doesn't implement work items, review
diffs, run verification lanes or `/code-review`, merge or trigger
releases itself. It keeps the queue, writes briefs, researches and
decides escalations, raises user gates and keeps the plan's Status and
Decision log current. Executors and landers are `plan-executor`
subagents on the faster model by default: their side of the protocol
(brief contents, write-set rules, escalation triggers, lander mode,
report formats) is in `.claude/agents/plan-executor.md` and isn't
repeated here. Plan layout
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

- Keep the plan's target number of agents (executors and landers
  together) running. Waves define
  dependencies, not batches: whenever an agent reports, start the
  next **ready** item (dependencies landed, write set
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

**`done`:** don't read the diff yourself. Start a lander for the item
(or for the repo's wave PR once its items are done): a `plan-executor`
run on the faster model unless the plan names another, briefed per "Lander mode" in
`.claude/agents/plan-executor.md` with the executor's report, the
original write set and "Done when", the integration branch and PR, the
verification lane's commands, and the standing approvals. At most one
lander per repo at a time. Then start the next ready item.

**A lander's report:** `done` means landed: PR, merge commit (where it may
merge), CI, review rounds with dispositions, the lane tail and NOTES.
Record it in the plan's Status and start whatever it unblocks. A red lane
is the lander's to handle: it fixes what it can inside the item's write
set and otherwise reverts the merge and escalates. Treat what it escalates like an executor's
escalation below, with its evidence in hand.

**`escalate`** (executor or lander): research before deciding:

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

Landers run these, one at a time, never in parallel with each other where
they share resources; you sequence them through the queue:

- **Verification:** after each merge into a repo's integration branch,
  the repo's full suite including integration and e2e. Only one lander at
  a time runs suites that share the devcontainer's services or fixed
  ports, across all repos. On red the lander fixes it inside the item's write
  set and re-runs the lane; if it can't, it reverts that merge (keeping
  the integration branch green) and escalates.
- **Releases**, in the plan's dependency order, by a lander, only where
  the standing approvals allow; every other release is a gate you raise.
- **Measurements**, only in quiet windows with no other agents running.

## Gates and the user

- Landers never merge a PR the user merges and never act outside the
  standing approvals; they escalate and you raise the gate.
- Batch same-kind gates in a wave (PR merges, releases) into one request.
  Batch non-blocking questions too.
- Show evidence with every gate: it comes from lander reports (check and
  lane output, CI links, review dispositions, release runs). If a report
  lacks it, send the lander back for it rather than checking yourself.
- After each landed batch, add a dated progress bullet to the plan's
  Status, so a fresh session can resume from the plan alone.

## Close-out

A final verification lane over every repo the plan touched, run by a
lander; fold what's
worth keeping into ADRs and docs; ask for the final gate; then delete the
plan (and its runbook) per `docs/plans/README.md`, and give the user a
commit message.
