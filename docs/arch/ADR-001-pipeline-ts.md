# ADR-001: компоновка extensions/pipeline.ts (skeleton, sprint-01)

## Контекст

Нужен исполняемый слой pipeline: Jev-гейт + вызовы orca + тулы координатора.
Статус: skeleton, не prod.

## Решение

Один файл `extensions/pipeline.ts` (~250 строк), три секции:

1. **jevGate** — `classify()` через `ctx.modelRegistry.findOfType("classifier", "opencode", "jev-1.13")`,
   вопросы arch(noul)/risk(score)/owner(choice); возврат `{route, confidence, decidedBy}`;
   капы `maxRequests`/`maxUsdPerDay`; недоступность → fallback default + пометка.
2. **orca shims** — запуск `orca --json` дочерним процессом, парсинг, `retry-request` повторы;
   ошибки → короткий текст модели (не stderr). Покрыть 6 глаголов: worktree, terminal,
   dispatch, check, reply, release (+ comment).
3. **wiring** — регистрация тулов `pipeline_*` + команда `/sprint`-заглушка (печатает стадии).

## Отброшено

- Разбивка на файлы: рано, один файл проще ревьювить на skeleton-стадии.
- Виртуальная модель `pipeline/auto`: после стабилизации гейта (sprint-02+).
- Полная recovery-матрица в коде: только счастливая тропа + явные ошибки наружу.
- mem0-хуки: после появления MCP-доступа у координатора.

## Следствия

- `extensions/` появляется в репо → вернуть `extensions`-ключ в package.json (sprint-01, FIX или мерж).
- Тесты: только smoke (импорт/регистрация); unit — позже.
- Как тестировать: `tsc --noEmit` + загрузка через `pi -e` + ручной прогон гейта в playground.
