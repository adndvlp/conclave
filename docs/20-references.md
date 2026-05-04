# 20. References

## Academic papers

### Multi-agent debate
- **Du, Y., Li, S., Torralba, A., Tenenbaum, J., & Mordatch, I. (2023)**
  "Improving Factuality and Reasoning in Language Models through Multiagent Debate"
  arXiv:2305.14325
  Showed that debate between multiple LLM instances improves truthfulness and reasoning accuracy across several benchmarks.

- **Li, R., Patel, T., & Du, X. (2023)**
  "ChatEval: Towards Better LLM-based Evaluators through Multi-Agent Debate"
  arXiv:2308.07201
  Demonstrated that multi-agent debate improves the quality of LLM-based evaluation, providing a foundation for peer-review approaches.

- **Chan, C. M., Chen, W., Su, Y., Yu, J., Xue, W., Zhang, S., Fu, J., & Liu, Z. (2024)**
  "ChatDEV: Communicative Agents for Software Development"
  arXiv:2307.07924
  Proposed a multi-agent chat system for software development where agents assume roles like CEO, CTO, programmer, and reviewer.

### LLM reasoning
- **Wei, J., Wang, X., Schuurmans, D., Bosma, M., Ichter, B., Xia, F., Chi, E., Le, Q., & Zhou, D. (2022)**
  "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models"
  NeurIPS 2022
  Foundational work on structured reasoning through prompting, which informs the deliberation prompt design.

- **Wang, X., Wei, J., Schuurmans, D., Le, Q., Chi, E., Narang, S., Chowdhery, A., & Zhou, D. (2023)**
  "Self-Consistency Improves Chain of Thought Reasoning in Language Models"
  ICLR 2023
  Showed that sampling multiple reasoning paths and taking a majority vote improves accuracy -- related to the multi-model consensus approach.

### AI coding agents
- **Yang, J., Jimenez, C. E., Wettig, A., Yao, S., Lieret, K., & Narasimhan, K. (2024)**
  "SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering"
  Proposed agent-computer interfaces for software engineering tasks, informing tool design.

- **Jimenez, C. E., Yang, J., Wettig, A., Yao, S., Pei, K., Press, O., & Narasimhan, K. (2024)**
  "SWE-bench: Can Language Models Resolve Real-World GitHub Issues?"
  ICLR 2024
  Benchmark for evaluating LLM performance on real software engineering tasks.

## Projects

### OpenCode (upstream)
- **Repository**: `github.com/anomalyco/opencode`
- Conclave is a fork of OpenCode. OpenCode provides the foundation: CLI, TUI, agent system, tool system, provider integrations, and Effect-TS architecture.

### Vercel AI SDK
- **Repository**: `github.com/vercel/ai`
- The `ai` package (v6.0.168) provides `streamText()`, `generateObject()`, and provider adapters that Conclave uses for all API-based LLM calls.

### Effect-TS
- **Repository**: `github.com/Effect-TS/effect`
- Functional effect system for TypeScript. Conclave uses v4.0.0-beta.57 for dependency injection, error handling, tracing, and structured concurrency.

## AI CLI tools integrated

| Tool | Repository | Notes |
|------|-----------|-------|
| Gemini CLI | `github.com/google-gemini/gemini-cli` | Free tier: 60 req/min, 1000/day |
| Claude Code | Anthropic (via npm `@anthropic-ai/claude-code`) | Subscription-based |
| Codex CLI | OpenAI (via npm `@openai/codex`) | Pay-as-you-go |

## Related concepts

- **Mixture of Agents (MoA)**: An approach where multiple models' outputs are combined by a final aggregator model. Conclave differs by using structured debate and endorsement scoring instead of aggregation.
- **Ensemble methods**: In ML, combining multiple models' predictions. Conclave applies this concept to code generation via deliberation.
- **Collective intelligence**: The idea that groups can outperform individuals. Conclave tests this for LLMs on software engineering tasks.

## Specifications

Internal specs that shaped the design:

| Spec | File |
|------|------|
| Breaking Teams | `.conclave/specs/breaking-teams.md` |
| CLI Bridging | `.conclave/specs/cli-bridging.md` |
| Context-Aware Teams | `.conclave/specs/context-aware-teams.md` |
| Effect Migration | `packages/opencode/specs/effect/migration.md` |
| V2 Architecture | `packages/opencode/specs/v2/` |
| Message Shape | `packages/opencode/specs/message-shape.md` |
| TUI Plugins | `packages/opencode/specs/tui-plugins.md` |
