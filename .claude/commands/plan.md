---
description: Restate requirements, assess risks, and create a step-by-step implementation plan, then proceed immediately (no approval gate — CLAUDE.md).
argument-hint: '[feature description | path/to/*.prd.md]'
---

<!-- Ported from everything-claude-code — Copyright (c) 2026 Affaan Mustafa,
     MIT license: https://github.com/affaan-m/everything-claude-code/blob/main/LICENSE
     Bali adaptation: the wait-for-confirmation gate is removed per CLAUDE.md
     ("plan, then go"); integration pointers reference this repo's own loop. -->

# Plan Command

This command creates a comprehensive implementation plan before writing any code. It accepts either free-form requirements or a PRD markdown file.

Plan inline: do not call the Task tool or any subagent to produce the plan. Executing it is different — each step goes to a fresh worker (see the last section).

## What This Command Does

1. **Restate Requirements** - Clarify what needs to be built
2. **Identify Risks** - Surface potential issues and blockers
3. **Create Step Plan** - Break down implementation into phases
4. **Proceed Immediately** - post the plan in chat for the record, then start executing. Per CLAUDE.md there is NO approval gate; never block waiting for the owner to confirm a plan.

## When to Use

Use `/plan` when:

- Starting a new feature or phase
- Making significant architectural changes
- Working on complex refactoring
- Multiple files/components will be affected
- Requirements are unclear or ambiguous

## How It Works

The assistant will:

1. **Analyze the request** and restate requirements in clear terms
2. **Ground the plan** in relevant codebase patterns when the repo is available
3. **Break down into phases** with specific, actionable steps — each step is one PR: one change, under ~400 changed lines not counting tests
4. **Identify dependencies** between components
5. **Assess risks** and potential blockers
6. **Estimate complexity** (High/Medium/Low)
7. **Present the plan** and proceed immediately — no confirmation gate in this repo. If the plan surfaces a genuine scope or architecture decision the docs don't answer, message the owner about that one question per CLAUDE.md; everything else starts now.

## Input Modes

| Input                   | Mode                | Behavior                                                                                                                 |
| ----------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `path/to/name.prd.md`   | PRD artifact mode   | Read the PRD, pick the next pending delivery milestone or implementation phase, and write `.claude/plans/{name}.plan.md` |
| Any other markdown path | Reference mode      | Read the file as context and produce an inline plan                                                                      |
| Free-form text          | Conversational mode | Produce an inline plan                                                                                                   |
| Empty input             | Clarification mode  | Ask what should be planned                                                                                               |

In PRD artifact mode, create `.claude/plans/` if needed. Files under
`.claude/plans/` are working artifacts of a single task — `docs/PLAN.md`
remains the ONLY living status doc and must still be updated per CLAUDE.md;
never treat a `.plan.md` artifact as a substitute. Run Prettier over any
generated `.plan.md` before committing it (the `format:check` CI step covers
`.claude/`).

## Pattern Grounding

**First, re-read `docs/ARCHITECTURE.md` and `docs/PLAN.md`.** ARCHITECTURE.md is
law: a plan may never contradict a decided design (e.g. it explicitly rejects a
queue in the tap path — see "Why there's no queue"). If the task genuinely
requires changing an architecture decision, that is an owner question per
CLAUDE.md, not something the plan quietly overrides. PLAN.md says whether the
work is already done, scheduled, or deliberately cut.

Then search the codebase for conventions the implementation should mirror. Capture the top example for each relevant category with file references:

| Category       | What to capture                                                      |
| -------------- | -------------------------------------------------------------------- |
| Naming         | File, function, type, command, or script naming in the affected area |
| Error handling | How failures are raised, returned, logged, or handled gracefully     |
| Logging        | Levels, format, and what gets logged                                 |
| Data access    | Repository, service, query, or filesystem patterns                   |
| Tests          | Test file location, framework, fixtures, and assertion style         |

If no similar code exists, state that explicitly. Do not invent a pattern.

## PRD Artifact Output

When called with a `.prd.md` file, write the plan to `.claude/plans/{kebab-case-name}.plan.md` using this structure:

````markdown
# Plan: {Feature Name}

**Source PRD**: {path}
**Selected Milestone**: {milestone or phase name}
**Complexity**: {Small | Medium | Large}

## Summary

{2-3 sentences}

## Patterns to Mirror

| Category | Source      | Pattern             |
| -------- | ----------- | ------------------- |
| Naming   | `path:line` | {short description} |
| Errors   | `path:line` | {short description} |
| Tests    | `path:line` | {short description} |

## Files to Change

| File   | Action                   | Why      |
| ------ | ------------------------ | -------- |
| `path` | CREATE / UPDATE / DELETE | {reason} |

## Tasks

### Task 1: {name}

- **Action**: {what to do}
- **Mirror**: {pattern to follow}
- **Validate**: {command that proves correctness}

## Validation

```bash
{project-specific validation commands}
```

## Risks

| Risk | Likelihood | Mitigation |
| ---- | ---------- | ---------- |

## Acceptance

- [ ] All tasks complete
- [ ] Validation passes
- [ ] Patterns mirrored, not reinvented
````

After writing the artifact, report its path and proceed immediately with implementation per CLAUDE.md.

## Bali Notes (replaces the upstream confirmation gate)

- The upstream version of this command stops and waits for the user to type "yes" before any code is written. In this repo that gate is **removed by owner order** (CLAUDE.md, "Plan, then go"): post the plan, then execute.
- The owner can always interrupt and redirect mid-run; the plan in chat is the record they redirect against.
- Message the owner only for the CLAUDE.md stop conditions: parked steps, device checkpoints, genuine scope/architecture decisions the docs don't answer, destructive/irreversible actions.

## Integration with the Bali Working Loop — one fresh worker per step

After posting the plan, this session is the **conductor**. It never writes code itself: it hands out steps and keeps the record, so its context holds short reports, never diffs.

For EACH PR-sized step, in order, one at a time:

1. Launch a worker: the Agent tool with `subagent_type: general-purpose`, `isolation: "worktree"` and the brief below. Wait for its report before launching the next one — steps build on each other, and every PR edits `docs/PLAN.md`, so two workers at once would collide.
2. Keep only the report. A **parked** step (a draft PR) doesn't stop the run: carry on with the next step that doesn't depend on it.
3. A worker whose step is over santa's size limit reports back with a proposed split. Either re-plan the step into smaller ones — each to its own worker, building on the pushed branch — or, if it genuinely can't be split, continue that worker (SendMessage) with "go on as one PR; put this reason in the PR description: …".
4. A device checkpoint (📱) or a scope/architecture question the docs don't answer: stop and ask the owner, per CLAUDE.md.

When every step is merged or parked, report: merged PRs, parked steps and why.

Worker brief (fill in the step):

> You are the worker for exactly one step: <the step, with its validation command and the plan's notes for it>. You are the worker, not a planner: never run `/plan` and never start workers of your own (santa's reviewers are fine). Start from the latest main: `git fetch origin && git switch -c <branch> origin/main`. Read CLAUDE.md and orient per its step 1, then do its steps 3–6 for this step only — execute, verify (the checks, then `.claude/commands/santa-loop.md`), ship (PR, auto-merge, every check green) and PLAN.md. Reply in at most 10 lines: the PR link, merged or parked (and why) — or, if santa's size check stopped you, the pushed branch and a proposed split — and anything the owner must know.
