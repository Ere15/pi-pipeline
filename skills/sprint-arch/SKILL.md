---
name: sprint-arch
description: Design system architecture as ADR with diagram, task breakdown and testability section. Use when starting sprint work, designing APIs, migrations, or cross-service changes.
---

# Sprint architecture

Produce decision-grade architecture, not prose.

## Required output

1. **ADR** (`docs/arch/ADR-nn-<slug>.md`): context, decision, alternatives + why rejected, consequences.
2. **Diagram**: components + data flow (mermaid in ADR).
3. **Task breakdown**: numbered tasks, each mappable to one implement Task-spec
   (Target/Change/Constraints/Ownership/Acceptance draft).
4. **Как тестировать** (mandatory): per-task test approach — unit scope, contract examples,
   integration points, what e2e/smoke must prove. ADR without this section FAILS the gate.

## Rules

- Touch only `docs/arch/`. Code changes are forbidden in this skill.
- Name cross-service/auth/DB-schema impacts explicitly. Silence is not consent.
- Contracts: request/response examples for every new or changed API.
- Alternatives: at least one rejected option with reason, or state why none exists.
- Keep it reviewable: short sections, no water. A human must approve in one read.
