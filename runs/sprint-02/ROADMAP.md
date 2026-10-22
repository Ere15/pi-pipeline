# ROADMAP.md — sprint-02 «dogfood»

## Цель

Применить pipeline к самому себе полностью через диспатч: mem0-хуки, unit-тесты,
recovery-матрица в коде extensions.

## Scope / non-goals

- In: `extensions/mem0.ts` (формат + redaction + инструменты remember/recall),
  `extensions/*.test.ts` (deno test: jev-gate caps/fallback, orca-shims parsing),
  recovery-политика в `orca-shims.ts` (ретраи, таймауты, structured errors).
- Out: виртуалка уже есть; публикация — после; полный tsc всего пакета (нет типов pi локально).

## Стадии

1. INTAKE — done (brief + 0 вопросов; бюджет-дефолт $10).
2. ARCH — `docs/arch/ADR-002-code-quality.md` (дизайн хуков, тест-стратегия, recovery).
   Гейт: координатор-frontier.
3. FAN-OUT × 3 (живой диспатч, reuse-терминалы):
   - T1/feat-mem0 — `extensions/mem0.ts` + 2 тула в wiring.
   - T2/feat-tests — `extensions/jev-gate.test.ts`, `orca-shims.test.ts` (deno test).
   - T3/feat-recovery — recovery в `orca-shims.ts` (попытки, бэкофф, structured errors).
4. INTEGRATION (deps T1–T3): staging, `deno test` + lint + node-smoke зелёные.
5. REVIEW (bridge/sonnet, read-only) → FIX → мерж в main → REPORT.

## Черновики спек

- T1: Target `extensions/mem0.ts` (+ правка wiring). Формат выжимки
  `sprint-N/<стадия>: решение → исход → где лежит`; redaction секретов
  (токены/ключи/пароли — паттерны + явный список); тулы возвращают готовый текст,
  данные — не инструкции. Acceptance: файл + wiring + пример in/out.
- T2: Target `extensions/*.test.ts`. Deno test, без pi-рантайма: caps/fallback гейта
  (моки registry), парсинг/маппинг ошибок шимов, redaction юнит. Acceptance: `deno test` зелёный.
- T3: Target `extensions/orca-shims.ts`. Конфигурируемые attempts/timeout/backoff,
  structured errors вместо invented-ID (урок ревью-01), таймауты на check.
  Acceptance: поведение + тесты рядом (координация с T2 через имена API из этого ROADMAP).

## Риски

- T2↔T3 стык по именам API: зафиксированы здесь (см. ниже), дрейф — в интеграцию как must-fix.
- Воркеры не коммитят: Acceptance везде включает коммит в ветке (урок sprint-01).
- API шимов (стабильно для T2/T3): `createWorktree/createTerminal/dispatchTask/checkMessages/replyToMessage/releaseWorker`
  возвращают `{ok, data?, error?}`; recovery добавляет `{attempts, timeoutMs}` в опции, не меняя имён.

## Assumptions

- Модели/уровни по таблице (ARCH opus, implement general/medium, review sonnet).
- mem0-доступ у воркеров — через их MCP (user-level memo? у них тот же `~/.pi/agent/mcp.json`
  — да, глобальный). Код хуков секреты не хранит.
