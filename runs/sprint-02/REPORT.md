# REPORT — sprint-02 «dogfood»

## Цель

Pipeline на самом себе полностью через диспатч: mem0-хуки, unit-тесты, recovery в коде.

## По задачам

- **T1/feat-mem0**: `extensions/mem0.ts` (formatStageSummary, redactSecrets, deny-list)
  + `pipeline_remember/recall` в wiring + `mem0.test.ts` (7/7, FIX item 4b) — done.
- **T2/feat-tests**: `jev-gate.test.ts` + `orca-shims.test.ts`, финал 64/64
  (41 → +recovery tests через follow-up после ребейза) — done.
- **T3/feat-recovery**: attempts/timeout/backoff, structured errors, abort-aware check — done.
- **FIX-волна**: items 1 (координатор, formatOrcaError), 2 (T3, id-gated retry),
  3 (T2 через follow-up после ребейза), 4a (ADR test command — в отчёте ниже), 4b (T1).

## REVIEW (bridge/sonnet, read-only)

Вердикт **merge-after-fix**, 4 must-fix — включая настоящий баг дубликатов (retry create
без id) и рассинхрон `result.error`-как-строка. Все закрыты и верифицированы:
id-gate в коде (:311), formatOrcaError ×3, тесты 64/64, lint чист.

## Зелень интеграции

- `deno test --allow-env --allow-run --allow-read --allow-write extensions/`: 64/64
- `deno lint extensions/`: clean; `tsc` (orca-shims): exit 0
- node-import smoke: shims 11 exports, jevGate function, mem0 7 exports

## Траты vs стоп-кран $10

Implement ×3 + fix ×4 (2 follow-up как reuse, без новых терминалов) на opencode-go
+ 1 ревью Sonnet через bridge. Внутри лимита.

## Уроки (дополняют sprint-01)

1. **Параллельное владение одним файлом рвётся**: T2-тесты vs T3-код — дрейф строк;
   чинить на интеграции дорого. Правило: общий файл — общий владелец, остальных
  _warn_ в спеке; либо freeze API до волны (как было с именами — сработало).
2. **Rebase воркера — работа координатора**: слияние fix-ветки в worktree + follow-up
   диспатч на тот же терминал (протокол сработал: question → reply → stand-down → rebase → done).
3. **Конфликт add/add при слиянии fix-веток**: резолвить стороной review-approved
   направления (сюда — recovery-side), проверять тестами сразу.
4. **Worker_done без reportPath** (T1): принимать, но требовать files+evidence;
   reportPath — SHOULD, не MUST (смягчить шаблон? оставлено как есть + пометка).
5. **ADR test command**: каноном записан полный `deno test --allow-...` (item 4a закрыт докой).
6. **deno check на весь пакет** требует типов pi (их нет локально) — evidence остаётся:
   tsc чистых модулей + deno check с известными `.js`-строгостями + lint + тесты.

## Ссылки

- ADR-002, ROADMAP-02, REVIEW-sprint-02, ветки `Ere15/feat-mem0|tests|recovery` (смержены, удалены).
- Run: `run_a8000e7d31d4`. Диспатчи (все released): ctx_4a65, ctx_7174, ctx_45eb, ctx_84bf, ctx_e091, ctx_d863.
- Установки за спринт: нет.
- mem0-remember: 502 дважды в день спринта (upstream LLM сервиса), зафлашено позже — verified чтением. Урок: remember — с ретраем и бэкоффом, тихий пропуск запрещён.
