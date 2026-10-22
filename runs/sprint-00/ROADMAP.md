# ROADMAP.md — sprint-00 «скелет пакета»

## Цель

Дописать скелет pi-пакета: prompts, package.json, claude-bridge конфиг. Пробный спринт
ручного прогона: проверяем процесс, не код.

## Scope / non-goals

- In: `prompts/architect.md`, `prompts/implement.md`, `prompts/sprint-review.md`,
  `package.json` (pi-package манифест, имя `pi-pipeline`), `.pi/claude-bridge.json` (plan pro).
- Out: `extensions/pipeline.ts`, публикация в npm, тесты инфраструктуры, staging-ветка
  (док-спринт, слияние прямо в `master` после ревью — зафиксированное отступление).

## Стадии (упрощены под док-спринт)

1. INTAKE — done (brief + 2 вопроса, этот файл).
2. ARCH-лайт — полный ADR избыточен для доков; архитектура = этот ROADMAP + существующая
   ARCHITECTURE.md. Гейт: комплектность подтверждает координатор-frontier.
3. FAN-OUT × 2 (параллельно, max 3): A=prompts, B=package+bridge.
4. REVIEW (sonnet, read-only): REVIEW.md + must-fix.
5. FIX → мерж в `master` (координатор после зелени; зелень здесь = файлы на месте + валидный JSON).

## Задачи (черновики спек)

- **A/feat-prompts**: Target `prompts/`. Change: 3 тонкие обёртки поверх скиллов
  (`architect` → sprint-arch + outputs ADR; `implement` → implement-from-adr + evidence;
  `sprint-review` → sprint-review + REVIEW.md). Constraints: только `prompts/`,
  дублировать текст скиллов запрещено — только ссылки и stage-контекст.
  Acceptance: 3 файла существуют, каждый ссылается на свой скилл, упомянут evidence/формат выхода.
- **B/feat-package**: Target `package.json`, `.pi/claude-bridge.json`. Change: pi-манифест
  (extensions/skills/prompts пути, keyword `pi-package`, peerDeps хостовых пакетов),
  bridge-конфиг `{provider:{plan:pro}}`. Constraints: секретов нет, хостовые пакеты только в peerDeps.
  Acceptance: `node -e "JSON.parse(...)"` оба файла валидны; пути манифеста указывают на существующие файлы.

## Риски

- План pro vs будущий max: bridge-конфиг придётся поменять при смене плана — принято, одна строка.
- Имя `pi-pipeline` в npm может быть занято — проверить перед публикацией (не в этом спринте).

## Assumptions

- Недоспрошенное: стиль промптов — короткий императив; лицензия пакета — MIT (как у экосистемы).
- Параллельный запуск реальных pi-воркеров через диспатч тестируем в sprint-01;
  в sprint-00 диспатч имитируется координатором (worktree настоящие, исполнение — координатор).
