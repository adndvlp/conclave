import { spawn } from "@/util/process"
import type { Provider } from "@/provider/provider"
import type { ModelMessage } from "ai"
import { ProviderID, ModelID } from "@/provider/schema"

// ─── CLI types ────────────────────────────────────────────────────────────────

export type CliType = "gemini" | "claude-code" | "codex"

export const CLI_BIN: Record<CliType, string> = {
  "gemini": "gemini",
  "claude-code": "claude",
  "codex": "codex",
}

export const CLI_PROVIDER_IDS = new Set(["cli-gemini", "cli-claude", "cli-codex"])

// ─── Synthetic model metadata ─────────────────────────────────────────────────

export function cliSyntheticModel(providerID: string, modelID: string, displayName: string): Provider.Model {
  return {
    id: ModelID.make(modelID),
    providerID: ProviderID.make(providerID),
    name: displayName,
    family: providerID.replace("cli-", ""),
    api: { id: modelID, url: "", npm: "" },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 1000, output: 8192 },
    capabilities: {
      temperature: false,
      reasoning: false,
      attachment: false,
      toolcall: false,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: {},
  }
}

// ─── Detection ────────────────────────────────────────────────────────────────

export async function detectCli(binName: string): Promise<string | null> {
  const { run } = await import("@/util/process")
  try {
    const result = await run(["which", binName], { nothrow: true })
    const path = result.stdout.toString().trim()
    return path || null
  } catch {
    return null
  }
}

// ─── Prompt building ──────────────────────────────────────────────────────────

export function buildCliPrompt(messages: ModelMessage[]): { system: string; user: string } {
  let system = ""
  let user = ""
  for (const msg of messages) {
    if (msg.role === "system") {
      system = typeof msg.content === "string" ? msg.content : ""
    } else if (msg.role === "user") {
      if (typeof msg.content === "string") {
        user = msg.content
      } else if (Array.isArray(msg.content)) {
        user = (msg.content as any[])
          .filter((p) => p.type === "text")
          .map((p) => p.text as string)
          .join("")
      }
    }
  }
  return { system, user }
}

// ─── Gemini CLI ───────────────────────────────────────────────────────────────

export async function callGemini(
  bin: string,
  messages: ModelMessage[],
  modelId: string,
  onChunk?: (accumulated: string) => void,
): Promise<string> {
  const { system, user } = buildCliPrompt(messages)
  const fullPrompt = system ? `${system}\n\n${user}` : user

  const proc = spawn(
    [
      bin,
      "-p", fullPrompt,
      "--output-format", "stream-json",
      "--approval-mode", "plan",
      "--skip-trust",
      "-m", modelId,
    ],
    {
      stdout: "pipe",
      stderr: "ignore",
      env: { GEMINI_CLI_TRUST_WORKSPACE: "true" },
    },
  )

  if (!proc.stdout) throw new Error("gemini: no stdout")

  let accumulated = ""
  let buf = ""

  for await (const rawChunk of proc.stdout) {
    buf += (rawChunk as Buffer).toString()
    const lines = buf.split("\n")
    buf = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (event.type === "message" && event.role === "assistant" && typeof event.content === "string") {
          accumulated += event.content
          onChunk?.(accumulated)
        }
      } catch {}
    }
  }

  await proc.exited
  return accumulated
}

// ─── Claude Code CLI ──────────────────────────────────────────────────────────

export async function callClaude(
  bin: string,
  messages: ModelMessage[],
  modelId?: string,
  onChunk?: (accumulated: string) => void,
): Promise<string> {
  const { system, user } = buildCliPrompt(messages)

  const args: string[] = [
    "-p", user,
    "--tools", "",
    "--bare",
    "--output-format", "stream-json",
    "--verbose",
  ]
  if (system) args.push("--system-prompt", system)
  const effortMatch = modelId?.match(/-([a-z]+)$/)
  if (effortMatch && ["low", "medium", "high", "xhigh", "max"].includes(effortMatch[1])) {
    args.push("--effort", effortMatch[1])
  }

  const proc = spawn([bin, ...args], { stdout: "pipe", stderr: "ignore" })

  if (!proc.stdout) throw new Error("claude: no stdout")

  let accumulated = ""
  let buf = ""

  for await (const rawChunk of proc.stdout) {
    buf += (rawChunk as Buffer).toString()
    const lines = buf.split("\n")
    buf = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (event.type === "assistant" && Array.isArray(event.message?.content)) {
          const text = (event.message.content as any[])
            .filter((p) => p.type === "text")
            .map((p) => p.text as string)
            .join("")
          if (text) {
            accumulated += text
            onChunk?.(accumulated)
          }
        } else if (event.type === "result" && typeof event.result === "string" && !accumulated) {
          // Fallback: use final result field if no assistant events received
          accumulated = event.result
          onChunk?.(accumulated)
        }
      } catch {}
    }
  }

  await proc.exited
  return accumulated
}

