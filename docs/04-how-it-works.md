# 4. How It Works

## Full flow: prompt to code

### Step 1: User sends a task

```
User types: "Build an auth system with JWT tokens"
```

The CLI (`packages/opencode/src/index.ts`) parses this via yargs and dispatches to `RunCommand`.

### Step 2: Bootstrap and session creation

`RunCommand` via `src/cli/cmd/run.ts`:
1. Calls `bootstrap()` which initializes the Effect runtime, loads config from all sources, sets up the instance context
2. Creates or resumes a `Session` in SQLite (via the SDK client)
3. Stores the user's prompt as a `MessageV2.User` with parts (text, files, agents, MCP resources)

### Step 3: Team debate (if configured)

`SessionPrompt.Service.prompt()` in `src/session/prompt.ts`:
- Checks if `team.enabled` is set and `team.members` has 2+ entries
- If yes, calls `Team.Service.run()` which:
  1. Resolves team members (CLI detection or API model resolution)
  2. Extracts the user's task from messages
  3. Calls `runBreakingTeams()` -- the core debate orchestrator

### Step 4: The debate itself

`runBreakingTeams()` in `src/team/debate.ts`:

**Phase 0 -- Decision Round**
- All participants receive a prompt asking them to decide if the task needs sub-teams
- Each participant emits a signal: `PROPOSE`, `QUESTION`, `BREAK`, or `PASS`
- `BREAK` signals include: team name, focus area, optional invites to other models
- If more than half vote `BREAK` and at least 2 unique teams are proposed, proceed to Phase 1
- Otherwise, fall back to flat debate (`runDebate()`)

**Phase 1 -- Sub-team Formation**
- `formSubTeams()` groups participants into teams based on their BREAK proposals
- Invites are resolved by fuzzy-name matching
- Solo teams (1 member) are merged into the smallest viable team (2+ members)
- Participants not assigned to any team remain global-only

**Phase 2 -- Main Loop** (repeats up to `maxRounds`)
- Each cycle, sub-teams run internal debate rounds in parallel
- Within a sub-team, members debate using signals: `LEAD`, `SUPPORT`, `ALIGN`, `BUILD`, `CHALLENGE`, `SYNTHESIZE`, `EXTEND`, `PASS`
- After `globalRoundInterval` cycles, a global coordination round occurs where all participants see other teams' summaries and can `BROADCAST` messages
- A sub-team converges when one member has near-unanimous endorsements (everyone else SUPPORTs or ALIGNs them)
- The loop ends when all sub-teams are done and no broadcasts remain

**Phase 3 -- Global Implementer Selection**
- The sub-team with the highest combined endorsement + lead score provides the implementer
- The implementer is the member within that sub-team with the most endorsements and leads

### Step 5: Implementation

`SessionProcessor.process()` in `src/session/processor.ts`:

- If the implementer is a **CLI participant** (Gemini CLI, Claude Code, Codex):
  - Spawns the CLI in agent mode (full tool access, no debate restrictions)
  - Streams JSON events from the subprocess
  - Maps CLI-specific events to standard Conclave message/part format

- If the implementer is an **API participant**:
  - Calls `LLM.stream()` which uses the Vercel AI SDK's `streamText()`
  - The LLM receives the debate thread as context, the original task, and all available tools
  - The LLM reasons, calls tools (read files, run bash, write code), observes results, and continues

### Step 6: Tool execution loop

The processor manages a loop:
1. LLM emits streaming text (displayed to user)
2. LLM requests a tool call (e.g., `read file.ts`)
3. Processor validates parameters, checks permissions
4. Tool executes (e.g., reads the file)
5. Result is fed back to the LLM as context
6. LLM continues reasoning/calling tools until it finishes

### Step 7: Output

Events are published via the `Bus` and rendered in:
- **TUI**: Formatted text, tool outputs, progress indicators (via @opentui/SolidJS)
- **Web**: JSON stream or rendered markdown
- **Server**: HTTP streaming response

### Flow diagram

```
User: "Build auth system"
         |
         v
  CLI bootstrap (yargs)
         |
         v
  Session.prompt()
         |
         v
  [team enabled?]
    YES --> Team.Service.run()
              |
              v
         runBreakingTeams()
              |
    +---------+---------+
    |                   |
  Phase 0           [no BREAK
  Decision           consensus]
  Round + BREAK         |
  votes                 v
    |           runDebate() (flat debate)
    v                   |
  Phase 1           Round 1
  Form Teams        Round 2
    |              (converge?)
    v                   |
  Phase 2           Select winner
  Parallel              |
  Sub-team              v
  Rounds
    |
    v
  Phase 3
  Select global
  implementer
              |
              v
    SessionProcessor.process()
              |
    +---------+---------+
    |                   |
  CLI implementer    API implementer
  (Gemini/Claude/   (streamText via
   Codex subprocess)  Vercel AI SDK)
    |                   |
    +---------+---------+
              |
              v
    LLM reasons -> calls tools -> observes -> repeats
              |
              v
    Final output: code, edits, results
```
