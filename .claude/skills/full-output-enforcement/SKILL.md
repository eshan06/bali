---
name: full-output-enforcement
description: 'Bali: user-facing UI deliverables only. Overrides default LLM truncation behavior. Enforces complete code generation, bans placeholder patterns, and handles token-limit splits cleanly. Apply to any task requiring exhaustive, unabridged output.'
---

> **Bali, read this first.** Copied from Leonxlnx/taste-skill@ce26fc25c0e5e8cab638f883de62d9a86ee5e45b, `skills/output-skill/SKILL.md` (MIT, `LICENSE` beside this file). Only this block and the `description` line differ from upstream.
>
> - **Scope: user-facing UI only: the portal's pages and components (`apps/web/src/app`, `apps/web/src/components`), the student app's screens (`ios/Bali/UI`), the shield (`ios/BaliShield`) and a future demo site. Never the API, `packages/`, `apps/web/src/lib` or the iOS engine and outbox.**
> - **`docs/DESIGN.md` wins.** Bali's tokens, type, motion budget, state colours and voice hold wherever this skill says otherwise; changing DESIGN.md is the owner's call, made on a design canvas.
> - **Never restyle an approved screen on this skill's say-so.** A redesign is a planned design step with the owner's sign-off (`docs/PLAN.md`).
> - **CLAUDE.md still rules:** no new dependency (animation library, font, icon set, component kit) without a plan step that names it; every error path says something honest with a way to retry; tests and every CI gate as always.
> - **Never pause for "continue".** A worker has no one to answer: finish the step, or split it as the plan says (a step over ~400 changed lines is split). Its "do not optimize for brevity" means complete, not large; Ponytail's minimalism still shapes the code.

# Full-Output Enforcement

## Baseline

Treat every task as production-critical. A partial output is a broken output. Do not optimize for brevity — optimize for completeness. If the user asks for a full file, deliver the full file. If the user asks for 5 components, deliver 5 components. No exceptions.

## Banned Output Patterns

The following patterns are hard failures. Never produce them:

**In code blocks:** `// ...`, `// rest of code`, `// implement here`, `// TODO`, `/* ... */`, `// similar to above`, `// continue pattern`, `// add more as needed`, bare `...` standing in for omitted code

**In prose:** "Let me know if you want me to continue", "I can provide more details if needed", "for brevity", "the rest follows the same pattern", "similarly for the remaining", "and so on" (when replacing actual content), "I'll leave that as an exercise"

**Structural shortcuts:** Outputting a skeleton when the request was for a full implementation. Showing the first and last section while skipping the middle. Replacing repeated logic with one example and a description. Describing what code should do instead of writing it.

## Execution Process

1. **Scope** — Read the full request. Count how many distinct deliverables are expected (files, functions, sections, answers). Lock that number.
2. **Build** — Generate every deliverable completely. No partial drafts, no "you can extend this later."
3. **Cross-check** — Before output, re-read the original request. Compare your deliverable count against the scope count. If anything is missing, add it before responding.

## Handling Long Outputs

When a response approaches the token limit:

- Do not compress remaining sections to squeeze them in.
- Do not skip ahead to a conclusion.
- Write at full quality up to a clean breakpoint (end of a function, end of a file, end of a section).
- End with:

```
[PAUSED — X of Y complete. Send "continue" to resume from: next section name]
```

On "continue", pick up exactly where you stopped. No recap, no repetition.

## Quick Check

Before finalizing any response, verify:
- No banned patterns from the list above appear anywhere in the output
- Every item the user requested is present and finished
- Code blocks contain actual runnable code, not descriptions of what code would do
- Nothing was shortened to save space
