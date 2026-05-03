import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "./message-v2"

export function usable(input: { cfg: Config.Info; model: Provider.Model }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  const output = ProviderTransform.maxOutputTokens(input.model)
  // Reserve enough for a full output response, capped at 70% of context
  const reserved = input.cfg.compaction?.reserved ?? Math.min(output + 2000, context * 0.7)
  const base = input.model.limit.input ?? context
  // Always leave at least 30% of context usable
  return Math.max(base - reserved, context * 0.3)
}

export function isOverflow(input: { cfg: Config.Info; tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  const count =
    input.tokens.total || input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
  return count >= usable(input)
}
