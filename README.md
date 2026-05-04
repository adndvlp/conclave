<p align="center">
  <h1>&#x1F511; Conclave</h1>
</p>
<p align="center"><strong>Experimental multi-LLM collaborative research project. Not production-ready.</strong></p>
<p align="center">
  <a href="https://github.com/adndvlp/conclave/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/adndvlp/conclave/publish.yml?style=flat-square&branch=main" /></a>
  <a href="https://github.com/adndvlp/conclave"><img alt="GitHub" src="https://img.shields.io/github/stars/adndvlp/conclave?style=flat-square" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-%238b0000?style=flat-square" /></a>
</p>

---

> **Experimental** -- A research project exploring whether multi-LLM team debates produce better code than any single model alone. Expect bugs, breaking changes, and undocumented behavior. Not recommended for production.

Conclave is an AI coding agent that puts **multiple LLMs in a room to debate** your task before implementing code. It is a fork of [OpenCode](https://github.com/anomalyco/opencode) that adds a research layer on top: a signal-based multi-model deliberation engine, CLI bridging for external AI tools, autonomous sub-team splitting, and context-aware team formation.

---

## Documentation

Full technical documentation is in the [docs/](docs/index.md) directory -- designed for both humans and LLMs to understand every aspect of the project.

---

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/adndvlp/conclave/main/install.sh | bash
```

From source:

```bash
git clone https://github.com/adndvlp/conclave.git && cd conclave
bun install
bun run dev
```

---

## How It Works

1. **You ask** -- "Build an auth system with JWT tokens"
2. **Team debates** -- Models deliberate in parallel rounds using structured signals: `LEAD`, `SUPPORT`, `ALIGN`, `BUILD`, `CHALLENGE`, `SYNTHESIZE`
3. **Converges** -- Winner selected by endorsement scoring (`endorsements * 2 + leads`), not context window size
4. **Implements** -- Winner generates the code using the full tool suite (read files, run bash, edit code, search web)

```text
Conclave (2 models)
Team debating  Round 1/3
  DeepSeek V4 Flash: LEAD -- Best fit for auth logic
  GLM-5.1: SUPPORT:DeepSeek -- Agreed, backend expert
Converged -- DeepSeek V4 Flash implements
```

---

## Key Features

### Multi-LLM Team Debates
Signal-based consensus protocol with minimum 2 rounds. Models emit structured signals at the end of each response. Winner selected by endorsement score -- being supported by others is worth double what self-promotion is.

### Breaking Teams
LLMs autonomously split into sub-teams for parallel work on complex tasks. Three phases: decision round (BREAK votes), sub-team formation (invite resolution, solo merging), and parallel internal debates with global coordination rounds. Full details: [docs/07-breaking-teams.md](docs/07-breaking-teams.md)

### CLI Bridging
Use external AI CLIs as team members with no API keys required:
- **Gemini CLI** -- Free tier (60 req/min, 1000/day)
- **Claude Code** -- Subscription-based, effort suffixes (`high`, `max`)
- **Codex CLI** -- OpenAI pay-as-you-go

Mix CLI and API participants freely. CLIs run in agent mode during implementation. Full details: [docs/08-cli-bridging.md](docs/08-cli-bridging.md)

### Context-Aware Teams
Each model receives its teammates' capability metadata (context window size, reasoning, speed) plus self-assignment rules. Models with large context lead analysis; fast models focus on execution; reasoning models handle design. Full details: [docs/09-context-aware-teams.md](docs/09-context-aware-teams.md)

### 22+ AI Providers
OpenAI (GPT-5 with responses API), Anthropic (interleaved thinking beta), Google (Gemini + Vertex), Azure, Amazon Bedrock, xAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, TogetherAI, Perplexity, Alibaba, OpenRouter (200+ models), GitHub Copilot, GitLab, Venice, plus OpenAI-compatible for Ollama and self-hosted.

### 7 Built-in Agents
`build` (default), `plan` (planning-only), `general` (subagent), `explore` (codebase search), `compaction`, `title`, `summary`. Custom agents definable in config with per-agent permission rulesets.

### 16+ Tools
`bash`, `read`, `write`, `edit`, `glob`, `grep`, `task` (subagent delegation), `webfetch`, `websearch`, `skill`, `question`, `todowrite`, `plan`, `apply_patch`, `lsp`, `invalid`

### Three Interfaces
- **Terminal UI** -- SolidJS-rendered TUI with multi-panel layout
- **Web App** -- SolidJS SPA with shiki syntax highlighting
- **Headless Server** -- Hono HTTP API with WebSocket streaming

### Other Capabilities
- **Desktop apps** -- Tauri v2 (Rust backend) and Electron wrappers
- **MCP support** -- Model Context Protocol client/server with OAuth
- **LSP integration** -- Language Server Protocol for diagnostics and completions
- **Plugin system** -- Extensible tool and TUI plugins via Effect + Zod
- **Session management** -- SQLite persistence, forking, sharing, compaction, reversion
- **Effect-TS architecture** -- Type-safe dependency injection, structured concurrency, tracing

---

## Usage

```text
/connect     Connect AI providers with API keys
/team        Create and configure teams of models
/models      Switch to single-model mode
/agent       Switch between agents (build, plan, explore...)
```

```bash
conclave run "Fix the race condition in auth.ts"
conclave serve                 # Start HTTP API server (port 4096)
conclave web                   # Launch web app
```

---

## Config

```jsonc
// ~/.config/conclave/conclave.json or .conclave/conclave.jsonc
{
  "team": {
    "enabled": true,
    "members": [
      { "providerID": "deepseek", "modelID": "deepseek-chat" },
      { "providerID": "anthropic", "modelID": "claude-sonnet-4-20250514" },
      { "providerID": "cli-gemini", "modelID": "gemini-2.5-flash" }
    ],
    "maxRounds": 3,
    "minRounds": 2,
    "breakingTeams": {
      "maxSubTeams": 3,
      "globalRoundInterval": 1
    }
  }
}
```

---

## Differences from OpenCode

| Area | OpenCode | Conclave |
|------|----------|----------|
| Team debates | No | Signal-based multi-round consensus |
| Breaking Teams | No | Autonomous sub-team splitting |
| CLI Bridging | No | Gemini CLI, Claude Code, Codex |
| Context-Aware Teams | No | Models aware of each other's capabilities |
| Config directory | `~/.config/opencode/` | `~/.config/conclave/` |
| Binary | `opencode` | `conclave` |

Full diff catalog: [docs/03-conclave-vs-opencode.md](docs/03-conclave-vs-opencode.md)

---

## Architecture

```text
packages/
├── opencode/      Core: CLI, TUI, API, agents, debate engine, tools
├── app/           Web app (SolidJS + Vite)
├── desktop/       Tauri desktop (Rust)
├── desktop-electron/  Electron desktop
├── enterprise/    Enterprise app (SolidStart + Stripe)
├── console/       Admin console
├── sdk/js/        JavaScript SDK + OpenAPI types
├── core/          Shared utilities
├── ui/            SolidJS component library
├── plugin/        Plugin system
├── web/           Docs site (Astro + Starlight)
├── slack/         Slack bot
└── containers/    Docker builds

Stack: TypeScript, Bun, Effect-TS, Vercel AI SDK, Hono, SQLite/Drizzle, SolidJS, Tauri
```

---

## Upstream

Conclave is a fork of [OpenCode](https://github.com/anomalyco/opencode). To sync:

```bash
git remote add upstream https://github.com/anomalyco/opencode.git
git fetch upstream
git merge upstream/main
```

---

## License

MIT -- see [LICENSE](LICENSE). Based on OpenCode by [anomalyco](https://github.com/anomalyco).
