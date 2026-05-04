# 1. Abstract

## What is Conclave

Conclave is an **AI coding assistant** that introduces an experimental **multi-LLM team debate** mechanism. Unlike traditional assistants that rely on a single LLM, Conclave puts multiple language models in structured deliberation rounds using a signal-based protocol (LEAD, SUPPORT, ALIGN, BUILD, CHALLENGE, SYNTHESIZE) to converge on the best solution before implementing code.

It is a **fork of OpenCode** -- an open-source AI coding agent originally by [anomalyco](https://github.com/anomalyco) -- with a research layer on top: the multi-model team debate engine.

## Why it exists

The central hypothesis: **a team of LLMs debating produces better code than a single LLM acting alone**. Individual models carry training biases, domain-specific blind spots, and context window limitations. By making them debate:

1. **Diverse perspectives** -- Different models were trained on different data distributions. Claude excels at reasoning, Gemini at long-code comprehension, DeepSeek at fast generation.
2. **Mutual correction** -- One model can point out errors or limitations in another's proposal (CHALLENGE signal).
3. **Creative synthesis** -- Combining ideas from multiple models produces solutions none would have generated alone (SYNTHESIZE signal).
4. **Self-organization** -- Models self-assign roles based on their capabilities (large context -> global analysis; fast -> execution; strong reasoning -> design).

## Core features explored

- **Multi-LLM team debates** -- Signal-based consensus with minimum 2 rounds
- **Breaking Teams** -- LLMs autonomously split into sub-teams for parallel work
- **CLI Bridging** -- External AI CLIs (Gemini CLI, Claude Code, Codex) as team members
- **Context-Aware Teams** -- Models receive teammates' capability metadata for better self-assignment
- **Persistent teams** -- Multiple named configurations that survive restarts
- **Any provider** -- OpenAI, Anthropic, DeepSeek, Google, NVIDIA, local via Ollama
- **Live reasoning** -- Per-round breakdowns of each model's deliberation

## Project status

Experimental research project. Fork of [OpenCode](https://github.com/anomalyco/opencode). Not recommended for production. Subject to bugs, breaking changes, and undocumented behavior.
