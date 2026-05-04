# 5. Architecture

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Bun 1.3.13 (JavaScript runtime, package manager, bundler) |
| **Language** | TypeScript 5.8.2 |
| **Functional core** | Effect-TS 4.0.0-beta.57 (dependency injection, error handling, tracing) |
| **AI SDK** | Vercel AI SDK 6.0.168 (`streamText`, `generateObject`, provider adapters) |
| **CLI framework** | yargs (command parsing, subcommands) |
| **TUI** | SolidJS 1.9.10 + @opentui (terminal UI via React-like reactivity) |
| **Web frontend** | SolidJS 1.9.10 + Vite 7.1.4 (SPA with shiki syntax highlighting) |
| **Web framework** | SolidStart (meta-framework, custom pkg.pr.new build) |
| **HTTP server** | Hono 4.10.7 (lightweight, Edge-ready) |
| **Database** | SQLite via Drizzle ORM 1.0.0-beta.19 |
| **Desktop** | Tauri v2 (Rust backend) + Electron (alternative) |
| **Validation** | Zod 4.1.8 + Effect Schema |
| **CSS** | Tailwind CSS 4.1.11 |
| **Monorepo** | Bun workspaces + Turborepo 2.8.13 |
| **Infrastructure** | SST 3.18.10 (Serverless Stack -> Cloudflare Workers) |
| **Auth** | OpenAuth (custom, @openauthjs/openauth) |
| **Payments** | Stripe |
| **Containerization** | Docker (base, bun-node, tauri-linux, rust images) |

## AI provider SDKs (bundled)

| Provider | SDK package | Notes |
|----------|------------|-------|
| OpenAI | `@ai-sdk/openai` | Uses `responses()` API for GPT-5+, `chat()` for older |
| Anthropic | `@ai-sdk/anthropic` | Beta headers for interleaved thinking, fine-grained tool streaming |
| Google | `@ai-sdk/google` | Generative AI + Vertex AI variants |
| Azure | `@ai-sdk/azure` | Resource name resolution from config/auth/env |
| Amazon Bedrock | `@ai-sdk/amazon-bedrock` | Cross-region inference, AWS credential chain |
| xAI | `@ai-sdk/xai` | Grok models |
| Mistral | `@ai-sdk/mistral` | |
| Groq | `@ai-sdk/groq` | Fast inference |
| DeepInfra | `@ai-sdk/deepinfra` | |
| Cerebras | `@ai-sdk/cerebras` | |
| Cohere | `@ai-sdk/cohere` | |
| TogetherAI | `@ai-sdk/togetherai` | |
| Perplexity | `@ai-sdk/perplexity` | Web-search-aware models |
| Vercel | `@ai-sdk/vercel` | |
| Alibaba | `@ai-sdk/alibaba` | Qwen models |
| OpenRouter | `@openrouter/ai-sdk-provider` | Multi-provider gateway |
| GitLab | `gitlab-ai-provider` | |
| GitHub Copilot | `./sdk/copilot/copilot-provider` | Custom adapter |
| Venice | `venice-ai-sdk-provider` | |
| Custom | `@ai-sdk/openai-compatible` | For self-hosted / Ollama |

## Component architecture

```
┌─────────────────────────────────────────────────────┐
│                    Entry Points                       │
│  CLI (yargs)    │    HTTP Server (Hono)   │   TUI    │
│  src/index.ts   │    src/server/          │  SolidJS │
└────────┬────────┴──────────┬──────────────┴────┬─────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
         ┌───────────────────▼───────────────────┐
         │           Session Layer                 │
         │  SessionPrompt ─── SessionProcessor     │
         │  SessionLLM ─────── SessionRetry        │
         │  SessionCompaction ─ SessionStatus      │
         │  MessageV2 ──────── Session.sql.ts      │
         └───────────────────┬───────────────────┘
                             │
    ┌────────────────────────┼────────────────────────┐
    │                        │                        │
    ▼                        ▼                        ▼
┌──────────┐   ┌──────────────────────┐   ┌──────────────┐
│  Team     │   │     LLM Service       │   │   Agent       │
│  Service  │   │  (Vercel AI SDK)      │   │   Service     │
│           │   │  streamText()         │   │   build,plan  │
│ debate.ts │   │  provider resolution  │   │   explore,gen │
│ team.ts   │   │  system prompts       │   │   compaction  │
│ prompts.ts│   │  model selection       │   │   title,sum   │
│ cli-adap. │   └──────────┬───────────┘   └──────┬───────┘
└─────┬─────┘              │                      │
      │                    │                      │
      ▼                    ▼                      ▼
┌──────────────────────────────────────────────────────┐
│                 Tool Registry                         │
│  bash, read, write, edit, glob, grep, task,           │
│  webfetch, websearch, skill, question, todowrite,     │
│  plan, apply_patch, lsp, invalid                      │
└──────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────┐
│              Infrastructure Layer                     │
│  Config ── Provider ── Auth ── Permission ── Plugin  │
│  Storage (SQLite/Drizzle) ── Bus ── Snapshot         │
│  FileSystem ── Env ── MCP ── LSP ── PTY             │
└──────────────────────────────────────────────────────┘
```

## Effect-TS service graph

Every component is an Effect `Context.Service` with a `Layer`. Services compose via `Layer.provide()`:

```
SessionPrompt.defaultLayer
  <- SessionProcessor.defaultLayer
    <- Session.defaultLayer
    <- Snapshot
    <- Agent.defaultLayer
    <- LLM.defaultLayer
    <- Permission.defaultLayer
    <- Plugin.defaultLayer
    <- SessionSummary.defaultLayer
    <- SessionStatus.defaultLayer
    <- Bus.defaultLayer
    <- Config.defaultLayer
    <- Team.defaultLayer
      <- Provider.defaultLayer
      <- SessionStatus.defaultLayer
  <- LLM.defaultLayer
    <- Auth.defaultLayer
    <- Config.defaultLayer
    <- Provider.defaultLayer
    <- Plugin.defaultLayer
    <- Permission.defaultLayer
  <- Agent.defaultLayer
    <- Plugin.defaultLayer
    <- Provider.defaultLayer
    <- Auth.defaultLayer
    <- Config.defaultLayer
    <- Skill.defaultLayer
  <- Provider.defaultLayer
    <- Plugin.defaultLayer
    <- App.defaultLayer
    <- Config.defaultLayer
    <- Auth.defaultLayer
    <- AppFileSystem.defaultLayer
    <- Env.defaultLayer
```

## Three interface modes

### 1. Terminal UI (TUI)
- Entry: `bun run dev` or the `conclave` binary
- Uses SolidJS reactivity rendered to terminal via @opentui
- Full features: multi-panel layout, streaming text, tool output display
- Commands: `/connect`, `/team`, `/models`, `/agent`, etc.

### 2. Web App
- Entry: `bun run --cwd packages/app dev`
- SolidJS SPA that connects to the API server
- Same capabilities as TUI but in a browser
- Markdown rendering via shiki

### 3. Headless Server
- Entry: `conclave serve` or `bun dev serve`
- Hono HTTP server on port 4096 (configurable)
- REST API with OpenAPI spec
- Optional HTTP Basic Auth via `OPENCODE_SERVER_PASSWORD`
- WebSocket for real-time streaming
