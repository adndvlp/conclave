# 7. Breaking Teams

Breaking Teams allow LLMs to **autonomously split into sub-teams** for parallel work on complex tasks. This is the most advanced debate mode.

Code: `debate.ts:312-701` (`runBreakingTeams`, `formSubTeams`)

## Why Breaking Teams

Complex tasks often have natural decomposition boundaries:
- A full-stack app has frontend, backend, database concerns
- A refactor spans multiple modules with different requirements
- A migration touches infrastructure, data, and application code

Breaking Teams mirrors how human teams work: divide the problem, work in parallel, coordinate via communication.

## Three phases

### Phase 0: Decision Round

All participants receive a deliberation prompt with `allowBreak: true`. The prompt includes the `BREAK` signal option:

```
BREAK:<team>:<focus>[:<model1>,<model2>]  -- propose a sub-team, optionally invite members
  Ex: BREAK:backend:API and auth:ModelX
  Ex: BREAK:frontend:UI and integration
  Available models to invite: ModelA, ModelB, ModelC
```

Each participant deliberates and emits one signal. The system collects all `BREAK` proposals.

**Fallback condition**: If fewer than half the participants vote `BREAK`, or fewer than 2 unique teams are proposed, the system falls back to flat `runDebate()`.

### Phase 1: Sub-team Formation (`formSubTeams`)

`formSubTeams()` in `debate.ts:321-403`:

1. **Hard cap**: Maximum sub-teams = `floor(participants.length / 2)` (at least 2 per team)
2. **First pass**: Register each proposed team with its proposer
3. **Second pass**: Process invites -- each BREAK signal can invite other models. Invited models are added to the team unless they explicitly picked a different team
4. **Fuzzy name matching**: Invites resolve via case-insensitive substring matching on model names
5. **Solo team merge**: Teams with only 1 member are merged into the smallest viable team (2+ members). If no viable teams exist, solos remain
6. **Unassigned participants**: Stay global-only, participating only in coordination rounds

Returns `SubTeam[]`:

```typescript
type SubTeam = {
  id: string           // "team-0", "team-1", ...
  name: string         // e.g., "backend", "frontend"
  focus: string        // e.g., "API and auth logic"
  memberIDs: string[]  // Model IDs assigned to this team
  thread: string       // Accumulated debate thread
  rounds: number       // Internal rounds completed
  status: "working" | "done" | "blocked"
  crossTeamMessages: CrossTeamMessage[]
}

type CrossTeamMessage = {
  fromTeam: string
  message: string
  globalRound: number
}
```

### Phase 2: Main Loop

Repeats up to `maxRounds` cycles. Each cycle has two parts:

#### Part A: Sub-team internal rounds (parallel)

All sub-teams run their internal debate rounds simultaneously via `Effect.all({ concurrency: "unbounded" })`.

Within each sub-team:
1. Members receive `buildSubTeamPrompt()` -- includes team name, focus, task, thread, cross-team messages
2. Round 1 uses `PROPOSE`/`QUESTION`/`PASS` signals
3. Round 2+ uses `LEAD`/`SUPPORT`/`ALIGN`/`BUILD`/`CHALLENGE`/`SYNTHESIZE`/`EXTEND`/`PASS`
4. Endorsement/lead scoring works identically to flat debate
5. **Convergence**: A sub-team is done when one member has near-unanimous endorsements, or the team has only 1 member

Sub-team threads are truncated to 200 chars per message (to keep context manageable for multi-team coordination).

#### Part B: Global coordination round

Every `globalRoundInterval` cycles (default: every cycle):
1. All participants (including those not in any sub-team) receive `buildGlobalRoundPrompt()`
2. They see:
   - Their own team's summary (last 8 lines of thread)
   - All other teams' summaries
   - The global task
3. They can `BROADCAST` messages or `PASS`
4. `BROADCAST` messages are collected and injected into sub-team threads on the next cycle

**Termination**: All done when every sub-team status is `"done"` AND no broadcasts were sent (all teams passed).

### Phase 3: Global Implementer Selection

After the main loop ends:
1. For each sub-team, calculate `totalScore = sum(endorsements) + sum(leads)`
2. The sub-team with the highest total score provides the implementer
3. Within that sub-team, `selectWinner()` picks the member with best individual score
4. Fallback: if no implementer found, use `participants[0]`

## Progress tracking

The `BreakingProgressCallback` emits real-time state for the TUI/web:

```typescript
type BreakingProgressCallback = (
  subTeams: Array<{
    id: string
    name: string
    status: "working" | "done" | "blocked"
    round: number
    signals: RoundSignal[]
  }>,
  globalRound: number,
) => Effect.Effect<void>
```

This allows the UI to display:
- Per-sub-team progress bars
- Current round number
- Latest signals from each member
- Global coordination round indicator

## Configuration

In `conclave.json`:

```jsonc
{
  "team": {
    "breakingTeams": {
      "maxSubTeams": 3,        // Hard cap on sub-team count
      "globalRoundInterval": 1  // How often global coordination happens
    }
  }
}
```

## Real-time streaming

`onParticipantChunk` in `team.ts:116-149` provides live streaming text during debate rounds with a 250ms debounce:

```typescript
const onParticipantChunk = (modelName, text, round) => {
  participantTexts.set(modelName, { text, round })
  // Debounce: emit at most every 250ms
  if (now - lastChunkEmit < 250) {
    chunkTimeout = setTimeout(flush, 250 - (now - lastChunkEmit))
    return
  }
  flush()
}
```
