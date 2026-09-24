---
description: Adversarial dual-review loop — two independent reviewers, only proven problems block, up to 2 rounds (docs-only changes skip it).
---

# Santa Loop

Two independent reviewers — different models, no shared context — review the change before it ships. Only **proven problems** block: a finding has to fit the BLOCKER rules and survive a check before anyone changes code for it. Easy style notes get fixed on the way without costing a round. Code gets up to 2 rounds; round 2 checks only the fixes and any dismissals.

These rules override the santa-method skill's generic defaults (3 rounds, fix every flagged issue, full re-review each round).

## Usage

```
/santa-loop [description of the change]
```

## Workflow

### Step 0: Scope and size

The scope is everything this branch changes against `main`. Commit work in progress first, then:

```bash
git fetch -q origin
git diff --stat origin/main...HEAD
```

- **Docs-only** (every change is Markdown or a comment, and none touches the rules — `CLAUDE.md`, `.claude/`, `docs/ARCHITECTURE.md`): skip the review and go to Step 5. The GitHub Claude Review still gates the PR. A change to the rules always gets both reviewers, so they can't be loosened past a single one.
- **Size:** count changed lines, not counting tests, Markdown, the lockfile or generated migrations:

  ```bash
  git diff --numstat origin/main...HEAD -- . ':!*.md' ':!*.test.*' ':!*/test/*' ':!*Tests/*' ':!package-lock.json' ':!packages/db/migrations/*' | awk '{s += $1 + $2} END {print s + 0}'
  ```

  Over ~400: don't review yet. A worker pushes its branch and reports back to the conductor with a proposed split; the conductor decides — re-plan the step into smaller ones, or send the worker on as one PR with the reason in the PR description. A session working without a plan makes that call itself: split, or carry on with the reason in the PR description.

### Step 1: The blocking rules — one source

What blocks is defined in one place: the reviewer prompt in `.github/workflows/claude-review.yml`. Give both reviewers its rules verbatim — the text from "Judge the diff against the repository's own rules" through "do NOT demand work outside this PR's scope", plus its "BLOCKER is reserved for: …" line — but not its instructions for writing `claude-review.md`: reviewers here answer in the Step 2 format and write no files. Don't add criteria here — santa must never be stricter than the final gate. Changing the rules means editing that workflow, which is an owner decision (see GOTCHAS).

### Step 2: Dual independent review

Launch both reviewers **in parallel** (one message, two tool uses). Each gets:

- the rules from Step 1, verbatim
- the diff (`git diff origin/main...HEAD`), not whole files — reviewers open files themselves when they need context
- this instruction: "You are an independent reviewer and have NOT seen any other review. Report a BLOCKER only if it fits the rules and you can cite the file:line and a concrete failure: this input or state → this wrong result. Everything else is a WARN. Zero findings is a normal, common result — do not manufacture findings."
- this output format:

```json
{
  "blockers": [
    { "file": "...", "line": 0, "rule": "...", "failure": "input/state → wrong result" }
  ],
  "warns": ["file:line — note"]
}
```

#### Reviewer A: Claude (always runs)

An Agent with `subagent_type: code-reviewer` and `model: opus`.

#### Reviewer B: external model (Claude fallback only if no external CLI is installed)

Detect which CLIs are available:

```bash
command -v codex >/dev/null 2>&1 && echo "codex" || true
command -v gemini >/dev/null 2>&1 && echo "gemini" || true
```

Write the same prompt Reviewer A gets to a unique temp file:

```bash
PROMPT_FILE=$(mktemp /tmp/santa-reviewer-b-XXXXXX.txt)
cat > "$PROMPT_FILE" << 'EOF'
... rules + diff + instruction + output format ...
EOF
```

Use the first available CLI:

**Codex CLI** (if installed)

```bash
codex exec --sandbox read-only -m gpt-5.4 -C "$(pwd)" - < "$PROMPT_FILE"
rm -f "$PROMPT_FILE"
```

**Gemini CLI** (if installed and codex is not)

```bash
gemini -p "$(cat "$PROMPT_FILE")" -m gemini-2.5-pro
rm -f "$PROMPT_FILE"
```

**Claude fallback** (neither CLI installed): a second Agent with `subagent_type: code-reviewer` and `model: opus`. Say in the report that both reviewers share a model family — context isolation still holds, model diversity doesn't.

### Step 3: Verdict

- **No blockers** from either reviewer → **NICE**: fix the easy WARNs (Step 4, item 3), then go to Step 5.
- **Any blocker** → Step 4.

### Step 4: Check, then fix

1. Merge and dedupe both reviewers' blockers.
2. **Check each blocker before changing code.** Re-read the cited lines and their callers. For a logic or race bug, write the failing test first — CLAUDE.md's regression-test-first rule.
   - The test fails → it's real: fix it.
   - You can't make it fail, or the code already handles it → **dismissed**: one line for the PR description, `dismissed: <finding> — <why>`.
   - A race that only the real-Postgres lane can show (`TEST_DATABASE_URL` unset here) is never dismissed for not reproducing locally: write the race test, fix the code if the reasoning holds, and let CI's real-Postgres lane decide.
   - Missing tests → add them. A rule break → confirm the rule in CLAUDE.md or ARCHITECTURE.md, then fix it.
3. **WARNs:** fix the easy ones now — a rename, a stray log, a comment, a small cleanup. They never start another round. One that needs a real rewrite goes in the PR description instead. Never open a follow-up PR just for WARNs.
4. Commit: `fix: address santa-loop review findings (round N)`.
5. **Round 2** — whenever round 1 had blockers, fixed or dismissed. Fresh reviewers get the fix diff (`git diff <round-1 head>..HEAD`), the round-1 list (fixed, dismissed and why) and two questions: did the fixes work without breaking anything, and does each dismissal hold up? A dismissal they reject gets fixed now — or the step is parked if you still can't pin the failure down. They don't re-raise anything else from round 1. Round-2 blockers get the same check-then-fix. There is no round 3 — the GitHub Claude Review checks the final code.
6. **Park** only when a real blocker can't be fixed within this step or needs an owner decision: push, open the PR as a **draft** that lists it, leave auto-merge off, and report the step as parked.

### Step 5: Push

```bash
git push -u origin HEAD
```

Then carry on with CLAUDE.md's ship step. When there are any, the PR description gets a **Review notes** section: dismissed findings and WARNs left undone, one line each.

### Step 6: Report

```
SANTA VERDICT: NICE / SKIPPED (docs-only) / PARKED

Reviewer A (Claude Opus):   [n] blockers · [m] warns
Reviewer B ([model used]):  [n] blockers · [m] warns

Blockers:  [x] fixed · [y] dismissed (reasons in the PR)
WARNs:     [a] fixed · [b] listed in the PR
Rounds:    [N]/2
```

## Notes

- Reviewer A (Claude Opus) always runs, so there is always one strong reviewer. Reviewer B's different model (GPT-5.4 or Gemini 2.5 Pro) brings different blind spots; the Claude-only fallback keeps context isolation but loses that.
- External reviewers run read-only (`--sandbox read-only` for Codex).
- Fresh reviewers each round keep them from anchoring on earlier findings; round 2's narrow scope keeps them off code that's already settled.
- Fixes are committed each round, so an interrupted loop keeps them.
- Reviewers flagging style as blockers, or rubber-stamping? Fix the rules in `claude-review.yml`, never a santa-only rubric.
