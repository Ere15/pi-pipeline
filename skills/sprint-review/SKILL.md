---
name: sprint-review
description: Read-only sprint review producing REVIEW.md with test verdict, readability verdict and must-fix list. Use for sprint reviews, code audits, pre-merge checks.
---

# Sprint review (READ-ONLY — no edits)

## Input

Diff `main...sprint-N` (or listed feat branches) + ADR set + test reports from implement Tasks.

## Required output: REVIEW.md

1. **Test verdict**: per area — tests exist? meaningful (not fake-green)? cover the change?
   Quote the evidence (command + result) or mark missing.
2. **Readability verdict**: per checklist —
   - names readable standalone; functions short; nesting flat
   - no stubs, TODO-without-issue, dead/commented code, `any`-holes
   - comments are WHY-only; complex spots explained
   - diff follows `AGENTS.md` conventions (cite the rule on mismatch → must-fix)
3. **Practices verdict (hard gates, each miss = must-fix)**:
   - no swallowed errors, no empty catches, no ignored failures; errors carry context
   - inputs validated at boundaries (API, CLI, parsers); no secrets in code or logs
   - public contracts unchanged or versioned; DB migrations forward-compatible/rolled-forward-safe
   - no new dependencies without a stated reason; no dead code
   - tests match the pyramid (unit on behaviour, integration on seams) + regression test per fix
3. **Must-fix list**: numbered, each with file:line links + why + suggested direction.
   No drive-by nits: trivial style goes to a separate notes section, not must-fix.
4. **Merge recommendation**: merge / merge-after-fix / rework, with reason.

## Rules

- No file edits. Findings are synthesised, fixes are dispatched, never done by the reviewer.
- A stated cause without checked evidence must be labelled UNVERIFIED.
- Severity is calibrated: blocks merge only what breaks behaviour, security, data, or readability contract.
