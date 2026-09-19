---
description: Restate requirements, assess risks, and create a step-by-step implementation plan, then proceed immediately (no approval gate — CLAUDE.md).
argument-hint: '[feature description | path/to/*.prd.md]'
---

<!-- Ported from everything-claude-code (affaan-m, MIT). Bali adaptation: the
     wait-for-confirmation gate is removed per CLAUDE.md ("plan, then go");
     integration pointers now reference this repo's own working loop. -->

# Plan Command

This command creates a comprehensive implementation plan before writing any code. It accepts either free-form requirements or a PRD markdown file.

Run inline by default. Do not call the Task tool or any subagent by default. This keeps `/plan` usable from plugin installs that ship commands without agent files.

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
3. **Break down into phases** with specific, actionable steps
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

In PRD artifact mode, create `.claude/plans/` if needed. If the PRD contains a `Delivery Milestones` table, update only the selected row from `pending` to `in-progress` and set its `Plan` cell to the generated plan path. If the PRD uses the legacy `.claude/PRPs/prds/` format with `Implementation Phases`, read it without migrating paths.

## Pattern Grounding

Before writing the plan, search the codebase for conventions the implementation should mirror. Capture the top example for each relevant category with file references:

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
- Message the owner only for the CLAUDE.md stop conditions: `/santa-loop` escalations, device checkpoints, genuine scope/architecture decisions the docs don't answer, destructive/irreversible actions.

## Integration with the Bali Working Loop

After planning, follow CLAUDE.md's loop for EACH PR-sized step from the plan:

- Execute the step with its tests
- Verify: deterministic checks, then `/santa-loop` until NICE
- Ship: push, open the PR, enable auto-merge (squash), drive checks green
- Update `docs/PLAN.md` (rides the PR)
