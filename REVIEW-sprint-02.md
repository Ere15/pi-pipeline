# REVIEW sprint-02 (master...sprint-02)

Reviewed: `git diff master...sprint-02`. Note: `ADR-002` and `ROADMAP.md` are not in the diff (already on master); read as spec only.
Ran: `deno test --allow-all extensions/` → 41/41; `deno lint extensions/` clean; `deno check --sloppy-imports extensions/pipeline.ts` → **3 type errors**.

## 1. Test verdict — tests pass, but T2↔T3 drift is NOT fully closed
- Structured errors: tests match the new code (`.code` / `.detail` / `retryable` asserted via `OrcaError`). 41/41 green with the permission flags.
- **Bare `deno test extensions/` (the command ADR-002 §Следствия prescribes) fails: 27/41** ("Can't escalate parent thread permissions"). Needs `--allow-env --allow-run --allow-read --allow-write` (documented only in the test header). ADR/CI command is wrong.
- **New recovery behavior is untested in the committed suite.** `attempts`, `backoffMs`, `backoffDelayMs`, `ORCA_ABORTED`/`signal`, `ORCA_TRANSPORT`/`ORCA_EMPTY_RESPONSE` codes, `check` timeout grace, `formatOrcaError` — no test references them (grep: zero hits). T3's 19 checks live in `/tmp/verify/recovery.check.ts` and only a log was committed (`runs/sprint-02/T3-recovery-evidence.log`). T2 tests were only mechanically realigned to the new error shape.
- Misleading/stale titles: `orca-shims.test.ts:168` "retries … under the same retry-request id" asserts only call count (no id check, and createWorktree sends none); `:276` "retries … once" — default is now 3 attempts.
- mem0: redaction examples are inline (`checkRedactionExamples`) but nothing in `*.test.ts` runs them → not executed by `deno test`. `buildRecallQuery`/`formatStageSummary` untested.

## 2. Readability verdict — good
Consistent WHY-comments, small functions, fixed error-code union, clear module headers. Nits: `mem0.ts` ships test fixtures (`REDACTION_EXAMPLES`, `checkRedactionExamples`) in production code; `OrcaResult` error repeated as inline object literals in `parseJsonEnvelope` (use `fail()`/a helper); `formatOrcaError` is exported but unused.

## 3. Must-fix
1. `extensions/pipeline.ts:78, 98, 123` — `result.error` is now an `OrcaError` object but is used as the `text` string (`const text = result.ok ? JSON.stringify(result.data) : result.error;`). Type-check fails (TS2322) and the model would get `[object Object]`/invalid content. Use `formatOrcaError(result.error)` (or `JSON.stringify(result.error)` so `code`/`retryable` reach the model — preferred, that's the point of structured errors). T3 only verified `orca-shims.ts` in isolation, so integration missed it.
2. `extensions/orca-shims.ts:307` — regression: old code retried only when `retryRequest !== undefined`; now `createWorktree`/`createTerminal` (non-idempotent, no `--retry-request`, see `:285`) retry on timeout/transport loss, up to 3×, with no dedup → duplicate worktrees/terminals. Fix: `if (!lastError.retryable || retryRequest === undefined) break;`. Then fix test `:168` accordingly (expect 1 call for worktree create on lost reply).
3. Add committed tests for the new recovery behavior (at minimum: retry count = `attempts`, same id across attempts, `backoffDelayMs` values + cap, abort → `ORCA_ABORTED` without retry, `attempts: 1`, missing-id cases for `ORCA_BAD_RESPONSE`). Port from `/tmp/verify/recovery.check.ts`.
4. Fix the documented test command (ADR-002 §Следствия) to include the `--allow-*` flags, or `deno.json` task; wire `checkRedactionExamples()` into a `mem0.test.ts`.

## 4. Merge recommendation: **merge-after-fix**
Design and code quality are sound; blockers are the pipeline.ts type break (1), the idempotency regression (2), and missing recovery tests (3). Small, mechanical fixes.
