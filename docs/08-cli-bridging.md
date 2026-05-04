# 8. CLI Bridging

CLI Bridging allows external AI CLIs (Gemini CLI, Claude Code, Codex) to participate as team members without needing API keys. This solves the adoption barrier where users without paid API access can still form teams.

Code: `packages/opencode/src/team/cli-adapter.ts` (359 lines)

## Supported CLIs

| CLI | Free tier | Detection | Priority | Status |
|-----|-----------|-----------|----------|--------|
| **Gemini CLI** | 60 req/min, 1000/day | `which gemini` | Highest | Implemented |
| **Claude Code** | Requires subscription | `which claude` | Medium | Implemented |
| **Codex (OpenAI)** | Pay-as-you-go | `which codex` | Lower | Implemented |

## Architecture

Each CLI acts as a **subprocess participant**. The CLI is spawned per debate round (not persistent -- each `callParticipant` spawns fresh), receives a debate prompt, streams its response, and the output is parsed for signals.

```typescript
type CliParticipant = {
  kind: "cli"
  model: Provider.Model   // Synthetic model metadata
  cli: "gemini" | "claude-code" | "codex"
  bin: string             // Path to binary (from `which`)
}
```

## CLI provider IDs

Special provider IDs in team config trigger CLI bridging:

```jsonc
{
  "team": {
    "members": [
      { "providerID": "cli-gemini",  "modelID": "gemini-2.5-flash" },
      { "providerID": "cli-claude",  "modelID": "claude-sonnet-4" },
      { "providerID": "cli-codex",   "modelID": "gpt-5" },
      { "providerID": "deepseek",    "modelID": "deepseek-chat" }  // API participant
    ]
  }
}
```

Mix CLI and API participants freely in the same team.

## Participant resolution

In `team.ts:55-91`, when resolving team members:

```typescript
if (CLI_PROVIDER_IDS.has(providerID)) {
  // CLI participant -- resolve via subprocess detection
  const entry = cliMap[providerID]
  const bin = yield* Effect.promise(() => detectCli(entry.bin))
  if (!bin) return Option.none<Participant>()
  const model = cliSyntheticModel(providerID, modelID, `${entry.label} (${modelID})`)
  return Option.some<Participant>({ kind: "cli", model, cli: entry.cli, bin })
}
// API participant -- resolve via Provider SDK
const model = yield* provider.getModel(providerID, modelID)
const language = yield* provider.getLanguage(model)
return Option.some<Participant>({ kind: "api", model, language })
```

## Gemini CLI adapter

`callGemini()` in `cli-adapter.ts:83-131`:

```typescript
spawn([
  bin,
  "-p", fullPrompt,                    // Prompt (system + user combined)
  "--output-format", "stream-json",    // NDJSON stream for parsing
  "--approval-mode", "plan",           // Read-only: analyze but don't execute
  "--skip-trust",                      // Skip trust dialog
  "-m", modelId,                       // Model selector
], {
  env: { GEMINI_CLI_TRUST_WORKSPACE: "true" }
})
```

Parses NDJSON stream for events where `type === "message"` and `role === "assistant"`. Accumulates text and calls `onChunk` for live streaming.

**Agent mode** (`callGeminiAgent`): Used during implementation phase. Identical but uses `--approval-mode auto` for full tool access.

## Claude Code adapter

`callClaude()` in `cli-adapter.ts:135-193`:

```typescript
spawn([
  bin,
  "-p", user,                          // User prompt only (system via --system-prompt)
  "--tools", "",                       // No tools during debate (read-only)
  "--output-format", "stream-json",    // Stream JSON for parsing
  "--verbose",                         // Detailed output
  "--model", baseModel,                // Model selector
  "--system-prompt", system,           // System prompt
  "--effort", effort,                  // Reasoning effort (low/medium/high/xhigh/max)
], { stdout: "pipe", stderr: "ignore" })
```

Parses stream for `assistant` events with `message.content` (text blocks). Falls back to `result` event if no assistant events received.

Supports **effort suffixes** in model IDs: `claude-sonnet-4-high` -> `--effort high`, `--model claude-sonnet-4`.

**Agent mode** (`callClaudeAgent`): During implementation, identical but without `--tools ""` restriction.

## Codex CLI adapter

`callCodex()` in `cli-adapter.ts:308-359`:

```typescript
spawn([
  bin,
  "-c", `model_reasoning_effort=${effort}`,  // Reasoning effort config
  "exec",
  fullPrompt,
  "--model", baseModel,
  "--json",                                   // JSON output mode
  "--dangerously-bypass-approvals-and-sandbox",
  "--skip-git-repo-check",
], { stdout: "pipe", stderr: "ignore" })
```

Parses stream for `item.completed` events where `item.type === "agent_message"`. Supports the same effort suffix mechanism as Claude.

## Synthetic model metadata

CLI participants don't have real API model metadata. `cliSyntheticModel()` generates placeholder metadata:

```typescript
{
  id: ModelID.make(modelID),
  providerID: ProviderID.make(providerID),
  name: "Gemini (gemini-2.5-flash)",
  family: "gemini",
  limit: { context: 1000, output: 8192 },   // Conservative defaults
  capabilities: {
    temperature: false,
    reasoning: true,
    attachment: false,
    toolcall: false,
    input: { text: true, ... },
    output: { text: true, ... },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
}
```

## Implementation phase: CLI agent mode

When a CLI participant wins the debate and becomes the implementer, `SessionProcessor.process()` in `processor.ts` detects the `CliParticipant` type and routes to agent-mode:

```typescript
if (implementer.participant.kind === "cli") {
  if (implementer.participant.cli === "gemini") {
    accumulated = await callGeminiAgent(bin, messages, modelId, onChunk)
  } else if (implementer.participant.cli === "codex") {
    accumulated = await callCodex(bin, messages, modelId, onChunk)
  } else {
    accumulated = await callClaudeAgent(bin, messages, modelId, onChunk)
  }
}
```

In agent mode, the CLI has full tool access (no `--tools ""` restriction, `--approval-mode auto` instead of `plan`). The CLI autonomously reads files, writes code, and executes commands.
