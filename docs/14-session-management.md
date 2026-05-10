# 14. Session Management

Sessions are the core unit of conversation persistence. Each user interaction creates or continues a session, which stores the full message history, tool calls, and metadata.

Code: `packages/opencode/src/session/`

## Data model

### Session

```typescript
type Session = {
  id: SessionID          // UUID
  slug: string           // Human-readable slug
  projectID: string      // Project this session belongs to
  workspaceID?: string
  directory: string      // Working directory
  path?: string          // Session file path
  parentID?: SessionID   // For forked sessions
  summary?: {            // Aggregated diff summary
    additions: number
    deletions: number
    files: number
    diffs?: string[]
  }
  share?: { url: string }
  title: string
  version: number
  time: {
    created: number
    updated: number
    compacting?: number
    archived?: number
  }
  permission?: Permission.Ruleset
  revert?: {             // Revert state
    messageID: number
    partID?: number
    snapshot?: string
    diff?: string
  }
}
```

### Messages (MessageV2)

Messages belong to a session and have roles:

```typescript
type MessageV2 = {
  id: number
  sessionID: SessionID
  role: "user" | "assistant"
  parentID?: number          // For branching/forks
  time: { created: number }
  status: "pending" | "streaming" | "completed" | "error"
}
```

### Parts

Each message contains parts:

| Part type | Description |
|-----------|-------------|
| `TextPart` | Text content (may be synthetic or ignored) |
| `ToolPart` | Tool calls with state machine: pending -> running -> completed/error |
| `ReasoningPart` | Thinking/reasoning blocks (for models with reasoning) |
| `FilePart` | File attachments |
| `StepStartPart` / `StepFinishPart` | Snapshot delimiters |
| `PatchPart` | File diffs |
| `SubtaskPart` | Subagent delegation markers |
| `CompactionPart` | Context compaction markers |

## Persistence: SQLite via Drizzle ORM

Database schema defined in `session.sql.ts`, `message.sql.ts`, `part.sql.ts`:

```sql
-- Key tables
session
  id TEXT PRIMARY KEY
  slug TEXT NOT NULL
  project_id TEXT NOT NULL
  directory TEXT
  title TEXT
  created_at INTEGER NOT NULL
  updated_at INTEGER NOT NULL
  -- ...

message
  id INTEGER PRIMARY KEY AUTOINCREMENT
  session_id TEXT NOT NULL REFERENCES session(id)
  role TEXT NOT NULL
  parent_id INTEGER REFERENCES message(id)
  created_at INTEGER NOT NULL
  -- ...

part
  id TEXT PRIMARY KEY
  message_id INTEGER NOT NULL REFERENCES message(id)
  session_id TEXT NOT NULL REFERENCES session(id)
  type TEXT NOT NULL       -- 'text', 'tool', 'reasoning', 'file', etc.
  content TEXT
  metadata TEXT            -- JSON blob
  -- ...
```

## Session lifecycle

1. **Creation**: `Session.create()` inserts a new session row
2. **Prompting**: `SessionPrompt.prompt()` adds user message, triggers processing
3. **Processing**: `SessionProcessor.process()` manages the LLM-tool loop
4. **Compaction**: When context overflows, `SessionCompaction` summarizes older messages
5. **Forking**: Sessions can be forked to create branches
6. **Sharing**: Sessions can be shared via URL (stored in `share` field)
7. **Archival**: Sessions can be archived (`time.archived`)
8. **Reversion**: Sessions support reverting to previous message states

## Streaming

`SessionProcessor.process()` in `processor.ts` (~1050 lines) handles real-time LLM streaming:

1. **text-start / text-delta / text-end**: Text content streaming
2. **tool-call**: LLM requests tool execution (state: pending)
3. **tool-result**: Tool execution completes (state: completed/error)
4. **reasoning-start/delta/end**: Thinking/reasoning blocks
5. **start-step / finish-step**: Snapshot boundaries
6. **error**: Error events with retry logic

### Team streaming (v1.0.3)

In team mode, debate participant text streams via **reasoning parts** (same mechanism as single-model reasoning). Each team member gets a dedicated reasoning part with real-time delta streaming. A round header text part shows current round progress. After the debate, the team discussion thread is persisted as a text part with `metadata: { team_thread: true }`, enabling subsequent turns to access prior debate context.

### Concurrent team implementation (v1.0.3)

When sub-teams exist, the processor runs all sub-team implementers **in parallel** via `Effect.all({ concurrency: "unbounded" })`:

- **Pre-created text parts**: Each sub-team gets a text part before execution starts, enabling real-time TUI output
- **Streaming deltas**: `updatePartDelta()` streams live output per sub-team
- **Fallback**: If an implementer fails, another `orderedParticipant` takes over with full failed-output context
- **Conflict detection**: `findFileConflicts()` detects files modified by multiple sub-teams; API participants resolve conflicts
- **Check-and-fix**: `checkAndFixLoop()` validates output and retries with error context
- **SDK control via bridge**: `EffectBridge` bridges Effect fibers with Promise-based callbacks

## Doom loop detection

The processor detects when the LLM falls into a loop -- 3 consecutive identical tool calls -- and breaks the cycle:

```typescript
const DOOM_LOOP_THRESHOLD = 3
```

## Retry logic

`SessionRetry` handles LLM failures:
- Network errors: retry with backoff
- Model overload: retry with different model or wait
- Token limit: trigger compaction and retry

## Compaction

`SessionCompaction` manages context window limits:
- **Auto compaction**: Triggered when message history exceeds model context
- **Pruning**: Removes or summarizes oldest messages
- **Summary injection**: Adds a compacted summary of what was removed

### Team mode behavior (v1.0.3)

Compaction is **disabled in team mode**. The debate engine handles per-model context via `buildThreadForModel()`, which truncates the debate thread to 25% of each model's context window. Team thread parts (`metadata: { team_thread: true }`) are preserved across compaction, ensuring previous debate context survives message pruning. Summary generation is also disabled for team-mode turns to avoid losing deliberation details.

## Key service files

| File | Purpose |
|------|---------|
| `session.ts` | Session CRUD, data types, SQLite schema |
| `prompt.ts` | Prompt orchestration, team integration, title generation |
| `processor.ts` | LLM streaming loop, tool execution, doom loop detection |
| `llm.ts` | Vercel AI SDK wrapper, streamText() configuration |
| `system.ts` | System prompt selection per model provider |
| `retry.ts` | Retry logic for LLM failures |
| `overflow.ts` | Context overflow detection |
| `compaction.ts` | Context compaction/summarization |
| `status.ts` | Session status tracking (idle, busy, team.breaking) |
| `summary.ts` | Diff/change summary generation |
| `message-v2.ts` | Message and part data types |
