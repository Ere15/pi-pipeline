# ROADMAP.md — sprint-01 «pipeline.ts skeleton + живой диспатч»

## Цель

Скелет `extensions/pipeline.ts` (Jev-гейт + orca-обёртки) + первый настоящий диспатч
pi-воркеров через `worker-start --terminal`. Проверяем живую параллель, не имитацию.

## Scope / non-goals

- In: `extensions/pipeline.ts` (Jev-гейт, orca-шимы, регистрация 3–4 тулов + `/sprint`-заглушка),
  smoke-проверка, мерж в `master`.
- Out: virtual-модель `pipeline/auto`, полная recovery-матрица в коде, mem0-хуки,
  публикация. Staging — по процессу (feat → `sprint-01` staging → main).

## Стадии

1. INTAKE — done (brief + 0 вопросов, всё из sprint-00; этот файл).
2. ARCH-лайт — `docs/arch/ADR-001-pipeline-ts.md` (компоновка модуля, что отложено).
   Гейт: координатор-frontier.
3. FAN-OUT × 3 (параллельно, живые терминалы):
   - T1/feat-pipe-jev — Jev-гейт: classify через `opencode/jev-1.13`, route + confidence + бюджетные капы.
   - T2/feat-pipe-orca — orca-шимы: `worktree/terminal/dispatch/check/reply/release` поверх `orca --json`, парсинг, retry-request.
   - T3/feat-pipe-wire — wiring: регистрация тулов + `/sprint`-заглушка + smoke (импорт без старта pi).
4. INTEGRATION (deps на T1–T3): слияние в `sprint-01` staging, `tsc --noEmit` + smoke зелёные.
5. REVIEW (bridge/sonnet, read-only) → FIX → мерж в main → REPORT.

## Черновики спек (полные — в диспатче)

- T1: Target `extensions/pipeline.ts` (секция jevGate). Constraints: только чтение
  `ctx.modelRegistry`, ключ не трогать (наследуется), секреты в логи запрещены.
  Acceptance: `route({title,body,files}) → {route, confidence, decidedBy}` + капы.
- T2: Target `extensions/pipeline.ts` (секция orca). Constraints: только spawn `orca --json`,
  сырой stderr наружу не отдавать — понятный текст модели. Acceptance: функции на все 6 глаголов + парсинг.
- T3: Target `extensions/pipeline.ts` (wiring) + smoke. Acceptance: `pi -e` грузит без ошибок,
  тулы видны, smoke зелёный.

## Риски (первый живой диспатч)

- Воркер может не соблюсти worker_done-формат → спека включает точный шаблон done + пример.
- Промпт-инжект в терминале vs преамбула orca → Constraints: преамбула первична, конфликт — question.
- Параллельные `pi` жрут CPU → cap 3 соблюдён ровно тремя задачами.

## Assumptions

- Скиллы pipeline не установлены глобально → спека даёт путь к SKILL.md в главном чекауте,
  воркер читает read-инструментом.
- Сессии воркеров именуем `sprint-01/<t>`; модель старта — general/medium.
