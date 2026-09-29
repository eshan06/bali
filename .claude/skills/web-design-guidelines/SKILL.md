---
name: web-design-guidelines
description: 'Bali: the portal''s UI only (apps/web/src/app, apps/web/src/components). Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".'
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

> **Bali, read this first.** Copied from vercel-labs/agent-skills@063bee94c3f4df8453406c830b0a7df0f2860278, `skills/web-design-guidelines/SKILL.md` (MIT), with its rules from vercel-labs/web-interface-guidelines@e3d624baaf29dc1fc645aff3e38f03e564d2d6b1, `command.md`, copied unchanged as `rules.md` (MIT, `LICENSE` beside this file). This block, the `description` line and the rules' source (a pinned local copy, not a live fetch) differ from upstream.
>
> - **Scope: the portal's UI only** (`apps/web/src/app`, `apps/web/src/components`). These are web rules: the app and the shield are checked against DESIGN.md instead, and the API, `packages/` and `apps/web/src/lib` not at all.
> - **`docs/DESIGN.md` wins.** Bali's tokens, type, motion budget, state colours and voice hold wherever this skill says otherwise; changing DESIGN.md is the owner's call, made on a design canvas.
> - **Never restyle an approved screen on this skill's say-so.** A redesign is a planned design step with the owner's sign-off (`docs/PLAN.md`).
> - **CLAUDE.md still rules:** no new dependency (animation library, font, icon set, component kit) without a plan step that names it; every error path says something honest with a way to retry; tests and every CI gate as always.
> - **Pinned, never fetched.** Read `rules.md` beside this file; do not fetch the live URL. Updating the rules is a PR that copies a newer `command.md` in.
> - **Bali overrides `rules.md`:** headings and buttons in sentence case, not Title Case (DESIGN.md's voice); em-dashes as DESIGN.md says; a specific label beats "Continue" unless DESIGN.md's screen names it.
> - **In `/santa-loop` its findings are WARNs, never blockers.** Fix the easy ones in the same PR; list the rest in the PR description.

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Read the guidelines in `rules.md`, beside this file
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in the guidelines
4. Output findings in the terse `file:line` format

## Guidelines Source

`rules.md`, beside this file: a pinned copy of

```
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

It contains all the rules and output format instructions.

## Usage

When a user provides a file or pattern argument:
1. Read the guidelines in `rules.md`
2. Read the specified files
3. Apply all rules from the guidelines
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.
