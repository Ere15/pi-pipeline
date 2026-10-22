---
name: implement-from-adr
description: Implement a task from an ADR with tests, lint and typecheck green. Use when implementing sprint tasks, features or fixes from architecture specs.
---

# Implement from ADR

## Before writing

Read the ADR section for this task + repo `AGENTS.md` (source of truth for conventions).
If ADR and `AGENTS.md` conflict, stop and ask — do not guess.

## While writing (human-readable code)

- Small functions, flat nesting, names readable without call context.
- No stubs, no TODO-instead-of-code, no dead or commented-out code, no `any`-holes.
- Comments explain WHY, never restate WHAT. Magic gets a reason or gets removed.
- Follow repo conventions exactly (imports, errors, logging, config).
- Tests are behaviour documentation: name cases as observable behaviour.

## Before reporting done (mandatory evidence)

```text
pnpm test <scope>  → green, N passed (paste tail)
lint               → clean
typecheck          → clean
files-modified: [...]
report-path: <where full log lives>
spent: <токены/$, для бюджета спринта>
```

`worker_done` without this evidence is rejected. Third identical failure in a row →
stop and propose a new hypothesis instead of retrying.

## Boundaries

- Edit only your worktree and your Task Target. чужое не трогать.
- Large or duplicate tool output: excerpt + saved full copy, do not flood context.
