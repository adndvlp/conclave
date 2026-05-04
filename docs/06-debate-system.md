# 6. Debate System

This is the core research contribution of Conclave. The debate engine lives in `packages/opencode/src/team/debate.ts` (701 lines).

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

`runDebate()` in `debate.ts:211-310` -- used when Breaking Teams is disabled or fallback:

```typescript
function* runDebate(
  participants: Participant[],
  task: string,
  maxRounds = 3,
  minRounds = 2,
  maxExtensions = 2,
  roundExtension = 1,
  onProgress?: ProgressCallback,
  onRoundComplete?: Callback,
  onParticipantChunk?: Callback,
): DebateResult
```

**Algorithm:**
1. Initialize `endorsements` and `leads` maps (both `Map<modelId, number>`)
2. For each round 1..dynamicMax:
   a. Call all participants in parallel (`Effect.all` with `concurrency: "unbounded"`)
   b. Each participant receives:
      - System prompt with their profile, teammates' capabilities, the task, signal instructions
      - Thread history (truncated to 25% of their context window via `buildThreadForModel`)
   c. Parse signals from each response
   d. Update scores: LEAD +1 to leads, SUPPORT/ALIGN +1 to target's endorsements
   e. Count EXTEND votes; if majority and `extensions < maxExtensions`, increase `dynamicMax`
   f. Check convergence after `minRounds`: if one model has >= `participants.length - 1` endorsements -> converged
3. If no convergence, select winner by `selectWinner()`: `endorsements * 2 + leads`

**Thread truncation** (`buildThreadForModel`, line 192-209):
- Uses a rough heuristic: 1 token ~ 4 characters
- Keeps thread under 25% of the model's context window
- When truncating, keeps only lines containing signal markers (LEAD, SUPPORT, etc.)
- Falls back to last N signal lines if still too long

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
```

## `callParticipant` function

Routes to either:
- **CLI path**: `callGemini()`, `callClaude()`, or `callCodex()` -- spawns subprocess, parses JSON stream
- **API path**: `streamText()` via Vercel AI SDK with `temperature: 0.2`, `maxOutputTokens: 1024`

Both paths accumulate text and call `onChunk` for live streaming. The final accumulated text is parsed for signals.

## Convergence rules

The debate converges when:
1. `round >= minRounds` (minimum 2 rounds by default)
2. One model has `endorsements >= participants.length - 1` (near-unanimous support)

If these conditions are never met, the winner is selected by score after all rounds.

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
