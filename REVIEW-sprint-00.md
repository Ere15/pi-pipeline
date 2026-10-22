# REVIEW — sprint-00 «скелет пакета»

Diff: `master...Ere15/feat-prompts` (3 files, +30), `master...Ere15/feat-package` (2 files, +29). Read-only review.

## 1. Test verdict

Sprint "green" = files exist + valid JSON (ROADMAP stage 5). Checked from branch contents via `git show`.

| Check | Result |
|---|---|
| `prompts/architect.md`, `implement.md`, `sprint-review.md` exist | PASS |
| `package.json`, `.pi/claude-bridge.json` exist | PASS |
| `package.json` valid JSON (`python -m json.tool`) | PASS |
| `.pi/claude-bridge.json` valid JSON | PASS |
| Each prompt references its skill (`/skill:sprint-arch`, `/skill:implement-from-adr`, `/skill:sprint-review`) | PASS — all three skills exist in `skills/` |
| Evidence / output format mentioned | PASS (implement: evidence; architect: ADR path; review: REVIEW.md) |
| `bridge` = `{provider:{plan:pro}}` per spec | PARTIAL — plan is `pro`, but extra keys added (see must-fix 2) |
| Manifest paths point to existing files (task B acceptance) | FAIL for `extensions` — `./extensions/*.ts` matches nothing; `extensions/` doesn't exist on either branch. `skills/*` and `prompts/*.md` resolve. |

No real tests exist; this is a doc sprint, so the verdict rests on file and JSON checks only. Not verified: that `@earendil-works/*` peer package names and the `askClaude` keys are real. They can't be checked from this repo (UNVERIFIED).

## 2. Readability verdict

- Prompts: short (9–11 lines), no stubs, consistent structure (title, skill link, "Правила стадии"), Russian imperative style as in the ROADMAP assumption. Good.
- Constraint breach (minor): ROADMAP forbids duplicating skill text, only links and stage context. The prompts restate skill rules:
  - `prompts/implement.md:6-8` — the evidence list and the "third identical failure" rule are copied from `skills/implement-from-adr/SKILL.md:21-33`.
  - `prompts/sprint-review.md:4-8` — the output list and the UNVERIFIED rule are copied from `skills/sprint-review/SKILL.md`.
  - `prompts/architect.md:3-4` and `:6` — the ADR output and the `docs/arch/`-only rule are copied from the skill.
  Duplicates will drift. Acceptable for sprint-00, since acceptance asks for evidence to be mentioned. Trim to one-line pointers later.
- `prompts/implement.md` omits `spent:` (tokens/$), which the skill requires, so the duplicate is already incomplete. It says "токены/стоимость", so this is a wording gap only.
- `package.json`: minimal and clean, with `pi-package` keyword, MIT, and host packages only in `peerDependencies` per the constraint. Peer ranges `"*"` are loose but acceptable at 0.1.0.
- No secrets in either file.

## 3. Must-fix

1. `package.json:8` — `"extensions": ["./extensions/*.ts"]` points at a nonexistent directory, which fails task B acceptance. Either:
   - keep it and note in the merge message that `extensions/pipeline.ts` lands in a later sprint (it's explicitly Out of scope), or
   - drop the key until the file exists.

   Coordinator's call; the glob matching nothing could also break the pi loader (UNVERIFIED).
2. `.pi/claude-bridge.json:3-6` — the `askClaude` block (`enabled`, `allowFullMode: true`, `defaultIsolated: false`) is outside spec (`{provider:{plan:pro}}`). It turns on full-mode access with isolation off, which is a permissive security default nobody requested. Remove the block, or get explicit sign-off and record it in the ROADMAP.

Nit, not blocking: `prompts/implement.md:6` — add `spent` to the evidence list, or replace the list with a pointer to the skill.

## 4. Merge recommendation

**merge-after-fix**

- `feat-prompts`: merge as-is. Duplication is a nit.
- `feat-package`: merge after must-fix 1 and 2.

The must-fix list is non-empty, so per the sprint-review gate it goes to the FIX wave.
