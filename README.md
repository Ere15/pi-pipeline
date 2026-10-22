# pi-pipeline

Sprint pipeline for [pi](https://pi.dev): routine implementation on `opencode-go`
subscription models, architecture and review on frontier models (Claude subscription
via `pi-claude-bridge`), Orca worktrees for isolation and team visibility,
[Jev](https://typesafe.ai) (`opencode/jev-1.13-free`, no extra key) for routing,
mem0 for cross-sprint memory.

## Install

```bash
pi install npm:pi-pipeline       # once published (needs npm 2FA)
pi install git:github.com/Ere15/pi-pipeline@v0.1.0   # works today, pinned
```

Requires pi 1.x, an OpenCode Go/Zen subscription (chat + free Jev classifier),
and a Claude Pro/Max subscription for the frontier pool. See `ARCHITECTURE.md`
in the repo for the full design and `PIPELINE.md` for the coordinator runbook.

## Contents

- `extensions/pipeline.ts` — `pipeline_route/worktree/dispatch/check` tools,
  `/sprint` command, `pipeline/auto` virtual model (Jev routing, sticky turns)
- `extensions/jev-gate.ts` — tier gate over `opencode/jev-1.13-free` with spend caps
- `extensions/orca-shims.ts` — typed wrappers over `orca --json`
- `skills/sprint-arch`, `skills/implement-from-adr`, `skills/sprint-review`
- `prompts/` — thin wrappers forcing the skills per stage
