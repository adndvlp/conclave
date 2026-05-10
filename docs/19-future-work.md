# 19. Future Work

This document combines future work ideas from the codebase specs, README, and natural extensions of the current system.

## Debate improvements

### Error resilience (v1.0.3 additions)
- ~~Graceful degradation on provider failure~~ → **✅ v1.0.3**: Errored participants are skipped per-round; `activeCount` recalculates convergence threshold
- ~~Participant timeout~~ → **✅ v1.0.3**: 60s timeout per participant via `AbortSignal.timeout()` + `AbortSignal.any()`
- **Continuous health scoring**: Assign reliability scores based on historical error rates
- **Pre-debate health check**: Ping all providers before starting a debate round

### Signal protocol enhancements
- **Confidence scoring**: Models could include confidence levels with signals (SUPPORT:X:0.85:reason)
- **Weighted voting**: Older/more experienced models could have weighted endorsements
- **Structured output enforcement**: Use AI SDK structured output to guarantee signal format compliance
- **Fallback signals**: Automatically detect implicit agreement/disagreement when explicit signals are missing

### Convergence optimization
- **Early exit**: Skip a model in the next round if it already converged (SUPPORT or ALIGN to the winner)
- **Adaptive rounds**: Auto-adjust maxRounds based on convergence speed in previous rounds
- ~~Dynamic participant set~~ → **Partially (v1.0.3)**: Errored participants are excluded from `activeCount` but not permanently removed

### Better deliberation
- **Longer responses**: Increase maxOutputTokens for complex tasks, with progressive disclosure
- **Multi-signal support**: Allow models to emit multiple signals (e.g., SUPPORT + BUILD)
- **Thread summarization**: Instead of truncating, summarize previous rounds for models with small contexts

## Breaking Teams enhancements

### Cross-team communication
- **Request-response protocol**: Teams can ask specific questions and get answers (not just BROADCAST)
- **Contract negotiation**: Teams define APIs, types, and schemas between themselves
- **Dependency tracking**: If Team A needs Team B's output, Team B gets priority scheduling

### Team formation
- **Benchmark-based auto-assignment**: Use known model capabilities to suggest team compositions
- **User-guided formation**: Let users manually assign models to sub-teams
- **Historical learning**: Remember which team compositions worked well for similar tasks

### Editing coordination
- ~~File-level locking~~ → **✅ v1.0.3**: Sub-teams run concurrently; `findFileConflicts()` detects overlapping edits and API participants resolve them
- ~~Automatic merge~~ → **✅ v1.0.3**: Conflict resolution merges non-conflicting changes from parallel sub-teams
- ~~Conflict resolution~~ → **✅ v1.0.3**: Conflicts are detected and escalated to API participant resolvers with full context

## CLI bridging

### Gemini CLI improvements
- **Persistent process**: Keep CLI alive between rounds to avoid spawn overhead
- **PTY integration**: Use node-pty for richer interaction (already available in codebase)
- **Streaming output**: Parse streaming output for live reasoning display

### New CLI support
- **Copilot CLI**: GitHub Copilot's CLI tool
- **Local models**: Ollama, LM Studio, llama.cpp
- **Competitor tools**: Cursor, Windsurf, Aider as team members

## Team management

### Persistent team configs
- Named team configurations that persist across sessions
- Team templates (pre-configured model combinations)
- Team sharing (export/import team configs)

### Dynamic teams
- Auto-select the best team composition for a given task
- Swap out underperforming models mid-debate
- Add/remove team members dynamically

## Provider & model

### Provider health monitoring
- ~~Track provider latency and error rates~~ → **✅ v1.0.3**: `errorDescription()` classifies errors (rate_limited, server_error, timeout, etc.)
- ~~Automatic failover to alternative providers~~ → **✅ v1.0.3**: Fallback participants take over when primary implementer fails; `orderedParticipants` provides ranked fallback list
- Cost estimation before debate starts

### Local model support
- First-class Ollama integration
- Local model capability detection
- Hybrid teams (local + cloud models)

## Analytics & observability

### Debate metrics
- Per-round convergence speed
- Model contribution scores (who leads most, who supports most)
- Signal distribution analysis (do some models only PASS?)

### Cost tracking
- Token usage per debate
- Cost per provider per session
- Cost comparison: team debate vs single model

### Quality metrics
- Compare code quality with and without debate
- Track user corrections after debate vs single model
- A/B testing framework for debate configurations

## UX improvements

### Better progress visualization
- ~~Real-time debate round visualization in TUI and web~~ → **✅ v1.0.3**: Reasoning parts stream per-participant debate text in real-time
- Sub-team progress as a tree/dag
- ~~Per-model reasoning snippets during debate~~ → **✅ v1.0.3**: Each participant has a dedicated reasoning part with live delta streaming

### Configuration UX
- Guided team setup wizard
- Visual team composition builder
- Cost estimation during team creation

## Research questions

Open questions the project aims to explore:
1. What is the optimal team size for different task types?
2. Does model diversity (different providers) matter more than model quality?
3. Is there an optimal mix of fast vs slow models in a team?
4. Do breaking teams improve quality for complex tasks, or does the communication overhead negate the benefit?
5. How does the signal protocol affect model behavior compared to free-form deliberation?
6. Can the debate thread itself be used as training data for better single-model performance?
