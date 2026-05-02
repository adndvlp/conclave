# CLI Bridging — External AI Agents as Team Members

## Vision

Conclave team members currently require API keys and use `generateText()` via the AI SDK. This limits adoption — users without API keys can't form teams.

The idea: treat external AI CLIs (Claude Code, Gemini CLI, Codex, Copilot CLI) as **persistent subprocesses** that act as team members. Each CLI runs once, stays alive across debate rounds, and communicates via stdin/stdout.

## Target CLIs

| CLI                | Free Tier            | Non-interactive                           | Output Format | Priority   |
| ------------------ | -------------------- | ----------------------------------------- | ------------- | ---------- | ---------------------------------------- |
| **Gemini CLI**     | 60 req/min, 1000/day | `gemini -p "prompt" --output-format json` | JSON stream   | 🔴 Highest |
| **Claude Code**    | Requires sub         | `claude -p "prompt"`                      | Plain text    | 🟡 Medium  |
| **Codex (OpenAI)** | Pay-as-you-go        | `codex exec "prompt"`                     | Plain text    | 🟢 Lower   | // dudo que no se pueda con susbcripción |
| **GitHub Copilot** | With sub             | Already integrated via provider           | API           | ✅ Done    |

## Architecture

### Current Flow

```
Team debate round
  → provider.getLanguage(model)
  → generateText({ model, messages })
  → parseSignal(result.text)
```

### Proposed Flow

```
Team debate round
  → cliAdapter.write(prompt)
  → cliAdapter.read() until signal found
  → parseSignal(result)
```

### Key Component: CliAdapter

```ts
interface CliAdapter {
  profile: ModelProfile // name, strengths, limitations
  spawn(): Promise<void> // start persistent CLI process
  deliberate(prompt: string): Promise<AgentResponse>
  execute(task: string): Promise<string>
  cleanup(): Promise<void>
}
```

### Process Lifecycle

```
Session Start
  ├─ spawn() all CLI processes (once, not per round)
  │
  Round 1
  ├─ adapter.deliberate(prompt_round1) → parallel writes
  ├─ read responses → parse signals
  │
  Round 2
  ├─ adapter.deliberate(prompt_round2) → same process, new prompt
  ├─ read responses → parse signals
  │
  Session End
  └─ cleanup() → kill all processes
```

## Research Tasks

### Phase 1: Gemini CLI Deep Dive (2-3 hours)

1. **Non-interactive mode testing**
   - Test `gemini -p "prompt" --output-format json` with debate-style prompts
   - Can it emit structured signals (LEAD, SUPPORT, etc.)?
   - What's the response latency?
   - Does it handle multi-turn context?

2. **Process persistence**
   - Can Gemini CLI stay open between prompts?
   - Or does `-p` mode spawn a new process each time?
   - If per-request: measure spawn overhead
   - Explore `gemini` interactive mode with programmatic stdin

3. **Rate limits in practice**
   - 60 req/min, 1000/day — enough for 2-3 model teams?
   - Does the free tier allow concurrent requests?
   - Are there burst limits?

4. **Authentication flow**
   - `gcloud auth` or browser OAuth
   - Can it be pre-authenticated for headless/CI?
   - Token persistence between sessions

### Phase 2: Claude Code Deep Dive (2-3 hours)

1. **Non-interactive mode**
   - Test `claude -p "prompt"` with debate prompts
   - What's the response format? Plain text or structured?
   - Can it be constrained to emit specific signals?
   - `--output-format json` equivalent?

2. **Process persistence**
   - Does `claude` support persistent session?
   - Can we write to stdin and read stdout programmatically?
   - `claude --resume` for continuing sessions?

3. **Agent SDK**
   - Explore `@anthropic-ai/claude-code` Agent SDK
   - Can it be used as a library instead of subprocess?
   - SDK vs CLI tradeoffs

4. **Team/Multi-agent mode**
   - Claude Code already has sub-agents
   - Can we leverage this for team debates?
   - Or should Conclave orchestrate externally?

### Phase 3: PTY Integration (2-3 hours)

Conclave already uses `node-pty` for terminal emulation. Extend it for CLI spawning:

1. **Persistent PTY session**
   - Spawn CLI in a PTY
   - Write prompts to stdin
   - Read responses from stdout with signal detection
   - Handle multi-line responses and streaming

2. **Signal extraction**
   - Parse CLI output for LEAD, SUPPORT, ALIGN, etc. signals
   - Handle cases where CLI doesn't follow signal format
   - Fallback: wrap output in a prompt asking for structured response

3. **Timeout and error handling**
   - What if a CLI hangs?
   - What if authentication expires mid-session?
   - Restart strategy for crashed processes

### Phase 4: Integration Architecture (2-3 hours)

1. **Team.ts changes**
   - Add `CliParticipant` type alongside `Participant`
   - Resolve CLI members (detect installed, validate auth)
   - Route to CLI adapter vs API adapter based on provider type

2. **Provider detection**
   - Auto-detect installed CLIs (`which gemini`, `which claude`)
   - Check versions and capabilities
   - Configure automatically when detected

3. **Configuration**
   - Team config should support CLI members:
     ```json
     {
       "members": [
         { "providerID": "cli-gemini", "modelID": "gemini-2.5-flash" },
         { "providerID": "cli-claude", "modelID": "claude-sonnet-4" },
         { "providerID": "deepseek", "modelID": "deepseek-chat" }
       ]
     }
     ```
   - Mix of CLI and API providers in same team

## Priority: Gemini CLI First

Why Gemini CLI as the first implementation:

1. **Free tier** — solves the "no API key" problem immediately
2. **150K stars** — widely available
3. **JSON output** — structured parsing easier
4. **NPM package** — installs anywhere with `npx`
5. **60 req/min** — enough for team debates

## Open Questions

1. Can CLI processes handle concurrent writes? (multiple rounds need parallel prompts)
2. How to handle streaming output for "live reasoning" if CLI doesn't stream?
3. Should CLI members use the same signal format or a simplified one?
4. How to pass codebase context to CLI members? (they need file access)
5. Can we enforce security boundaries? (CLI might execute arbitrary commands)

## Next Steps

1. **Manual test**: Run `gemini -p` with a debate prompt, check if it emits structured signals
2. **Latency benchmark**: Compare API latency vs CLI latency
3. **PTY prototype**: Spawn `gemini` in a node-pty, write/read programmatically
4. **Integration spike**: Modify `team.ts` to support one CLI member alongside API members
