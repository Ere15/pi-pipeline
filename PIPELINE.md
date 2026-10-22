# PIPELINE.md — скрипт координатора (sprint-N)

ORCA = `/home/vova/.config/orca/linux-orca-cli-shim/orca`. Все вызовы с `--json`.
Каждый worker-start — self-contained spec: Target/Change/Constraints/Ownership/Acceptance.

## 0. Подготовка (один раз на спринт)

```bash
orca status --json
# MCP-шлюз: поднять тяжёлые серверы один раз (mem0, playwright → localhost HTTP)
# проверить:
pi mcp list   # exit 1 = чинить до волны
pi update     # свежесть пакетов/скиллов, не посреди волны
# Память: recall перед стартом — «похожие прошлые задачи?» (оценки, грабли, прецеденты).
orca orchestration run-create --objective "sprint-N: <цель> | budget-stop: $<N, дефолт 10>" --json
# → run_id. Бюджет: стоп-кран на frontier-траты; при достижении — стоп волны + unread + ждать человека.
```

## 0.5. INTAKE (brief → ROADMAP.md)

```bash
# Вход: краткое описание желаемого от человека (свободный текст).
# Координатор задаёт до 5 уточняющих вопросов, затем пишет ROADMAP.md:
# цели, scope/non-goals, стадии, задачи с черновиками спек, риски, assumptions.
# Недоспрошенное фиксируется как assumption, не додумывается молча.
# ГЕЙТ: комплектность проверяет координатор на frontier-модели. Затем п.1.
```

## 1. ARCH (pi + bridge/opus, high, /skill:sprint-arch)

```bash
# worktree create — из директории репо (инференс); --repo id: даёт repo_not_found.
orca worktree create --name sprint-N-arch --json
# ARCH-терминал: opus через bridge (квота подписки); прямой anthropic упрётся в Extra Usage без баланса.
orca terminal create --worktree name:sprint-N-arch --command "pi --model claude-bridge/claude-opus-5 --thinking high" --json
# → term-arch
orca orchestration worker-start --task <t-arch> --terminal term-arch --json
# spec: Target docs/arch. Change: ADR + диаграмма + декомпозиция + «как тестировать».
# Constraints: код не трогать. Ownership: только docs/arch/.
# Acceptance: ADR принят + список задач. Use /skill:sprint-arch.
orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms 900000 --json
# ГЕЙТ: утверждает координатор на frontier-модели. ADR без раздела «как тестировать» = возврат.
```

## 2. Jev-гейт (локально, на каждую задачу декомпозиции)

```text
state: {title, body, files, diffStat}
questions:
  arch:  noul  "Does task change architecture, API contracts, DB schema, auth, cross-service?"
  risk:  score "Review level" ["Routine, pi is enough", "Needs frontier review after", "Must have frontier before coding"]
  owner: choice "Who owns?" {pigo: "routine impl/tests/docs", frontier: "arch/security/complex debug/review"}
route: arch.p>=0.7 ИЛИ risk.value>=1.5 ИЛИ owner==frontier → frontier-модель (anthropic/*),
       иначе general (opencode-go). Arch-задачи → opus/high, остальные frontier → sonnet/high (указать в спеке). Низкая confidence/escalate → дефолт + пометка.
В Task spec дописать: "Routing: decided by jev arch=0.91 risk=1.7 → frontier".
```

## 3. FAN-OUT — живые терминалы (уроки sprint-01)

```bash
# terminal create --command "pi" НЕ выживает (процесс умирает, handle stales).
# Рабочий путь: создать шелл-терминал -> отправить запуск pi -> дождаться TUI -> диспатч.
orca terminal create --worktree name:feat-<x> --json
# -> term-<x> (запомнить handle; при terminal_handle_stale — только re-list и замена)
orca terminal send --terminal term-<x> --text "pi --model <модель стадии> --thinking <уровень>" --enter --json
# дождаться TUI в выводе (модель и worktree в футтере), затем:
orca orchestration worker-start --task <t> --terminal term-<x> --worktree name:feat-<x> --json
# --worktree при reuse обязателен, иначе terminal_worktree_mismatch. Run — свежий, этого спринта.
```

