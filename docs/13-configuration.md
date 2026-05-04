# 13. Configuration

The configuration system merges settings from multiple sources with clear precedence rules. Code in `packages/opencode/src/config/` (22 files).

## Configuration sources (loaded in order, later overrides earlier)

1. Global config files: `~/.config/conclave/conclave.json`, `conclave.jsonc`, or `config.json`
2. `CONCLAVE_CONFIG` environment variable (file path)
3. Project-level files (looked up from cwd to worktree root): `conclave.json`, `conclave.jsonc`
4. `.conclave/` directory files
5. `CONCLAVE_CONFIG_CONTENT` environment variable (inline JSON)
6. Remote account config (from auth endpoints)
7. Managed config directory
8. macOS managed preferences (MDM)

## Config schema (key fields)

```typescript
Info = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  shell: Schema.optional(Schema.String),         // Shell to use (default: system)
  logLevel: Schema.optional(Schema.String),      // Log level
  username: Schema.optional(Schema.String),      // Display name for the user
  server: Schema.optional(Schema.Struct({         // HTTP server config
    port: Schema.Number,
    password: Schema.optional(Schema.String),
  })),
  command: Schema.optional(Schema.Record(...)),   // Custom slash commands
  skills: Schema.optional(Schema.Array(...)),     // Skill configurations
  watcher: Schema.optional(...),                  // File watcher settings
  snapshot: Schema.optional(...),                 // Snapshot settings
  plugin: Schema.optional(...),                   // Plugin configurations
  share: Schema.optional(...),                    // Session sharing
  autoshare: Schema.optional(Schema.Boolean),     // Auto-share sessions
  autoupdate: Schema.optional(Schema.Boolean),    // Auto-update
  disabled_providers: Schema.optional(...),       // Providers to disable
  enabled_providers: Schema.optional(...),         // Providers to enable
  model: Schema.optional(...),                    // Default model
  small_model: Schema.optional(...),              // Default small model
  default_agent: Schema.optional(Schema.String),  // Default agent
  agent: Schema.optional(Schema.Record(           // Agent overrides
    Schema.String, Agent.Info
  )),
  provider: Schema.optional(Schema.Record(        // Custom provider configs
    Schema.String, Schema.Struct({
      apiKey: Schema.optional(Schema.String),
      baseURL: Schema.optional(Schema.String),
      models: Schema.optional(Schema.Record(...)),
      options: Schema.optional(Schema.Record(...)),
    })
  )),
  mcp: Schema.optional(Schema.Record(             // MCP server configs
    Schema.String, Schema.Struct({...})
  )),
  team: Schema.optional(TeamConfig),              // Team debate config
  permission: Schema.optional(...),               // Global permission rules
  compaction: Schema.optional(Schema.Struct({      // Compaction settings
    auto: Schema.optional(Schema.Boolean),
    prune: Schema.optional(...),
    // ...
  })),
  experimental: Schema.optional(Schema.Record(    // Feature flags
    Schema.String, Schema.Boolean
  )),
})
```

## Team config

```jsonc
{
  "team": {
    "enabled": true,
    "members": [
      { "providerID": "deepseek", "modelID": "deepseek-chat" },
      { "providerID": "anthropic", "modelID": "claude-sonnet-4-20250514" }
    ],
    "maxRounds": 3,          // Maximum debate rounds
    "minRounds": 2,          // Minimum rounds before convergence check
    "maxExtensions": 2,      // Maximum round extensions
    "roundExtension": 1,     // How many rounds to add per extension vote
    "breakingTeams": {
      "maxSubTeams": 3,      // Maximum number of sub-teams
      "globalRoundInterval": 1  // Global coordination every N cycles
    }
  }
}
```

## Config resolution example

```typescript
// Global: ~/.config/conclave/conclave.json
{ "model": "claude-sonnet-4", "team": { "enabled": false } }

// Project: ./conclave.jsonc
{ "team": { "enabled": true, "members": [...] } }

// RESULT:
{ "model": "claude-sonnet-4", "team": { "enabled": true, "members": [...] } }
// team.enabled is overridden; model stays from global
```

## Config module organization

The `src/config/` directory uses a self-export pattern with 22 sub-modules:

```
config/
├── config.ts       # Main config schema and merge logic
├── agent.ts        # Agent config
├── command.ts      # Custom command config
├── lsp.ts          # LSP config
├── mcp.ts          # MCP config
├── permission.ts   # Permission config
├── providers.ts    # Provider config
├── ... (15+ more)
```

Each file follows the pattern:
```typescript
export * as ConfigAgent from "./agent"
```
