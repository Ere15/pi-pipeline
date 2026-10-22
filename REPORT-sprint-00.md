# REPORT — sprint-00 «скелет пакета» (ручной прогон)

## Цель

Проверить процесс pipeline на мелком настоящем спринте: prompts + package.json + bridge-конфиг.

## По задачам

- **A/feat-prompts** (general): `prompts/{architect,implement,sprint-review}.md` — done.
  Evidence: 3 файла, каждый ссылается на свой скилл; закоммичено, смержено в master.
- **B/feat-package** (general): `package.json` (валидный JSON, keyword `pi-package`,
  хостовые пакеты в peerDeps) + `.pi/claude-bridge.json` (`{provider:{plan:pro}}`) — done после FIX.
  Evidence: `node JSON.parse` оба файла; закоммичено, смержено в master.

## REVIEW (frontier)

- Прямой `anthropic/*` по OAuth — стена: Extra Usage исчерпан
  (`Third-party apps now draw from your extra usage`). Вывод для архитектуры:
  прямой anthropic в pi — только при пополненном Extra Usage; рабочий frontier — `claude-bridge`.
- Ревью через `claude-bridge/claude-sonnet-5-5` (квота подписки Pro): вердикт **merge-after-fix**,
  2 must-fix по делу (extensions-glob в никуда; askClaude-блок сверх спека) + 1 неточный
  (spent уже был в промпте — отклонён координатором обоснованно).
- Установлен `pi-claude-bridge` глобально (нужен frontier-пулу bifrost).

## Траты vs стоп-кран $10

- Frontier: 1 ревью-вызов Sonnet через bridge (копейки) + 1 неуспешный OAuth-вызов ($0).
- Итог: далеко внутри лимита. Учёт токенов в evidence — принят (поле `spent`).

## Отклонения от процесса (зафиксированы)

1. Диспатч имитировался координатором (исполнение — координатор, worktree настоящие).
   Настоящий диспатч pi-воркеров — sprint-01.
2. ARCH-лайт вместо полного ADR (док-спринт).
3. Слияние прямо в `master`, staging-ветка пропущена (док-спринт).
4. `--repo id:` в `worktree create` дал `repo_not_found`; рабочий путь — запуск из директории
   репо с инференсом (внести в PIPELINE.md).
5. Манифест пакета: ключи только на существующие пути (урок из must-fix #1).

## Ссылки

- ROADMAP.md, REVIEW-sprint-00.md, branches `Ere15/feat-prompts`, `Ere15/feat-package` (удалены после мержа).
- Установленные скиллы/пакеты за спринт: `pi-claude-bridge` (глобально, npm, latest на 2026-10-22).

## Открытые риски

- Имя `pi-pipeline` в npm проверить перед публикацией.
- Extra Usage на anthropic пополнить или держать bridge основным frontier.
- mem0-выжимка спринта — pending (у координатора не было MCP-доступа в этом прогоне).