```bash
orca worktree create --name feat-<x> --json
orca terminal create --worktree name:feat-<x> --command "pi --model opencode-go/muse-spark-1.3-contributor --thinking medium" --json
# → term-<x> (один PID на всё направление)
orca orchestration worker-start --task <t1> --terminal term-<x> --json
# spec: Target src/<x>/. Change: реализовать по ADR-nn. Constraints: <do-not-touch>.
# Ownership: только worktree feat-<x>. Acceptance: pnpm test <scope> green (N passed),
# lint clean, typecheck clean, evidence: <cmd + хвост + токены/стоимость>, files-modified, report-path.
# Use /skill:implement-from-adr. Модель старта — general/medium; frontier-задачи по спеку
# переключаются внутри на claude-bridge/sonnet, high. Параллельно max 3 направления, остальные в очереди.
# Воркер ОБЯЗАН закоммитить результат в ветке своего worktree — незакоммиченный done неполный.
orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms 900000 --json
# validate done: evidence есть? тесты зелёные? нет → вернуть (done-check).
# вопросы → reply. следующий таск на ТОТ ЖЕ терминал:
orca orchestration worker-show --dispatch <disp_1> --json   # proven handle
orca orchestration worker-start --task <t2> --terminal term-<x> --json
# ... повторять до закрытия всех Task направления. release НЕ делаем (терминал ещё нужен).
```

Правила: done без evidence отклоняется; 3-й одинаковый провал подряд = требовать новую
гипотезу; чекпоинты — `worktree set --worktree name:feat-<x> --comment "<статус>"`.

## 4. INTEGRATION (отдельный Task, deps на implement-задачи)

```bash
orca orchestration task-create --spec "Merge feat-* в sprint-N staging, полный suit + smoke/e2e" --deps '["<t-feat1>","<t-feat2>",...]' --json
orca orchestration worker-start --task <t-int> --terminal <term-int или reuse review> --json
# readiness гарантирует порядок: стартует только когда deps закрыты.
# ГЕЙТ: полный прогон зелёный. Красный → must-fix кандидаты в ревью.
```

## 5. REVIEW (pi + anthropic/sonnet, high, read-only, /skill:sprint-review)

```bash
# REVIEW: sonnet через bridge (модель терминала: pi --model claude-bridge/claude-sonnet-5-5 --thinking high).
orca orchestration worker-start --task <t-rev> --terminal term-review --json
# spec: Target diff main...sprint-N. Change: REVIEW.md (вердикт по тестам + readability-вердикт + must-fix).
# Constraints: только read, правки запрещены. Acceptance: REVIEW.md + must-fix со ссылками на строки.
# review-only done = синтез находок, не правки координатора.
# ГЕЙТ: must-fix пуст → п.7; иначе п.6.
```

## 6. FIX (reuse feat-терминалов)

```bash
orca orchestration worker-start --task <t-fix> --terminal term-<x> --json
# spec: Target <файлы из must-fix>. Change: устранить пункты N..M. Acceptance: точечные + полный suit повторно.
```

## 7. Финиш (мерж — координатор после зелёного CI)

```bash
# CI зелёный + REVIEW закрыт + readability подписан → мерж staging в main делает координатор.
# PR-ссылки — в references worktree. Затем отчёт команде (по Task: исход, evidence, блокеры).
# Память: remember выжимки стадий (решение → исход → где лежит), без секретов.
orca orchestration worker-release --dispatch <последний disp каждого терминала> --json
orca terminal close --worktree name:feat-<x> --all  # по каждому
orca worktree rm --worktree name:feat-<x> --force
# reclaimable-проверка: worker-list --terminal-state reclaimable → должно быть пусто.
```

## Команды-напоминалки

```bash
orca worktree ps --json
orca orchestration worker-list --include-remote --json
orca worktree set --worktree <sel> --comment "<короткий статус>" --json
orca reference add <PR/issue URL> --worktree <sel> --json
```
