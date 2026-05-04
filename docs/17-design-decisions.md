# 17. Design Decisions

## Why debate, not voting

Voting (each model picks an answer, majority wins) is simpler but loses all deliberation. Models do not explain their reasoning, do not challenge each other's assumptions, and do not synthesize hybrid solutions.

Debate with structured signals forces:
- Concrete arguments: SUPPORT requires a reason, not just agreement
- Specific objections: CHALLENGE requires a specific point, not vague criticism
- Hybrid solutions: SYNTHESIZE combines ideas into something better

The endorsement scoring system (endorsements * 2 + leads) rewards being supported by others over self-promotion, incentivizing consensus-building over dominance.

## Why signals vs natural language analysis

Signal parsing (regex on last 5 lines of text) was chosen over:
- **LLM-as-judge**: Would require another API call per round, adding latency and cost
- **Structured output**: Vercel AI SDK tools/structured output are per-model; signals need to work across CLI participants too
- **Semantic analysis**: Too unreliable for concrete decision-making

Regex parsing is simple, fast, and works regardless of whether the participant is an API model or a CLI subprocess.

## Why `maxOutputTokens: 1024` for debate

Debate responses are deliberately kept short (1024 tokens). Models are prompted to emit exactly one signal at the end. Long responses waste tokens on prose when the signal is what matters for convergence.

## Why `temperature: 0.2` for debate

Low temperature keeps responses focused and deterministic. The diversity comes from different models, not from randomness within a single model.

## Why endorsement weighting (2:1 ratio)

Endorsements are worth double what leads are worth because:
- Self-promotion (LEAD) costs nothing and can be gamed
- Being endorsed by others (SUPPORT/ALIGN) requires convincing someone else
- The 2:1 ratio emerged from experimentation; other ratios were not tested

## Why Breaking Teams over single flat debate

For complex tasks, a flat debate forces all models to context-switch across unrelated concerns (frontend, backend, database, etc.). Breaking Teams lets models specialize and work in parallel, which:
- Reduces context fragmentation (each team only sees its own focus)
- Increases parallelism (sub-teams debate simultaneously)
- Produces more focused implementations

## Why CLI bridging over API-only

API keys are a barrier to adoption. Many developers have:
- Gemini CLI installed (free tier: 60 req/min, 1000/day)
- Claude Code subscription (comes with API access)
- Codex CLI (OpenAI pay-as-you-go)

Letting these CLIs participate removes the API key requirement for forming teams.

## Why no fine-tuning

Fine-tuning would require:
- A dataset of successful debates and implementations (does not exist yet)
- Ongoing retraining as models improve
- Model-specific fine-tuning (does not transfer between providers)

The prompt-based approach is model-agnostic and works with any LLM that can follow signal instructions.

## Why Effect-TS for the core

Effect-TS was inherited from OpenCode and provides:
- Type-safe dependency injection (no global state, testable)
- Structured error handling (no try/catch ambiguity)
- Built-in tracing and observability
- Structured concurrency (fiber-based, scoped, interruptible)

## Why SQLite via Drizzle

- Zero-setup local storage
- No server process needed (embedded)
- Drizzle provides type-safe queries with migration support
- Sufficient for single-user CLI tool

## Why not a sandbox

The permission system is a UX feature, not a security boundary. The tool can run arbitrary shell commands. Users who need isolation should run Conclave inside Docker or a VM.

## Trade-offs summary

| Decision | Benefit | Cost |
|----------|---------|------|
| Debate over voting | Higher quality solutions | 2-3x more API calls per task |
| Signal protocol | Deterministic, model-agnostic | Requires prompt engineering per model |
| Short debate responses | Fast rounds, low token cost | Less nuanced deliberation |
| Low temperature | Consistent results | Less creative exploration |
| CLI bridging | No API key needed | Slower, less reliable than API |
| No fine-tuning | Works with any model | Relies entirely on prompt quality |
| Effect-TS | Type-safe, testable | Steep learning curve for contributors |
| SQLite | Zero setup | Not suitable for multi-user server |
