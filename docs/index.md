# Conclave -- Complete Technical Documentation

> **Version**: 1.0.3 | **License**: MIT | **Language**: TypeScript (Bun 1.3.13)
> **Repository**: `github.com/adndvlp/conclave`
> **Upstream**: fork of [OpenCode](https://github.com/anomalyco/opencode)
>
> **Experimental** -- Multi-LLM collaborative research project. Not production-ready.

---

## What is Conclave

Conclave is an AI coding assistant that puts **multiple LLMs in a room to debate** before writing code. Instead of trusting a single model, Conclave orchestrates debate rounds between 2+ models using structured signals (LEAD, SUPPORT, CHALLENGE...) to converge on the best solution. The winner -- chosen by endorsement scoring -- implements the code.

## Documentation Index

| File | Content |
|------|---------|
| [01-abstract.md](01-abstract.md) | What Conclave is, why it exists, core value |
| [02-motivation.md](02-motivation.md) | The single-LLM problem: biases, blind spots |
| [03-conclave-vs-opencode.md](03-conclave-vs-opencode.md) | **Everything Conclave adds on top of OpenCode** |
| [04-how-it-works.md](04-how-it-works.md) | Full flow: prompt -> debate -> synthesis -> code |
| [05-architecture.md](05-architecture.md) | Tech stack, components, how they connect |
| [06-debate-system.md](06-debate-system.md) | Debate system deep dive: signals, rounds, scoring |
| [07-breaking-teams.md](07-breaking-teams.md) | Breaking Teams: sub-teams, phases, communication |
| [08-cli-bridging.md](08-cli-bridging.md) | Bridge with external CLIs: Gemini, Claude Code, Codex |
| [09-context-aware-teams.md](09-context-aware-teams.md) | Context and capability-aware teams |
| [10-agents.md](10-agents.md) | Agent system: build, plan, explore, general |
| [11-tools.md](11-tools.md) | All available tools |
| [12-providers.md](12-providers.md) | AI providers, models, SDKs |
| [13-configuration.md](13-configuration.md) | Complete configuration system |
| [14-session-management.md](14-session-management.md) | Session handling, messages, SQLite persistence |
| [15-effect-architecture.md](15-effect-architecture.md) | Effect-TS architecture: services, layers, runtime |
| [16-infrastructure.md](16-infrastructure.md) | SST, Cloudflare, Docker, desktop apps |
| [17-design-decisions.md](17-design-decisions.md) | Trade-offs and design decisions |
| [18-limitations.md](18-limitations.md) | Current limitations: latency, cost, dependencies |
| [19-future-work.md](19-future-work.md) | Roadmap and future work |
| [20-references.md](20-references.md) | Papers, projects, inspirations |
| [21-source-map.md](21-source-map.md) | Full source code tree map |

## Quickstart

```bash
# Install
curl -fsSL https://raw.githubusercontent.com/adndvlp/conclave/main/install.sh | bash

# From source
git clone https://github.com/adndvlp/conclave.git && cd conclave
bun install
bun run dev

# Main commands
/connect    -- Connect AI providers with API keys
/team       -- Create and configure model teams
/models     -- Switch to single-model mode
```

## Project Layout

```
conclave/
├── packages/
│   ├── opencode/        # Core: CLI, TUI, API, agents, debate, tools
│   ├── app/             # Web app (SolidJS + Vite)
│   ├── desktop/         # Tauri desktop app (Rust backend)
│   ├── desktop-electron/# Electron desktop app
│   ├── enterprise/      # Enterprise app (SolidStart + Stripe)
│   ├── console/         # Admin console (app, core, function, mail, resource)
│   ├── sdk/js/          # JavaScript SDK + OpenAPI types
│   ├── core/            # Shared utilities (log, fs, npm, telemetry)
│   ├── ui/              # Shared UI components (SolidJS)
│   ├── plugin/          # Plugin system (Effect + Zod)
│   ├── web/             # Docs site (Astro + Starlight)
│   ├── docs/            # Documentation content
│   ├── slack/           # Slack bot
│   ├── containers/      # Docker builds
│   ├── function/        # Serverless utilities
│   ├── script/          # Build & generation scripts
│   ├── identity/        # Auth/identity
│   └── extensions/      # Extensions
├── infra/               # SST infra as code (Cloudflare Workers)
├── specs/               # Project specifications
├── script/              # Release, changelog, utility scripts
├── .conclave/           # Conclave's own config (specs, agents, commands)
└── docs/                # <-- This documentation
```
