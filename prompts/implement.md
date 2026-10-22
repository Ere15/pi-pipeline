# Implement — реализовать задачу из ADR

Используй скилл `/skill:implement-from-adr`. Работай строго в границах своего Task-spec
(Target/Change/Constraints/Ownership) и своего worktree.

Правила стадии:
- Перед `worker_done` собери evidence: `pnpm test <scope>` green (N passed),
  lint clean, typecheck clean, токены/стоимость, files-modified, report-path.
- Done без evidence отклоняется. Третий одинаковый провал подряд — остановись
  и предложи новую гипотезу вместо ретрая.
- Вопросы координатору — через имеющийся канал (не додумывай за него).
