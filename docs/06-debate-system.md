# 6. Debate System

This is the core research contribution of Conclave. The debate engine lives in `packages/opencode/src/team/debate.ts` (~780 lines).

## Signal protocol

Models communicate via structured signals emitted at the end of their messages. Signals are parsed from the last 5 lines of each response using regex patterns.

### Round 1 signals (first impressions)

| Signal | Format | Meaning |
|--------|--------|---------|
| `PROPOSE` | `PROPOSE:<approach>` | Initial proposal for how to solve the task |
| `QUESTION` | `QUESTION:<doubt>` | Needs clarification before proposing |
| `BREAK` | `BREAK:<team>:<focus>[:<model1>,<model2>]` | Propose splitting into sub-teams |
| `PASS` | `PASS` | Nothing to contribute |

### Round 2+ signals (deliberation)

| Signal | Format | Meaning | Scoring effect |
|--------|--------|---------|----------------|
| `LEAD` | `LEAD:<reason>` | Take ownership, lead the implementation | +1 lead |
| `SUPPORT` | `SUPPORT:<target>:<reason>` | Support another model's leadership | +1 endorsement for target |
| `ALIGN` | `ALIGN:<target>:<reason>` | Convinced by another model | +1 endorsement for target |
| `BUILD` | `BUILD:<addition>` | Add something new to what's proposed | None (informational) |
| `CHALLENGE` | `CHALLENGE:<specific point>` | Concrete objection | None (informational) |
| `SYNTHESIZE` | `SYNTHESIZE:<combined ideas>` | Merge proposals into something better | None (informational) |
| `EXTEND` | `EXTEND:<reason>` | Need more debate rounds | Counts toward extension vote |
| `PASS` | `PASS` | Nothing to add | None |

### Global signals (cross-team coordination)

| Signal | Format | Meaning |
|--------|--------|---------|
| `BROADCAST` | `BROADCAST:<message>` | Communicate something to all other teams |
| `PASS` | `PASS` | Nothing to communicate |

## Parsing logic

`parseSignal(text, round, global)` in `debate.ts:58-91`:

1. Takes the last 5 lines of the response text
2. Tries each line (in reverse order) against the appropriate regex pattern
3. Round 1 pattern: `/^(PROPOSE|QUESTION|BREAK|PASS)(?::(.*))?$/`
4. Round 2+ pattern: `/^(LEAD|SUPPORT|ALIGN|BUILD|CHALLENGE|SYNTHESIZE|EXTEND|PASS)(?::(.*))?$/`
5. Global pattern: `/^(BROADCAST|PASS)(?::(.*))?$/`
6. Cleans markdown formatting (`**bold**`, `_italic_`) before matching
7. For `SUPPORT`/`ALIGN`: parses `target:reason` from the payload
8. For `BREAK`: parses `teamName:focus:invite1,invite2` from the payload

## Flat debate (`runDebate`)

`runDebate()` in `debate.ts:~270` -- used when Breaking Teams is disabled or fallback:

```typescript
function* runDebate(
  participants: Participant[],
  task: string,
  initialThread = "",        // Previous debate thread for context (v1.0.3+)
  maxRounds = 3,
  minRounds = 2,
  maxExtensions = 2,
  roundExtension = 1,
  onProgress?: ProgressCallback,
  onParticipantChunk?: Callback,
): DebateResult
```

> **v1.0.3**: `onRoundComplete` callback removed. Debate results are now streamed via reasoning parts (see [07-breaking-teams.md](07-breaking-teams.md) for details).

**Algorithm:**
1. Initialize `endorsements` and `leads` maps (both `Map<modelId, number>`)
2. Thread starts from `initialThread` (previous team discussion, if any)
3. For each round 1..dynamicMax:
   a. Call all participants in parallel (`Effect.all` with `concurrency: "unbounded"`)
   b. Each participant receives:
      - System prompt with their profile, teammates' capabilities, the task, signal instructions
      - Thread history (truncated to 25% of their context window via `buildThreadForModel`)
   c. Parse signals from each response; errored participants are **skipped** and their error recorded in thread
   d. Update scores: LEAD +1 to leads, SUPPORT/ALIGN +1 to target's endorsements
   e. Count EXTEND votes; if majority and `extensions < maxExtensions`, increase `dynamicMax`
   f. Check convergence after `minRounds`: if one model has >= `activeCount - 1` endorsements -> converged
4. If no convergence, select winner by `score = endorsements * 2 + leads`
5. Return `{ implementer, orderedParticipants, converged, rounds, extensions, thread }`

**`orderedParticipants`** (v1.0.3): All participants sorted by final score (highest first). Used by the processor for fallback assignment when the primary implementer fails.

### Thread truncation (`buildThreadForModel`)

- Uses a rough heuristic: 1 token ~ 4 characters
- Keeps thread under 25% of the model's context window
- When truncating, keeps only lines containing signal markers (LEAD, SUPPORT, etc.)
- Falls back to last N signal lines if still too long

### Score ordering (`orderByScore`)

```typescript
function orderByScore(participants, endorsements, leads): Participant[] {
  // Sort by score = endorsements * 2 + leads, descending
}
```

## Winner selection

`selectWinner()` in `debate.ts:113-128`:

```typescript
function selectWinner(participants, endorsements, leads) {
  let best = participants[0]
  let bestScore = -1
  for (const p of participants) {
    const score = (endorsements.get(p.model.id) ?? 0) * 2 + (leads.get(p.model.id) ?? 0)
    if (score > bestScore) { bestScore = score; best = p }
  }
  return best
}
```

