# pi-pipeline

Sprint pipeline for [pi](https://pi.dev): routine implementation on `opencode-go`
subscription models, architecture and review on frontier models (Claude subscription
via `pi-claude-bridge`), Orca worktrees for isolation and team visibility,
[Jev](https://typesafe.ai) (`opencode/jev-1.13-free`, no extra key) for routing,
mem0 for cross-sprint memory.

## Install

One line in the target repo (installs the global package, then scaffolds `.pi/*`):

```bash
cd /path/to/repo && pi install git:github.com/Ere15/pi-pipeline@v0.2.0 && pi --print "/pipeline-init"
```

`/pipeline-init` writes `.pi/bifrost.json`, `.pi/claude-bridge.json` (plan pro by default,
`plan=max` via `/pipeline-init plan=max`) and `.pi/mcp.json` from the pinned release,
never overwrites existing files, warns when `AGENTS.md` is missing, and prints the
`orca repo add` next step. npm path (`pi install npm:pi-pipeline) once published.

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
