# ADR-002: качество кода pipeline (sprint-02)

## Контекст

Skeleton работает, но: память — руками, тестов нет, recovery — только счастливая тропа.
Закрываем троечкой, не раздувая API.

## Решение

1. **mem0-хуки (`extensions/mem0.ts`)**: чистые функции `formatStageSummary()` +
   `redactSecrets()` + два тула `pipeline_remember` / `pipeline_recall`, возвращающие
   готовый текст для MCP-вызовов `mem0_add` / `mem0_search` (модель делает вызов,
   тулы — только форматируют; тулы не зовут тулы). Секреты: паттерны
   (api/key/token/password/secret + длинные base64/hex) плюс явный deny-list.
2. **Тесты (deno test, без pi-рантайма)**: `jev-gate.test.ts` — caps/fallback/degraded-ветки
   на моке registry; `orca-shims.test.ts` — парсинг ответов и маппинг ошибок;
   redaction-юниты рядом с mem0. Раннер — deno (уже в окружении), `deno test extensions/`.
3. **Recovery в `orca-shims.ts`**: опции `{attempts, timeoutMs, backoffMs}` с дефолтами
   (3 / 120s / exponential), structured errors `{code, retryable, detail}` вместо
   выдуманных ID (урок ревью-01). Имена API не меняются (см. ROADMAP-02).

## Отброшено

- Прямые HTTP-вызовы mem0 из расширения (дублировали бы MCP-мост; единый доступ — через MCP).
- Vitest/jest (лишний тулчейн; deno test покрывает чистые модули).
- Полный tsc пакета (нет локальных типов pi; остаются tsc на чистых модулях + deno check).

## Следствия

- Как тестировать: `deno test extensions/` + `deno lint` + node-import smoke (INTEGRATION-гейт).
- Калибровка Jev не затрагивается (пороги 0.7/1.5 подтверждены v1).