Endorsements (others supporting you) are worth double what leads (self-promotion) are worth. This incentivizes building consensus rather than dominating the conversation.

## Participant types

```typescript
type ApiParticipant = {
  kind: "api"
  model: Provider.Model
  language: LanguageModelV3  // Vercel AI SDK model instance
}

type CliParticipant = {
  kind: "cli"
  model: Provider.Model  // Synthetic model metadata
  cli: "gemini" | "claude-code" | "codex"
  bin: string  // Path to the CLI binary
}

type Participant = ApiParticipant | CliParticipant

type ParticipantResult = {
  participant: Participant
  text: string
  signal: Signal | null
  error?: string          // Classified error when call fails
}
```

## `callParticipant` function

Routes to either:
- **CLI path**: `callGemini()`, `callClaude()`, or `callCodex()` -- spawns subprocess, parses JSON stream
- **API path**: `streamText()` via Vercel AI SDK with `temperature: 0.2`, `maxOutputTokens: 1024`

Both paths accumulate text and call `onChunk` for live streaming. The final accumulated text is parsed for signals.

### Error handling and timeout

Each participant call has a **60-second timeout** (`DEBATE_PARTICIPANT_TIMEOUT`). The SDK has `maxRetries: 0` -- internal retries are disabled to avoid abandoned streams on 429 responses that corrupt the TUI. The debate runner handles failures gracefully.

Errors are classified via `errorDescription()` into categories:

| Error class | Pattern | Meaning |
|-------------|---------|---------|
| `timeout` | `AbortError` | Participant didn't respond in 60s |
| `rate_limited` | `rate limit`, `429`, `too many requests` | API quota exhausted |
| `server_error` | `503`, `502`, `overloaded`, `server error` | Provider infrastructure issue |
| `context_limit` | `context window`, `token limit`, `too long` | Input exceeds model capacity |
| `quota_exceeded` | `insufficient quota`, `billing` | Account quota exhausted |
| `auth_error` | `401`, `403`, `unauthorized` | Authentication failure |
| *(fallback)* | Any other error | Raw message trimmed to 80 chars |

## Convergence rules

The debate converges when:
1. `round >= minRounds` (minimum 2 rounds by default)
2. One model has `endorsements >= activeCount - 1` (near-unanimous support from non-errored participants)
3. Or if `activeCount === 1 && endorsements >= 1` (solo survivor after errors)

If these conditions are never met, the winner is selected by score after all rounds.

Models that error out during a round are **skipped for that round** (not removed from the team), and their error is recorded in the thread as `[ModelName ERROR: rate_limited]`. The `activeCount` is recalculated each round to handle transient failures.

## Extension mechanism

Models can vote to extend the debate:
- Signal `EXTEND` counts as a vote for more rounds
- If `EXTEND votes > participants.length / 2` AND `extensions < maxExtensions`:
  - `dynamicMax` increases by `roundExtension` (1 by default)
- This prevents premature convergence on complex tasks

## Prompt construction

`buildDeliberationPrompt()` in `prompts.ts:5-92` builds the system prompt for each participant:

```
You are <modelName>, part of a team of models solving a coding task.

Your profile:
- Provider: <providerID>
- Context window: <contextSize>k tokens
- Capabilities: <capabilityList>

Full team:
- ModelA (provider/id): context=Xk, capabilities=a,b,c
- ModelB (provider/id): context=Yk, capabilities=d,e,f

TASK: <user's task>

The goal is the best solution. No ego -- build on others' ideas, challenge with concrete reason.
You can assume a role if useful. The team self-organizes.

Self-assignment rules based on your context:
- If your context window is small, don't try to read the entire codebase. Delegate global analysis to a teammate with more context.
- If you're fast, focus on execution. If you have deep reasoning, focus on analysis and design.
- If your teammate has more context than you, trust their codebase analysis. Don't duplicate it.
- If the task requires deep investigation of a specific file, any model can do it.

---
Round X/Y -- [first impression | full team thread].
Emit EXACTLY ONE signal at the end of your message:
[Signal instructions specific to round type]
```

## Breaking Teams result types (v1.0.3)

`runBreakingTeams()` returns additional fields used by the concurrent implementation system:

```typescript
type SubTeamImplementer = {
  subTeamId: string       // e.g., "team-0"
  subTeamName: string     // e.g., "backend"
  focus: string           // e.g., "API and auth"
  thread: string          // Internal debate thread (for context)
  implementer: Participant // Selected per-sub-team implementer
  memberIDs: string[]     // Model IDs in this sub-team
}

type BreakingTeamsResult = {
  implementer: Participant          // Global winner (legacy, for CLI path)
  subTeamImplementers: SubTeamImplementer[]  // Per-sub-team implementers (v1.0.3)
  orderedParticipants: Participant[]        // All participants sorted by score
  converged: boolean
  globalRounds: number
  subTeams: SubTeam[]
  crossTeamMessages: CrossTeamMessage[]
  thread: string
}

type DebateResult = {
  implementer: Participant
  orderedParticipants: Participant[]  // v1.0.3: sorted by score
  converged: boolean
  rounds: number
  extensions: number
  thread: string
}
```

The `subTeamImplementers` array enables **concurrent implementation** in the session processor -- see [07-breaking-teams.md](07-breaking-teams.md) for details.
