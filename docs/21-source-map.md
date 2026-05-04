# 21. Source Code Map

Complete tree of `packages/opencode/src/` -- the core application source.

```
packages/opencode/src/
├── index.ts                          # CLI entry point (yargs, binary name: "conclave")
│
├── agent/
│   ├── agent.ts                      # Agent.Service: build, plan, explore, general, compaction, title, summary
│   └── prompt/                       # Agent-specific system prompts
│       ├── explore.txt
│       ├── compaction.txt
│       ├── summary.txt
│       └── title.txt
│
├── team/                             # [CONCLAVE-SPECIFIC] Multi-LLM debate engine
│   ├── debate.ts                     # Core debate: runDebate(), runBreakingTeams(), parseSignal(), callParticipant()
│   ├── team.ts                       # Team.Service: participant resolution, streaming, orchestration
│   ├── prompts.ts                    # buildDeliberationPrompt(), buildSubTeamPrompt(), buildGlobalRoundPrompt()
│   ├── cli-adapter.ts                # Gemini CLI, Claude Code, Codex adapters (callGemini, callClaude, callCodex)
│   └── schema.ts                     # TeamConfig, TeamMember, SubTeam, CrossTeamMessage types
│
├── session/
│   ├── session.ts                    # Session CRUD, data types
│   ├── session.sql.ts                # Drizzle SQLite schema (session, message, part tables)
│   ├── prompt.ts                     # SessionPrompt: prompt orchestration, team integration, reminders
│   ├── processor.ts                  # SessionProcessor: LLM streaming loop, tool execution, CLI routing
│   ├── llm.ts                        # LLM.Service: streamText() wrapper, provider resolution
│   ├── system.ts                     # System prompt selection per model family
│   ├── retry.ts                      # Retry logic for LLM failures
│   ├── overflow.ts                   # Context overflow detection
│   ├── compaction.ts                 # Context compaction/summarization
│   ├── status.ts                     # SessionStatus: idle, busy, team.breaking
│   ├── summary.ts                    # Diff/change summary generation
│   └── message-v2.ts                 # MessageV2 types: User, Assistant, Parts (Text, Tool, Reasoning, File...)
│
├── provider/
│   ├── provider.ts                   # Provider.Service: 22 bundled SDKs, custom loaders, model resolution
│   ├── models.ts                     # Model discovery (models.dev API + cached snapshot)
│   ├── transform.ts                  # Model data transformers
│   ├── schema.ts                     # ModelID, ProviderID branded types
│   └── sdk/
│       └── copilot/
│           └── copilot-provider.ts   # GitHub Copilot SDK adapter
│
├── config/
│   ├── config.ts                     # Main Config.Info schema, merge logic, source resolution
│   ├── agent.ts                      # Agent config overrides
│   ├── command.ts                    # Custom slash command config
│   ├── lsp.ts                        # Language Server Protocol config
│   ├── mcp.ts                        # Model Context Protocol config
│   ├── permission.ts                 # Permission ruleset config
│   ├── providers.ts                  # Custom provider config
│   └── ... (15+ more config modules) # Self-export pattern: export * as ConfigX from "./x"
│
├── tool/
│   ├── registry.ts                   # ToolRegistry.Service: tool registration and discovery
│   ├── tool.ts                       # Tool.Def type, ExecuteResult
│   ├── bash.ts                       # Shell command execution
│   ├── read.ts                       # File reading (text, images, PDFs)
│   ├── write.ts                      # File writing (create/overwrite)
│   ├── edit.ts                       # Exact string replacements
│   ├── glob.ts                       # File pattern matching
│   ├── grep.ts                       # Content search (ripgrep)
│   ├── task.ts                       # Subagent delegation
│   ├── webfetch.ts                   # URL content fetching
│   ├── websearch.ts                  # Exa web search
│   ├── skill.ts                      # Skill instruction loading
│   ├── question.ts                   # Multi-choice user questions
│   ├── todowrite.ts                  # Task list management (uses todo.ts)
│   ├── todo.ts                       # Todo list data types
│   ├── plan.ts                       # Plan mode entry/exit
│   ├── lsp.ts                        # Language Server Protocol
│   ├── apply_patch.ts                # Unified diff patching
│   └── invalid.ts                    # Malformed tool call handler
│
├── cli/
│   ├── cmd/
│   │   ├── run.ts                    # Main "run" command
│   │   ├── serve.ts                  # Server mode launcher
│   │   ├── generate.ts               # Generate command
│   │   ├── agent.ts                  # Agent management commands
│   │   ├── providers.ts              # Provider management
│   │   ├── mcp.ts                    # MCP management
│   │   ├── acp.ts                    # ACP management
│   │   ├── web.ts                    # Web app launcher
│   │   ├── attach.ts                 # Session attachment
│   │   ├── session.ts                # Session management
│   │   ├── pr.ts                     # Pull request commands
│   │   └── ... (25+ subcommands)
│   ├── tui.ts                        # Terminal UI (SolidJS + @opentui)
│   ├── error.ts                      # Error formatting
│   └── logo.ts                       # ASCII logo rendering
│
├── server/
│   ├── server.ts                     # Hono HTTP server setup
│   ├── routes/                       # REST API routes
│   ├── middleware/                   # CORS, auth, logging middleware
│   ├── mdns.ts                       # MDNS service discovery
│   ├── proxy.ts                      # Request proxy
│   └── websocket.ts                  # WebSocket support
│
├── effect/
│   ├── run-service.ts                # makeRuntime: memoized runtime creation
│   ├── instance-state.ts             # InstanceState: per-directory scoped state
│   ├── bridge.ts                     # EffectBridge: Promise-to-Effect bridging
│   └── ...
│
├── storage/
│   ├── db.ts                         # Drizzle database connection
│   ├── migration.ts                  # Database migration runner
│   └── ...
│
├── permission/
│   ├── permission.ts                 # Permission.Service: rule-based tool access control
│   └── ...
│
├── mcp/
│   ├── mcp.ts                        # Model Context Protocol client/server
│   ├── auth.ts                       # MCP OAuth
│   └── ...
│
├── acp/
│   ├── acp.ts                        # Agent Client Protocol support
│   └── README.md
│
├── lsp/
│   ├── lsp.ts                        # Language Server Protocol integration
│   └── ...
│
├── plugin/
│   ├── plugin.ts                     # Plugin.Service: tool/TUI plugins
│   └── ...
│
├── skill/
│   ├── skill.ts                      # Skill discovery and management
│   └── ...
│
├── project/
│   ├── project.ts                    # Project state, initialization
│   ├── bootstrap.ts                  # Runtime bootstrap (service init, forkDetach)
│   └── ...
│
├── file/
│   ├── file.ts                       # File operations
│   ├── ripgrep.ts                    # ripgrep integration
│   ├── watcher.ts                    # File watcher (@parcel/watcher)
│   └── ...
│
├── git/
│   ├── git.ts                        # Git operations
│   └── ...
│
├── shell/
│   ├── shell.ts                      # Shell command helpers
│   └── ...
│
├── control-plane/
│   ├── workspace.ts                  # Workspace management
│   ├── dev/                          # Dev environment control plane
│   └── ...
│
├── bus/
│   ├── bus.ts                        # Event bus for internal communication
│   └── ...
│
├── sync/
│   ├── sync.ts                       # File synchronization
│   └── README.md
│
├── util/
│   ├── process.ts                    # spawn() wrapper for child processes
│   ├── error.ts                      # Error message utilities
│   ├── record.ts                     # Record type guards
│   ├── schema.ts                     # Schema utility helpers
│   ├── effect-zod.ts                 # Zod-to-Effect schema bridge
│   ├── named-schema-error.ts         # Named schema error helpers
│   ├── iife.ts                       # IIFE utility
│   ├── log.ts                        # Structured logging
│   └── ... (30+ utility modules)
│
├── snapshot/
│   ├── snapshot.ts                   # Snapshot management
│   └── ...
│
├── format/
│   ├── format.ts                     # Output formatting
│   └── ...
│
├── patch/
│   ├── patch.ts                      # Patch/diff utilities
│   └── ...
│
├── auth/
│   ├── auth.ts                       # Authentication service
│   └── ...
│
├── share/
│   ├── share.ts                      # Session sharing
│   └── ...
│
├── pty/
│   ├── pty.ts                        # Pseudo-terminal (node-pty) support
│   └── ...
│
├── env/
│   ├── env.ts                        # Environment variable service
│   └── ...
│
├── account/
│   ├── account.ts                    # Account management
│   └── ...
│
├── installation/
│   ├── installation.ts               # Installation management
│   └── ...
│
├── permission/
│   ├── permission.ts                 # Permission checks and rules
│   └── ...
│
├── worktree/
│   ├── worktree.ts                   # Git worktree support
│   └── ...
│
├── ide/
│   ├── ide.ts                        # IDE integration
│   └── ...
│
├── question/
│   ├── question.ts                   # User question prompts
│   └── ...
│
└── v2/
    ├── v2.ts                         # Next-gen session architecture
    └── ...
```

