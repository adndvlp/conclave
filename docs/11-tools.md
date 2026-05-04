# 11. Tools

The tool system provides LLMs with capabilities to interact with the file system, execute commands, search code, and more. Each tool is defined in `packages/opencode/src/tool/` and registered via `ToolRegistry`.

## Tool definition

```typescript
type Tool.Def<Params, Metadata> = {
  id: string                              // Unique tool identifier
  description: string                     // What the tool does (shown to LLM)
  parameters: Effect.Schema<Params>        // Parameter validation
  execute(args: Params, ctx: ToolContext): Effect<ExecuteResult>  // Implementation
  formatValidationError?(error: ParseError): string  // Error formatting
}
```

## All tools

### File operations

| Tool | File | Description |
|------|------|-------------|
| `read` | `read.ts` | Read files with offset/limit, supports images and PDFs |
| `write` | `write.ts` | Write (create or overwrite) a file |
| `edit` | `edit.ts` | Apply exact string replacements in files |
| `glob` | `glob.ts` | Fast file pattern matching (e.g., `**/*.ts`) |
| `grep` | `grep.ts` | Content search with regex patterns |
| `apply_patch` | `apply_patch.ts` | Apply unified diff patches to files |

### Execution

| Tool | File | Description |
|------|------|-------------|
| `bash` | `bash.ts` | Execute shell commands in persistent session |

### Web & search

| Tool | File | Description |
|------|------|-------------|
| `webfetch` | `webfetch.ts` | Fetch content from a URL (converts to markdown) |
| `websearch` | `websearch.ts` | Search the web via Exa API |

### Delegation & interaction

| Tool | File | Description |
|------|------|-------------|
| `task` | `task.ts` | Delegate work to subagents (parallel agents) |
| `question` | `question.ts` | Ask the user multiple-choice questions |
| `skill` | `skill.ts` | Load specialized skill instructions |

### Planning & tracking

| Tool | File | Description |
|------|------|-------------|
| `todowrite` | `todo.ts` | Create and manage structured task lists |
| `plan` | `plan.ts` | Enter/exit plan mode |

### Language support

| Tool | File | Description |
|------|------|-------------|
| `lsp` | `lsp.ts` | Language Server Protocol integration |

### Error handling

| Tool | File | Description |
|------|------|-------------|
| `invalid` | `invalid.ts` | Handles malformed/invalid tool calls gracefully |

## Tool execution flow

1. **Parameter validation**: Tool parameters are validated against the Effect Schema
2. **Permission check**: `Permission.ask()` verifies the current agent is allowed to use this tool
3. **Output truncation**: Results are truncated via `Truncate` service (default: 2000 lines / 51200 bytes)
4. **Plugin hooks**: `tool.execute.before` and `tool.execute.after` plugin hooks fire
5. **Result storage**: Results are stored as `MessageV2.ToolPart` with a state machine (pending -> running -> completed/error)

## Key tool details

### Task (subagent delegation)

The `task` tool spawns a new agent session with a specific subagent type (`general` or `explore`). The subagent:
- Gets its own context window
- Has limited tools based on its permission set
- Returns a single result message
- Runs in parallel with other tasks

### Bash

Executes shell commands with:
- Persistent shell session (maintains state between calls)
- PTY (pseudo-terminal) for interactive commands
- Configurable timeout
- Working directory scoped to the project root
- Permission gates for destructive operations

### Read

Supports reading:
- Text files with line offset/limit
- Image files (PNG, JPEG, etc.) as file attachments
- PDF files as file attachments
- Directory listings

### WebFetch

Fetches URLs and converts to markdown. Handles:
- HTTP -> HTTPS upgrade
- Content type detection
- Large content truncation
- Timeout handling

### WebSearch

Uses the Exa API for web search. Returns structured results with titles, URLs, and snippets.
