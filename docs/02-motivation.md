# 2. Motivation

## The single-LLM problem

When you ask a single LLM to write code, you get exactly one perspective. That perspective is shaped by:

- **Training data biases** -- Models trained on GitHub lack exposure to proprietary patterns, legacy codebases, or domain-specific conventions.
- **Context window limits** -- Even 1M-token models lose fidelity on large codebases; important details get truncated.
- **Overconfidence** -- LLMs rarely express uncertainty. They produce authoritative-sounding wrong answers with equal confidence as correct ones.
- **Single-path reasoning** -- One model, one chain of thought. No cross-examination, no devil's advocate, no second opinion.
- **Architectural blind spots** -- Some models are great at algorithms but weak at system design, or great at frontend but weak at backend.

## Why debate helps

Multi-agent debate attacks these problems from multiple angles simultaneously:

### 1. Diversity as defense

Different model families have different strengths. Putting them together means:
- A model with 1M context reads the full codebase
- A fast model prototypes the implementation
- A reasoning-heavy model validates correctness
- A creative model suggests alternative approaches

### 2. Structured disagreement

The signal protocol enforces concrete criticism:
- `CHALLENGE:<specific point>` forces specific objections, not vague "needs more analysis"
- `SYNTHESIZE:<combine ideas of X and Y>` produces hybrids neither model would have made alone
- `SUPPORT:<name>:<reason>` requires concrete arguments, not blind agreement

### 3. Convergence mechanics

The endorsement scoring system (`endorsements * 2 + leads`) naturally selects the model that:
- Others trust (high support)
- Takes initiative (high leads)
- Produces the most convincing proposal

### 4. Breaking Teams scaling

For complex tasks, models can self-organize into sub-teams that work in parallel:
- Frontend team works on UI components
- Backend team works on API and logic
- Infrastructure team works on deployment and config

This mirrors how human engineering teams work.

## Evidence from the literature

Multi-agent debate has been studied academically:

- **Du et al. (2023)** "Improving Factuality and Reasoning in Language Models through Multiagent Debate" -- showed that debate between LLM instances improves truthfulness and reasoning accuracy.
- **Li et al. (2023)** "ChatEval: Towards Better LLM-based Evaluators through Multi-Agent Debate" -- debate between LLMs improves evaluation quality.
- **Chan et al. (2024)** "ChatDEV: Communicative Agents for Software Development" -- a multi-agent chat system for software development showed promise for collaborative coding.

Conclave applies these ideas specifically to code generation, with a structured protocol designed for engineering tasks.
