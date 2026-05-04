# 10. Agents

The agent system defines **specialized LLM personas** with different permissions, tools, and behaviors. Agents are managed by `Agent.Service` in `packages/opencode/src/agent/agent.ts` (413 lines).

## Built-in agents

| Agent | Mode | Hidden | Purpose | Key permissions |
|-------|------|--------|---------|-----------------|
| `build` | `primary` | No | Default coding agent | Full access to all tools |
| `plan` | `primary` | No | Planning-only mode | Denies edit/write tools |
| `general` | `subagent` | No | General-purpose subagent (Task tool) | Denies todowrite |
| `explore` | `subagent` | No | Fast codebase exploration | Read-only: read, glob, grep, web fetch/search |
| `compaction` | `subagent` | Yes | Context compaction agent | Deny all tools |
| `title` | `subagent` | Yes | Title generation agent | Minimal tools |
| `summary` | `subagent` | Yes | Summary generation agent | Minimal tools |

## Agent schema

```typescript
Info = Schema.Struct({
  name: Schema.String,           // Display name
  description: Schema.String,    // What this agent does
  mode: Schema.Literal("subagent", "primary", "all"),
  native: Schema.Boolean,        // Built-in vs user-defined
  hidden: Schema.Boolean,        // Hidden from agent picker
  topP: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  color: Schema.optional(Schema.String),  // Display color in TUI
  permission: Permission.Ruleset,          // Tool permission rules
  model: Schema.optional(Schema.Struct({   // Default model override
    modelID: ModelID,
    providerID: ProviderID,
  })),
  variant: Schema.optional(Schema.String), // Model variant
  prompt: Schema.optional(Schema.String),  // Custom system prompt
  options: Schema.optional(Schema.Record(...)), // Provider options
  steps: Schema.optional(Schema.Number),   // Max steps limit
})
```

## Agent modes

- **`primary`**: Can be used as the main session agent. Appears in agent picker.
- **`subagent`**: Only callable via the Task tool (subagent delegation).
- **`all`**: Available in both contexts.

## Custom agents

Users can define custom agents in config:

```jsonc
{
  "agent": {
    "my-reviewer": {
      "name": "Code Reviewer",
      "description": "Reviews code for bugs and style issues",
      "mode": "subagent",
      "native": false,
      "prompt": "You are a strict code reviewer...",
      "permission": {
        "allow": ["read", "grep", "glob"],
        "deny": ["bash", "write", "edit"]
      }
    }
  }
}
```

## Permission system

Each agent has a `permission` ruleset that controls tool access:

```typescript
type Permission.Ruleset = {
  allow?: string[]   // Tool IDs to explicitly allow
  deny?: string[]    // Tool IDs to explicitly deny
  // Default: deny all tools not in allow list
}
```

The `Permission.Service` checks tool calls against the current agent's ruleset before execution.

## Agent generation

`Agent.generate()` can create agent configs from natural language descriptions using AI:

```typescript
generate(description: string): Effect.Effect<Agent.Info>
```

Uses `streamObject()` with a structured output schema to produce agent configuration from a user's description.

## Agent prompts

System prompts are loaded from `.txt` files in `src/session/prompt/` and `src/agent/prompt/`:

| File | Used when |
|------|-----------|
| `build-switch.txt` | Switching from plan to build mode |
| `plan.txt` | Plan mode instructions (5-phase workflow) |
| `max-steps.txt` | Step limit reminders |
| `explore.txt` | Explore agent instructions |
| `compaction.txt` | Context compaction instructions |
| `summary.txt` | Summary generation |
| `title.txt` | Title generation |

## Agent call chain

In `SessionPrompt.prompt()`:
1. Resolve the default agent from config (`config.default_agent` or `"build"`)
2. Get agent info via `Agent.Service.get()`
3. Inject agent-specific system prompt into the LLM request
4. Set permission ruleset on the session
5. LLM calls tools -> permissions checked -> tool executed or blocked