## Key file sizes

| File | Lines | Description |
|------|-------|-------------|
| `provider/provider.ts` | 1884 | Provider service: 22 SDKs, custom loaders |
| `session/processor.ts` | 735 | LLM streaming loop, tool execution |
| `team/debate.ts` | 701 | Core debate engine (Conclave-specific) |
| `session/llm.ts` | ~600 | streamText wrapper, model resolution |
| `agent/agent.ts` | 413 | Agent definitions and registry |
| `team/cli-adapter.ts` | 359 | CLI adapters (Conclave-specific) |
| `session/session.sql.ts` | ~350 | Drizzle SQLite schema |
| `config/config.ts` | ~350 | Main config schema and merge |
| `team/team.ts` | 207 | Team service orchestration (Conclave-specific) |
| `team/prompts.ts` | 203 | Deliberation prompt builders (Conclave-specific) |
| `cli/cmd/run.ts` | ~670 | Main run command |
| `tool/task.ts` | ~200 | Subagent delegation |
| `team/schema.ts` | 43 | Team config types (Conclave-specific) |

## File co-location pattern

Each feature area follows this structure:

```
src/foo/
├── foo.ts          # Service, Interface, Layer, defaultLayer + self-reexport
├── bar.ts          # Sibling module (imported as: import { Foo } from "@/foo/bar")
└── prompt/
    └── *.txt       # Text-based prompts (if needed)
```

No barrel `index.ts` files in multi-sibling directories. Each sibling file self-exports:

```typescript
export * as Foo from "./foo"
```
