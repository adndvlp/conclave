<p align="center">
  <h1>⚡ Conclave</h1>
</p>
<p align="center"><strong>Multi-LLM collaborative coding agent.</strong></p>
<p align="center">
  <a href="https://github.com/adndvlp/conclave/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/adndvlp/conclave/publish.yml?style=flat-square&branch=main" /></a>
  <a href="https://github.com/adndvlp/conclave"><img alt="GitHub" src="https://img.shields.io/github/stars/adndvlp/conclave?style=flat-square" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-%238b0000?style=flat-square" /></a>
</p>

---

Configure a team of AI models, and they deliberate in structured rounds — proposing, challenging, and building on each other's ideas — before the winner implements the solution.

### Installation

```bash
curl -fsSL https://raw.githubusercontent.com/adndvlp/conclave/main/install.sh | bash
```

Or from source:

```bash
git clone https://github.com/adndvlp/conclave.git && cd conclave
bun install
bun run dev
```

### How It Works

1. **You ask** — "Build an auth system"
2. **Team debates** — Models deliberate in parallel rounds with LEAD, SUPPORT, ALIGN, BUILD, CHALLENGE signals
3. **Converges** — Winner selected by endorsement score, not context window size
4. **Implements** — Winner generates the production code

```
Conclave 1 (2 models)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Team debating · Round 1/3
  DeepSeek V4 Flash: LEAD — Best fit for auth logic
  GLM-5.1: SUPPORT:DeepSeek — Agreed, backend expert
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Converged — DeepSeek V4 Flash implements
```

### Key Features

- **Multi-LLM team debates** — signal-based consensus with minimum 2 rounds
- **Breaking Teams** — LLMs autonomously split into sub-teams for parallel work
- **Persistent teams** — multiple named configurations that survive restarts
- **Any provider** — OpenAI, Anthropic, DeepSeek, Google, NVIDIA, local via Ollama
- **Live reasoning** — per-round breakdowns of each model's deliberation
- **Config isolation** — uses `~/.config/conclave/`, never touches your OpenCode config

### Usage

```
/connect    — connect AI providers with API keys
/team       — create and configure teams of models
/models     — switch to individual model mode
```

### Upstream

Conclave is a fork of [OpenCode](https://github.com/anomalyco/opencode). To sync upstream changes:

```bash
git remote add upstream https://github.com/anomalyco/opencode.git
git fetch upstream
git merge upstream/main
```

### License

MIT — see [LICENSE](LICENSE). Based on OpenCode by [anomalyco](https://github.com/anomalyco).
