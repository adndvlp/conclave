# 3. Conclave vs OpenCode

Conclave is a **fork of OpenCode**. Everything OpenCode does, Conclave does too. But Conclave adds a research layer on top: the multi-LLM team debate engine. This document catalogs every difference.

## Summary of differences

| Aspect | OpenCode | Conclave |
|--------|----------|----------|
| **Core purpose** | AI coding agent CLI | Same + multi-LLM team debate research |
| **Binary name** | `opencode` | `conclave` |
| **Config directory** | `~/.config/opencode/` | `~/.config/conclave/` |
| **Config files** | `opencode.json`, `opencode.jsonc` | `conclave.json`, `conclave.jsonc` |
| **Team debates** | No | Yes -- signal-based multi-round consensus |
| **Breaking Teams** | No | Yes -- autonomous sub-team splitting |
| **CLI Bridging** | No | Yes -- Gemini CLI, Claude Code, Codex as members |
| **Context-Aware Teams** | No | Yes -- models aware of each other's capabilities |
| **Session status** | Basic | Extended with team debate progress tracking |

## New source code (only in Conclave)

All team-related code lives in `packages/opencode/src/team/`:

| File | Lines | Purpose |
|------|-------|---------|
| `debate.ts` | 701 | Core debate engine -- `runDebate()` and `runBreakingTeams()` |
| `team.ts` | 207 | Team service -- orchestrates debate, resolves participants, manages streaming progress |
| `prompts.ts` | 203 | Prompt builders for deliberation rounds, sub-teams, and global coordination |
| `cli-adapter.ts` | 359 | Adapters for Gemini CLI, Claude Code, and Codex CLI |
| `schema.ts` | 43 | Team data types -- `TeamConfig`, `TeamMember`, `SubTeam`, `CrossTeamMessage` |

## Modified source code (Conclave additions to OpenCode files)

### `packages/opencode/src/config/config.ts`
- Added `team` field to `Config.Info` schema (with `enabled`, `members`, `maxRounds`, `minRounds`, `maxExtensions`, `roundExtension`, `breakingTeams`)

### `packages/opencode/src/session/prompt.ts`
- `SessionPrompt.prompt()` checks if team config has 2+ members and calls `Team.Service.run()` before normal processing
- If team returns a result, the debate thread replaces the user's original prompt
- If team selects a CLI implementer (Gemini/Claude/Codex), the processor routes to agent-mode CLI

### `packages/opencode/src/session/processor.ts`
- Imports `Team`, `CLI_PROVIDER_IDS`, `callGeminiAgent`, `callClaudeAgent`, `callCodex`
- In `process()`, checks if the implementer is a `CliParticipant` and routes to agent-mode CLI subprocess
- Maps CLI-specific events (from subprocess JSON streams) to the standard message/part format

### `packages/opencode/src/session/status.ts`
- Extended `SessionStatus` type to include `team.breaking` state with `globalRound`, `subTeams`, `participantStreams`

## Config isolation

Conclave uses its own config namespace to avoid conflicts:

```
OpenCode:  ~/.config/opencode/opencode.json
Conclave:  ~/.config/conclave/conclave.json
```

This means you can have both installed without config collisions.

## Team config format

```jsonc
// .conclave/conclave.jsonc or ~/.config/conclave/conclave.json
{
  "team": {
    "enabled": true,
    "members": [
      { "providerID": "deepseek", "modelID": "deepseek-chat" },
      { "providerID": "google", "modelID": "gemini-2.5-flash" }
    ],
    "maxRounds": 3,
    "minRounds": 2,
    "maxExtensions": 2,
    "roundExtension": 1,
    "breakingTeams": {
      "maxSubTeams": 3,
      "globalRoundInterval": 1
    }
  }
}
```

## UI differences

The TUI and web app show additional Conclave-specific UI:
- Team debate progress: per-round signals, participant streaming text
- Breaking Teams visualization: sub-team status, inter-team communication
- `/team` command for team management
- `/connect` command for provider setup

## What remains identical

Everything shared with OpenCode is identical:
- Agent system (build, plan, explore, general, compaction, title, summary)
- All 16+ tools (bash, read, write, edit, glob, grep, task, websearch, etc.)
- Provider system (20+ bundled providers via Vercel AI SDK)
- Effect-TS architecture (services, layers, runtime)
- Session management (SQLite via Drizzle, messages, parts, compaction)
- CLI framework (yargs-based)
- TUI (SolidJS + @opentui)
- Web app (SolidJS + Vite)
- Desktop apps (Tauri + Electron)
- Server mode (Hono HTTP API)
- MCP support (Model Context Protocol)
- LSP integration
- Plugin system
- Enterprise/console apps
- Deployment infrastructure (SST + Cloudflare)
