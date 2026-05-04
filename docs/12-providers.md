# 12. Providers & Models

The provider system manages AI model access across 20+ providers via the Vercel AI SDK. Code in `packages/opencode/src/provider/`.

## Model data types

```typescript
type Model = {
  id: ModelID                          // Branded string, e.g., "gpt-5"
  providerID: ProviderID               // Branded string, e.g., "openai"
  name: string                         // Human-readable, e.g., "GPT-5"
  family: string                       // Model family, e.g., "gpt"
  api: { id: string; url: string; npm: string }
  status: "active" | "deprecated" | "preview"
  headers: Record<string, string>      // Custom HTTP headers
  options: Record<string, any>         // Provider-specific options
  cost: {
    input: number                      // Per 1M tokens
    output: number
    cache: { read: number; write: number }
    experimentalOver200K?: number
  }
  limit: {
    context: number                    // Max input tokens
    input?: number
    output: number                     // Max output tokens
  }
  capabilities: {
    temperature: boolean
    reasoning: boolean
    attachment: boolean
    toolcall: boolean
    input: { text, audio, image, video, pdf: boolean }
    output: { text, audio, image, video, pdf: boolean }
    interleaved: boolean
  }
  release_date: string
  variants: Record<string, Model>      // Model variants (e.g., reasoning effort)
}
```

## Model discovery

Models are fetched from `https://models.dev/api.json` and cached for 5 minutes in `~/.cache/opencode/models.json`. A build-time snapshot (`models-snapshot.js`) serves as fallback.

## Bundled provider SDKs (22 providers)

| Provider | SDK | Key features |
|----------|-----|-------------|
| OpenAI | `@ai-sdk/openai` | GPT-5 uses `responses()` API; older uses `chat()` |
| Anthropic | `@ai-sdk/anthropic` | Interleaved thinking beta, fine-grained tool streaming |
| Google | `@ai-sdk/google` | Gemini models via Generative AI SDK |
| Google Vertex | `@ai-sdk/google-vertex` | Enterprise Gemini + Vertex Anthropic |
| Azure | `@ai-sdk/azure` | Resource name resolution, Azure auth |
| Amazon Bedrock | `@ai-sdk/amazon-bedrock` | Cross-region inference, AWS credentials |
| xAI | `@ai-sdk/xai` | Grok models |
| Mistral | `@ai-sdk/mistral` | Mistral models |
| Groq | `@ai-sdk/groq` | Ultra-fast inference (LPU hardware) |
| DeepInfra | `@ai-sdk/deepinfra` | Open-source model hosting |
| Cerebras | `@ai-sdk/cerebras` | Wafer-scale inference |
| Cohere | `@ai-sdk/cohere` | Command models |
| TogetherAI | `@ai-sdk/togetherai` | Open-source model hosting |
| Perplexity | `@ai-sdk/perplexity` | Web-search-aware models |
| Vercel | `@ai-sdk/vercel` | Vercel AI Gateway |
| Alibaba | `@ai-sdk/alibaba` | Qwen models |
| OpenRouter | `@openrouter/ai-sdk-provider` | Multi-provider gateway (200+ models) |
| GitLab | `gitlab-ai-provider` | GitLab Duo |
| GitHub Copilot | `./sdk/copilot/copilot-provider` | Custom adapter for Copilot API |
| Venice | `venice-ai-sdk-provider` | Privacy-focused AI |
| Gateway | `@ai-sdk/gateway` | Generic AI gateway |
| OpenAI Compatible | `@ai-sdk/openai-compatible` | Self-hosted / Ollama / custom endpoints |

## Custom provider loaders

In `provider.ts:141`, special handling for providers that need custom logic:

```typescript
function custom(dep: CustomDep): Record<string, CustomLoader> {
  return {
    anthropic: () => ({
      autoload: false,
      options: {
        headers: {
          "anthropic-beta": "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
        },
      },
    }),
    openai: () => ({
      autoload: true,
      getModel: async (sdk, modelID, options) => {
        if (shouldUseCopilotResponsesApi(modelID)) {
          return sdk.responses(modelID, options)  // Newer responses API
        }
        return sdk.chat(modelID, options)          // Older chat API
      },
    }),
    azure: () => ({ /* Custom resource name resolution */ }),
    "amazon-bedrock": () => ({ /* AWS region + credential chain */ }),
    // ...
  }
}
```

## Protocol selection

`shouldUseCopilotResponsesApi()` checks if a model should use the newer OpenAI `responses()` API vs `chat()`:

```typescript
function shouldUseCopilotResponsesApi(modelID: string): boolean {
  const match = /^gpt-(\d+)/.exec(modelID)
  if (!match) return false
  return Number(match[1]) >= 5 && !modelID.startsWith("gpt-5-mini")
}
```

GPT-5 and above use `responses()`; GPT-4 and below use `chat()`.

## Auth

Provider authentication is managed by `Auth.Service`:
- API keys from config, environment variables, or keychain
- OAuth for providers that support it (GitHub Copilot, Google)
- Custom auth flows per provider

## System prompts per model family

`src/session/system.ts` selects the right system prompt based on model ID patterns:

| Pattern match | Prompt file |
|---------------|-------------|
| `claude`, `anthropic` | `anthropic.txt` |
| `gpt-5`, `o3`, `o1` | `beast.txt` (advanced models) |
| `gpt-4`, `gpt-3` | `gpt.txt` |
| `codex` | `codex.txt` |
| `gemini` | `gemini.txt` |
| `kimi`, `moonshot` | `kimi.txt` |
| Default | `default.txt` |
