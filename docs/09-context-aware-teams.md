# 9. Context-Aware Teams

Context-Aware Teams give each model **visibility into their teammates' capabilities** so they can self-assign roles intelligently instead of blindly competing for the same task.

## Problem

Without capability awareness, all LLMs receive identical debate prompts. This leads to:
- Models with small context windows attempting to analyze entire codebases (overflowing)
- Fast models wasting time on analysis when they should execute
- Slow reasoning models trying to compete on speed
- No specialization or role-based self-organization

## Solution

The deliberation prompt includes each model's profile with concrete metrics, plus self-assignment rules that guide behavior.

## Capability metadata

Extracted from `Provider.Model` in `prompts.ts:14-23`:

```typescript
const teamContext = [self, ...teammates]
  .map((m) =>
    `- ${m.name} (${m.providerID}/${m.id}): context=${m.limit?.context ?? "?"}k, ` +
    `capabilities=${Object.entries(m.capabilities ?? {})
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(", ")}`
  )
  .join("\n")
```

Produces output like:
```
Full team:
- DeepSeek Chat (deepseek/deepseek-chat): context=1000k, capabilities=reasoning
- Gemini Flash (google/gemini-2.5-flash): context=128k, capabilities=temperature,reasoning
- Claude Sonnet (anthropic/claude-sonnet-4-20250514): context=200k, capabilities=temperature,reasoning
```

## Self-assignment rules

Embedded in the system prompt (`prompts.ts:71-75`):

```
Self-assignment rules based on your context:
- If your context window is small, don't try to read the entire codebase.
  Delegate global analysis to a teammate with more context.
- If you're fast, focus on execution. If you have deep reasoning, focus on
  analysis and design.
- If your teammate has more context than you, trust their codebase analysis.
  Don't duplicate it.
- If the task requires deep investigation of a specific file, any model can do it.
```

## Effect on debate dynamics

When models see this information, the debate becomes more efficient:

1. **Large-context models** naturally `LEAD` on tasks requiring full codebase analysis
2. **Fast models** `SUPPORT` execution-oriented proposals or `ALIGN` with the analysis leader
3. **Reasoning models** `CHALLENGE` with specific technical objections rather than vague criticism
4. **Reduced context overflows** -- small-context models don't try to read everything

## Implementation

The context awareness is embedded directly in the prompt builders:
- `buildDeliberationPrompt()` includes full team context with capabilities
- `buildSubTeamPrompt()` includes teammate list with provider/model IDs
- `buildGlobalRoundPrompt()` includes team summaries for coordination

The `Provider.Model` type already has all needed capability fields:
- `limit.context` -- context window size in tokens
- `capabilities` -- object with boolean flags for temperature, reasoning, attachment, toolcall, input/output modalities