// ─── Agent-mode CLI (implementation phase) ───────────────────────────────────
// These variants run the CLI with full tool access (no debate restrictions).

export async function callGeminiAgent(
  bin: string,
  messages: ModelMessage[],
  modelId: string,
  onChunk?: (accumulated: string) => void,
): Promise<string> {
  const { system, user } = buildCliPrompt(messages)
  const fullPrompt = system ? `${system}\n\n${user}` : user

  const proc = spawn(
    [
      bin,
      "-p", fullPrompt,
      "--output-format", "stream-json",
      "--approval-mode", "auto",
      "-m", modelId,
    ],
    {
      stdout: "pipe",
      stderr: "ignore",
      env: { GEMINI_CLI_TRUST_WORKSPACE: "true" },
    },
  )

  if (!proc.stdout) throw new Error("gemini: no stdout")

  let accumulated = ""
  let buf = ""

  for await (const rawChunk of proc.stdout) {
    buf += (rawChunk as Buffer).toString()
    const lines = buf.split("\n")
    buf = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (event.type === "message" && event.role === "assistant" && typeof event.content === "string") {
          accumulated += event.content
          onChunk?.(accumulated)
        }
      } catch {}
    }
  }

  await proc.exited
  return accumulated
}

export async function callClaudeAgent(
  bin: string,
  messages: ModelMessage[],
  modelId?: string,
  onChunk?: (accumulated: string) => void,
): Promise<string> {
  const { system, user } = buildCliPrompt(messages)

  const args: string[] = [
    "-p", user,
    "--output-format", "stream-json",
    "--verbose",
  ]
  if (system) args.push("--system-prompt", system)
  const effortMatch = modelId?.match(/-([a-z]+)$/)
  if (effortMatch && ["low", "medium", "high", "xhigh", "max"].includes(effortMatch[1])) {
    args.push("--effort", effortMatch[1])
  }

  const proc = spawn([bin, ...args], { stdout: "pipe", stderr: "ignore" })

  if (!proc.stdout) throw new Error("claude: no stdout")

  let accumulated = ""
  let buf = ""

  for await (const rawChunk of proc.stdout) {
    buf += (rawChunk as Buffer).toString()
    const lines = buf.split("\n")
    buf = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (event.type === "assistant" && Array.isArray(event.message?.content)) {
          const text = (event.message.content as any[])
            .filter((p) => p.type === "text")
            .map((p) => p.text as string)
            .join("")
          if (text) {
            accumulated += text
            onChunk?.(accumulated)
          }
        } else if (event.type === "result" && typeof event.result === "string" && !accumulated) {
          accumulated = event.result
          onChunk?.(accumulated)
        }
      } catch {}
    }
  }

  await proc.exited
  return accumulated
}

// ─── Codex CLI ────────────────────────────────────────────────────────────────
// codex exec "prompt" [--model id]  → plain text on stdout; progress on stderr

export async function callCodex(
  bin: string,
  messages: ModelMessage[],
  modelId: string,
  onChunk?: (accumulated: string) => void,
): Promise<string> {
  const { system, user } = buildCliPrompt(messages)
  const fullPrompt = system ? `${system}\n\n${user}` : user

  const effortMatch = modelId?.match(/-([a-z]+)$/)
  const validEfforts = ["low", "medium", "high", "xhigh"]
  const effort = effortMatch && validEfforts.includes(effortMatch[1]) ? effortMatch[1] : null
  const baseModel = effort ? modelId.replace(/-[a-z]+$/, "") : modelId

  const args: string[] = []
  if (effort) args.push("-c", `model_reasoning_effort=${effort}`)
  args.push("exec", fullPrompt, "--model", baseModel)

  const proc = spawn([bin, ...args], { stdout: "pipe", stderr: "ignore" })

  if (!proc.stdout) throw new Error("codex: no stdout")

  let accumulated = ""

  for await (const rawChunk of proc.stdout) {
    const text = (rawChunk as Buffer).toString()
    accumulated += text
    onChunk?.(accumulated)
  }

  await proc.exited
  return accumulated.trim()
}
