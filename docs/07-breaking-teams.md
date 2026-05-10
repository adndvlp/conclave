# 7. Breaking Teams

Breaking Teams allow LLMs to **autonomously split into sub-teams** for parallel work on complex tasks. This is the most advanced debate mode.

Code: `debate.ts:~380-700` (`runBreakingTeams`, `formSubTeams`)

## Why Breaking Teams

Complex tasks often have natural decomposition boundaries:
- A full-stack app has frontend, backend, database concerns
- A refactor spans multiple modules with different requirements
- A migration touches infrastructure, data, and application code

Breaking Teams mirrors how human teams work: divide the problem, work in parallel, coordinate via communication.

## Four phases

### Phase 0: Decision Round

All participants receive a deliberation prompt with `allowBreak: true`. The prompt includes the `BREAK` signal option:

```
BREAK:<team>:<focus>[:<model1>,<model2>]  -- propose a sub-team, optionally invite members
  Ex: BREAK:backend:API and auth:ModelX
  Ex: BREAK:frontend:UI and integration
  Available models to invite: ModelA, ModelB, ModelC
```

Each participant deliberates and emits one signal. The system collects all `BREAK` proposals. Participants that **error out** (timeout, rate limit, etc.) are skipped -- their error is recorded in the thread and they're excluded from `activeCount`. The debate can still proceed as long as enough non-errored participants remain.

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
5. **Convergence**: A sub-team is done when one member has near-unanimous endorsements from non-errored members, or the team has only 1 active member
6. **Error handling**: Errored participants are skipped for that round (not removed). `activeCount` excludes errors, so a sub-team can still converge if some members are temporarily unavailable.

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

### Phase 3: Per-Sub-Team Implementer Selection + Concurrent Execution (v1.0.3)

After the main loop ends, **each converged sub-team's implementer runs in parallel** rather than relying on a single global implementer. This is the biggest architectural change in v1.0.3.

#### Step 1: Per-sub-team implementer selection

For each sub-team that converged, `selectWinner()` picks the member with the best individual score (`endorsements * 2 + leads`). These are returned as `subTeamImplementers[]`.

If a sub-team didn't converge, its fallback is the highest-scoring member from that team.

#### Step 2: Concurrent execution (processor)

The session processor (`processor.ts`) executes all sub-team implementers **simultaneously** via `Effect.all({ concurrency: "unbounded" })`:

1. **Text parts created upfront**: Before any task runs, a `type: "text"` part is created per sub-team (e.g., `## backend (Claude Sonnet)`). This enables real-time streaming in the TUI.

2. **Context per implementer**: Each sub-team implementer receives:
   - The sub-team's internal debate thread (last 3000 chars)
   - Sub-team name and focus
   - The full task with previous conversation history

3. **Real-time streaming**: As each implementer generates text, deltas are streamed to the corresponding text part via `updatePartDelta()`, providing live TUI output per sub-team.

#### Step 3: Fallback on failure (v1.0.3)

If a sub-team's implementer **fails** (error, empty output, infinite loop), a **fallback mechanism** kicks in:

1. A fallback participant is selected from the `orderedParticipants` list -- an API participant that wasn't already the failed implementer
2. The fallback receives the full context including:
   - The **failed output** (up to 3000 chars) so it can continue from where it stopped
   - The sub-team's **internal debate thread** (up to 4000 chars) to understand the team's reasoning
   - Clear instructions: "Continue from where the previous implementer failed. Read existing files, fix or complete them."
3. The fallback result is recorded as a text part in the session (`### Fallback: teamName`)
4. If multiple sub-teams fail in parallel, each gets its own fallback participant

#### Step 4: File conflict detection

After all sub-teams finish, the system detects if multiple sub-teams **modified the same files**:

1. `findFileConflicts()` compares file lists from each sub-team's output
2. For each conflicting file, two API participants are selected to **resolve the conflict** by merging both sub-teams' contributions
3. Conflicts are resolved with full context: both sub-teams' outputs are shown to the resolvers

#### Step 5: Check-and-fix loop

After implementation (and conflict resolution), an **automated verification loop** runs:

1. Checks for obvious errors in the output (syntax issues, missing files, incomplete code)
2. If errors are found, re-dispatches to sub-team implementers with the error context
3. Tracks iterations; records results as `### Automated checks: N iteration(s)` in the session
4. Uses fallback participants if original implementers are unavailable

### Fallback: Task breakdown mode

When Breaking Teams doesn't trigger (not enough BREAK votes) but there are **2+ API participants**, the processor can still run concurrent implementation via **task breakdown**:

1. A participant (not involved in execution) generates task subtasks via `generateTaskBreakdown()`
2. Tasks are assigned round-robin to API participants
3. Same fallback, conflict detection, and check-and-fix patterns apply

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

## Real-time streaming (v1.0.3)

Debate participant text is streamed in real-time via **reasoning parts**, the same mechanism used for single-model reasoning blocks. This replaces the previous 250ms-debounced status-based approach.

```typescript
// Per-participant reasoning parts created before the debate starts
for (const p of participants) {
  const partID = PartID.ascending()
  session.updatePart({
    id: partID, messageID, sessionID,
    type: "reasoning",
    text: `### ${p.model.name}\\n`,
  })
}

// Deltas streamed in real-time (no debounce)
const onParticipantChunk = (modelName, text, round) => {
  const pid = participantPartIDs.get(modelName)
  const prevLen = participantPrevLen.get(modelName) ?? 0
  const delta = text.slice(prevLen)
  participantPrevLen.set(modelName, text.length)
  if (delta) {
    bridge.fork(session.updatePartDelta({
      sessionID, messageID, partID: pid, field: "text", delta,
    }))
  }
}
```

### Benefits over the old approach:
- **No debounce lag**: Text appears immediately, not every 250ms
- **Persistent in session**: Reasoning parts are stored in SQLite, so debate history survives reloads
- **TUI-native**: Uses the same collapsible reasoning toggle as single-model mode
- **Delta-based**: Only sends new characters, not the full accumulated text

### Round header

A text part with the current round (`### Debate · Round 1 / 3`) is created above all reasoning toggles, updated as rounds progress.

### Team thread persistence

After the debate finishes, the full team discussion thread is stored as a text part with `metadata: { team_thread: true }`:

```typescript
session.updatePart({
  id: PartID.ascending(), messageID, sessionID,
  type: "text",
  text: `### Team Discussion\\n\\n${debateResult.thread}`,
  metadata: { team_thread: true },
})
```

On the next turn, the processor scans all previous messages for team thread parts and feeds them as `initialThread` into the debate, giving models **full context of prior team discussions** without bloating the main chat window.
