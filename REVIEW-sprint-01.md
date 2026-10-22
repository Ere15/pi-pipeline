# REVIEW-sprint-01

Scope: `git diff master...sprint-01` (3 new files in `extensions/`, 678 lines).
`ADR-001` and `ROADMAP-01.md` are already on master (9c26066), so they are not in the diff. Read as context.

## 1. Test verdict
- **Modules load: PASS.** Copied to a temp dir, `.js` import specifiers rewritten to `.ts`, resolved against the pi 1.4.0 install, loaded with `node`. `pipeline.ts` registered `pipeline_route`, `pipeline_worktree_create`, `pipeline_dispatch`, `pipeline_check` and the `/sprint` command.
- **Imports match exports: PASS.** `jevGate` is exported from `jev-gate.ts`. `checkMessages`, `createWorktree` and `dispatchTask` are exported from `orca-shims.ts`. No missing or extra names.
- **Invented names: none in pi APIs.** Verified against the installed `.d.ts` files:
  - `Type`, `defineTool`, `ExtensionAPI`
  - `Classifier*` types and their answer shapes (`bool.probability`, `score.score/confidence`, `choice.choice/confidence`)
  - `findOfType("classifier", …)`, `classify`
  - the `execute(id, params, signal, onUpdate, ctx)` signature
  - `registerCommand`, `ctx.hasUI`, `ctx.ui.notify`
- **Orca CLI flags** were checked against `orca <verb> --help`. All used flags exist except `--retry-request` on `worktree create` and `terminal create` (see Must-fix 1).
- **Not verified:**
  - `tsc --noEmit` was not run. There is no `tsconfig.json` and no TypeScript in the environment.
  - `pi -e` was not run.
  - The ROADMAP stage 4 "smoke green" claim has no evidence: no smoke script is in the diff.
  - Assignability of `ModelRegistry` to `JevGateRegistry` is only structurally plausible.
- **Secrets: none** in the diff. The only grep hits are comments saying "no secrets".

## 2. Readability verdict
Good overall. The WHY comments are useful, the sections are small, and naming is consistent. Issues:
- `orca-shims.ts:264-289` — `replyToMessage({comment:true})` only changes the verb label used in error strings. The doc says it "marks the body as a comment for downstream threading", but nothing is sent to orca. The doc is misleading.
- `orca-shims.ts:189,210,232` — `pickString` fallbacks invent values: `dispatchId` falls back to `taskId`, `handle` to `"unknown"`, and worktree `id` to `name`. These mask a bad response.
- `pipeline.ts:42` — `signal ?? undefined` is redundant.
- ADR drift: the ADR says one `pipeline.ts` of about 250 lines and rejects splitting into files. The sprint shipped 3 files. This is reasonable, but the ADR isn't updated. The ADR also has the typo "arch(noul)" for bool.

## 3. Must-fix
1. `orca-shims.ts:182` (`createWorktree`) and `orca-shims.ts:203` (`createTerminal`) always append `--retry-request` through `runOrcaJson`. `orca worktree create --help` and `orca terminal create --help` don't list that flag (worktree has `--retry-launch`). The CLI may reject it with "unknown option", which `toShortError` maps to "invalid arguments", so both verbs could fail on every call. I did not run it, because creating a worktree or terminal mutates state. Fix: pass `idempotent=false` for these two verbs, or use `--retry-launch` for worktree. Then smoke one call.
2. `package.json` has no `extensions` key. ADR "Следствия" requires restoring `"extensions": ["./extensions/*.ts"]` in sprint-01. Without it the package install won't load the extension, and only `pi -e` works. Note: `pipeline.ts` is the only entry point; `jev-gate.ts` and `orca-shims.ts` are libraries. A glob would load them as extensions and fail, so list `./extensions/pipeline.ts` explicitly.
3. `pipeline.ts:139` — `console.log` in the `/sprint` handler writes to stdout inside the TUI. Use `ctx.ui.notify` when `hasUI`, and fall back to console only when there is no UI.
4. `orca-shims.ts:232,189` — drop the invented-id fallbacks. Return an error when the response lacks `dispatchId` or the worktree id.
5. Evidence gap: nothing shows `tsc --noEmit` or the smoke passing. ROADMAP stage 4 requires both. Run them, or record that they were not run.

## 4. Non-blocking
- `orca-shims.ts:156` — the child process ignores the tool `AbortSignal`, so cancel doesn't kill it.
- `checkMessages` with `waitMs > 60_000` gets killed by `DEFAULT_TIMEOUT_MS`, and the error text then says "retry with same retry-request id" even though `check` sends no id (lines 92-94).
- `pipeline_dispatch` and `pipeline_worktree_create` are mutating tools with no confirmation. Acceptable for a skeleton, but document it.
- No unit tests, which the ADR accepts for now.

## 5. Merge recommendation
**merge-after-fix** — fix Must-fix 1-5, then merge. The code is clean and every imported name exists. The blockers are one probable CLI-flag bug, the missing manifest key, and missing tsc/smoke evidence.
