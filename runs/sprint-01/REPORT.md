# REPORT — sprint-01 «pipeline.ts skeleton + живой диспатч»

## Цель

Скелет `extensions/pipeline.ts` + первый настоящий диспатч pi-воркеров
(параллельная волна, reuse терминалов, review, fix, мерж).

## По задачам

- **T1/feat-pipe-jev** (general): `extensions/jev-gate.ts` (218 строк, jevGate + типы + капы) — done.
  Evidence: deno check/lint clean у воркера; node-import в интеграции: `JEV_OK:function`.
- **T2/feat-pipe-orca** (general): `extensions/orca-shims.ts` (317 строк, 6 функций + типы,
  живой smoke против настоящего orca) — done. Evidence: node-import `SHIMS_OK:6`.
- **T3/feat-pipe-wire** (general, после T1+T2): `extensions/pipeline.ts`
  (4 тула + `/sprint`-заглушка, jiti-smoke обеих веток notify/headless) — done.
- **FIX-волна** (reuse тех же терминалов): items 1+4 (T2), item 3 (T3), item 2 (координатор),
  lint-мелочь (координатор). Все 5 must-fix закрыты.

## REVIEW (bridge/sonnet, read-only)

Вердикт **merge-after-fix**, 5 must-fix — все по делу (неподдержанный флаг,
пустой glob, console.log в TUI, выдуманные fallback-ID, нет evidence tsc/smoke).
Второй круг ревью не гоняли: фиксы верифицировал координатор (diff + lint + smoke).

## Траты vs стоп-кран $10

- Implement ×3 + fix ×2 на opencode-go (подписка) + 1 ревью Sonnet через bridge. Внутри лимита.
- Прямой anthropic по-прежнему мёртв без Extra Usage — frontier = bridge (в доки внесено).

## Отклонения и уроки живого диспатча (внесены в PIPELINE.md)

1. **Воркеры не коммитят.** Дважды файлы висели untracked. Acceptance дополнен:
   «закоммить в ветке worktree» — обязательно, иначе done неполный.
2. **`terminal create --command "pi"` не выживает**: процесс умирает, handle stales,
   рантайм подменяет шеллом. Рабочий путь: `terminal create` (шелл) → `terminal send "pi …"`
   → дождаться TUI → `worker-start --terminal`. (PIPELINE.md обновлён.)
3. **Stale handles**: после протухания — только re-list и замена, никаких повторов со старым.
4. **Явный `--worktree` при reuse** обязателен, иначе `terminal_worktree_mismatch`.
5. **Свежий Run на спринт**: переиспользование чужого Run даёт mismatch — `run-create` в шаге 0.
6. **Ack-дисциплина**: парсить ответы аккуратно; непо consommation может прятать доставки
   (один done чуть не потеряли в клиентском парсинге — серверную сторону проверять `worker-list`).
7. **ADR-001 amended**: три модуля вместо одного файла (параллельное владение);
   сборка — в `pipeline.ts` импортами-сиблингами, интеграция сводит в один `extensions/`.
8. **tsc отсутствует** в окружении; evidence уровня: node-import smoke + deno lint clean.
   `deno check` требует `@types/node` (нет node_modules) — pending до появления тулчейна.
9. **package.json**: ключ `extensions` возвращён как явный `./extensions/pipeline.ts` (не glob).

## Ссылки

- ADR-001, ROADMAP-01, REVIEW-sprint-01, ветки `Ere15/feat-pipe-*` (смержены, worktree удалены).
- Run: `run_6e0b181f493e`. Диспатчи (все released): ctx_20cd, ctx_2ea1, ctx_828f, ctx_1194, ctx_98a0.
- Установки за спринт: нет новых (bridge — из sprint-00).
- mem0-выжимка: pending (нет MCP-доступа у координатора).
