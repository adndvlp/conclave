import { Cause, Deferred, Effect, Layer, Context, Scope, Option } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Snapshot } from "@/snapshot"
import * as Session from "./session"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { isOverflow } from "./overflow"
import { PartID } from "./schema"
import type { SessionID } from "./schema"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { SessionSummary } from "./summary"
import type { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { errorMessage } from "@/util/error"
import * as Log from "@opencode-ai/core/util/log"
import { isRecord } from "@/util/record"
import { Team } from "@/team"
import { CLI_PROVIDER_IDS, callGeminiAgent, callClaudeAgent, callCodex } from "@/team/cli-adapter"
import type { CliParticipant, ApiParticipant, Participant } from "@/team/debate"
import { buildThreadForModel } from "@/team/debate"
import { EffectBridge } from "@/effect/bridge"
import { streamText, generateText } from "ai"
import { existsSync } from "fs"
import { run } from "@/util/process"

const CONCURRENT_TASK_TIMEOUT = 90_000
const TASK_BREAKDOWN_TOKENS = 512
const MAX_CHECK_ITERATIONS = 3
const RATE_LIMIT_BACKOFF = [2000, 5000, 10_000]

const DOOM_LOOP_THRESHOLD = 3
const log = Log.create({ service: "session.processor" })

type ImplResult = { modelName: string; teamName: string; output: string; files: string[]; implementer: ApiParticipant | CliParticipant; error?: string }

async function resolveConflicts(
  p1: ApiParticipant, p2: ApiParticipant, conflictedFiles: string[],
  theirOutputs: string, task: string, tools: Record<string, any>,
): Promise<string> {
  const signal = AbortSignal.timeout(60_000)
  try {
    const result = streamText({
      model: p1.language, tools, temperature: 0.2, maxSteps: 10, abortSignal: signal,
      messages: [
        { role: "system", content: `Resolve conflicts in: ${conflictedFiles.join(", ")}. Merge the best parts.` },
        { role: "user", content: `TASK: ${task.slice(0, 1000)}\n\nIMPLEMENTATIONS:\n${theirOutputs.slice(0, 6000)}\n\nResolve conflicts in: ${conflictedFiles.join(", ")}. Use tools to write the resolved files.` },
      ],
    } as any)
    let output = ""
    for await (const part of result.fullStream as AsyncIterable<any>) {
      if (part.type === "text-delta") output += part.text
      if (part.type === "tool-call") output += `\n[TOOL: ${part.toolName}]\n`
      if (part.type === "tool-result") output += `\n[DONE: ${part.toolName}]\n`
    }
    return output
  } catch (err) { return `Conflict resolution error: ${errorMessage(err)}` }
}

function findFileConflicts(allResults: Array<{ modelName: string; teamName: string; files: string[] }>) {
  const fileTeams = new Map<string, Set<string>>()
  for (const r of allResults) for (const f of r.files) {
    if (!fileTeams.has(f)) fileTeams.set(f, new Set())
    fileTeams.get(f)!.add(r.teamName)
  }
  return [...fileTeams.entries()].filter(([, t]) => t.size > 1).map(([f, t]) => ({ file: f, teams: [...t] }))
}

async function generateTaskBreakdown(winner: ApiParticipant, thread: string, task: string, teamNames: string[]): Promise<string[]> {
  const modelNames = teamNames.join(", ")
  const prompt = `Decompose into 2-4 independent subtasks targeting DIFFERENT files. JSON array.\nDEBATE: ${thread.slice(-5000)}\nTASK: ${task.slice(0, 2000)}\nTeam: ${modelNames}\nJSON:`
  const signal = AbortSignal.timeout(30_000)
  try {
    const result = await generateText({ model: winner.language as any, messages: [{ role: "user", content: prompt }] as any, maxOutputTokens: TASK_BREAKDOWN_TOKENS, temperature: 0.1, abortSignal: signal })
    const text = result.text.trim()
    const m = text.match(/\[[\s\S]*\]/)
    if (m) { const p = JSON.parse(m[0]); if (Array.isArray(p)) return p.filter((t): t is string => typeof t === "string" && t.length > 0) }
    return []
  } catch { return [] }
}

async function runTaskImplementer(
  p: ApiParticipant, task: string, teamLabel: string, debateThread: string, tools: Record<string, any>,
  onChunk?: (chunk: string) => void,
): Promise<ImplResult> {
  // Trim debate thread to this model's context window (25% like the debate does)
  const contextLimit = p.model.limit?.context ?? 128000
  const trimmedThread = buildThreadForModel(debateThread, contextLimit)
  let lastError = ""
  for (let attempt = 0; attempt <= RATE_LIMIT_BACKOFF.length; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, RATE_LIMIT_BACKOFF[attempt - 1]))
      const signal = AbortSignal.timeout(CONCURRENT_TASK_TIMEOUT)
      const result = streamText({
        model: p.language, tools, temperature: 0.2, maxSteps: 15, abortSignal: signal,
        messages: [
          { role: "system", content: `You are ${p.model.name}. Implement using tools.` },
          { role: "user", content: `${task}\n\nContext: ${trimmedThread.slice(-3000)}${lastError ? `\n\nFix: ${lastError}` : ""}` },
        ],
      } as any)
      let output = ""
      const files = new Set<string>()
      for await (const part of result.fullStream as AsyncIterable<any>) {
        if (part.type === "text-delta") {
          output += part.text
          onChunk?.(part.text)
        }
        if (part.type === "tool-call") output += `\n[TOOL: ${part.toolName}]\n${JSON.stringify(part.input, null, 2)}\n`
        if (part.type === "tool-result") {
          output += `\n[DONE: ${part.toolName}]\n${JSON.stringify(part.output).slice(0, 300)}\n`
          if (part.toolName === "write" || part.toolName === "edit") {
            const inp = part.input as any
            const fp = inp?.filePath || inp?.path || inp?.file
            if (fp) files.add(fp)
          }
        }
      }
      return { modelName: p.model.name, teamName: teamLabel, output, files: [...files], implementer: p }
    } catch (err) {
      const msg = errorMessage(err)
      if (/rate.limit|429|too many requests/i.test(msg) && attempt < RATE_LIMIT_BACKOFF.length) { lastError = `Rate limited (attempt ${attempt + 1})`; continue }
      return { modelName: p.model.name, teamName: teamLabel, output: `Error: ${msg}`, files: [], implementer: p, error: msg }
    }
  }
  return { modelName: p.model.name, teamName: teamLabel, output: `Error: ${lastError}`, files: [], implementer: p, error: lastError }
}

async function detectCheckCommand(): Promise<string | null> {
  if (existsSync("tsconfig.json")) return "npx tsc --noEmit"
  if (existsSync("package.json")) {
    try { const pkg = JSON.parse(await Bun.file("package.json").text()); if (pkg.scripts?.typecheck) return `npx ${pkg.scripts.typecheck}`; if (pkg.scripts?.lint) return `npx ${pkg.scripts.lint}` } catch {}
  }
  if (existsSync("Cargo.toml")) return "cargo check"
  if (existsSync("go.mod")) return "go build ./..."
  return null
}

async function runProjectCheck(): Promise<{ passed: boolean; errors: string; errorFiles: string[] }> {
  const cmdStr = await detectCheckCommand()
  if (!cmdStr) return { passed: true, errors: "", errorFiles: [] }
  try { await run(cmdStr.split(" "), { timeout: 45_000 }); return { passed: true, errors: "", errorFiles: [] } }
  catch (err: any) {
    const stderr = err?.stderr ? Buffer.from(err.stderr).toString() : ""
    const stdout = err?.stdout ? Buffer.from(err.stdout).toString() : ""
    return { passed: false, errors: stderr || stdout || String(err), errorFiles: parseErrorFiles(stderr || stdout || String(err)) }
  }
}

function parseErrorFiles(checkOutput: string): string[] {
  const files = new Set<string>()
  const p = /^(.+?)\(\d+,\d+\):/gm
  let m; while ((m = p.exec(checkOutput)) !== null) files.add(m[1].trim())
  if (files.size === 0) { const bp = /([^\s:"]+\.(?:ts|tsx|js|jsx|py|rs|go|java|rb|php|sql|yaml|yml|json|md|html|css|toml))\s*:/gi; let bm; while ((bm = bp.exec(checkOutput)) !== null) files.add(bm[1].trim()) }
  return [...files]
}

async function checkAndFixLoop(
  results: ImplResult[], debateThread: string, taskStr: string, tools: Record<string, any>,
  fallbackImpl: Map<string, ApiParticipant>,
): Promise<{ results: ImplResult[]; iterations: number; lastErrors: string }> {
  let lastErrors = ""
  let iteration = 0
  for (iteration = 1; iteration <= MAX_CHECK_ITERATIONS; iteration++) {
    const check = await runProjectCheck()
    if (check.passed) break
    if (check.errorFiles.length === 0) break
    lastErrors = check.errors
    const fixTargets = new Map<string, ImplResult>()
    for (const ef of check.errorFiles) {
      for (const r of results) {
        if (r.files.some((f) => f.endsWith(ef) || ef.endsWith(f.split("/").pop()!))) fixTargets.set(r.teamName, r)
      }
    }
    if (fixTargets.size === 0) break
    const fixes = await Promise.all([...fixTargets.values()].map((r) => {
      let impl: ApiParticipant | null = r.implementer.kind === "api" ? r.implementer : null
      if (r.error) impl = fallbackImpl.get(r.teamName) ?? null
      if (!impl) return Promise.resolve({ ...r, output: `${r.output}\n(No implementer for fix)`, files: r.files })
      const fixCtx = `PREVIOUS ATTEMPT${r.error ? ` (FAILED: ${r.error})` : ""}:\n${r.output.slice(0, 3000)}\n\nCHECK ERRORS:\n${check.errors.slice(0, 3000)}\n\nFix all errors. Read files, understand what was done, and complete or correct.`
      return runTaskImplementer(impl, fixCtx, `${r.teamName} (fix #${iteration})`, debateThread, tools)
    }))
    for (const fix of fixes) { const idx = results.findIndex((r) => r.teamName === fix.teamName); if (idx >= 0) results[idx] = fix }
  }
  return { results, iterations: iteration - 1, lastErrors }
}

export type Result = "compact" | "stop" | "continue"

export type Event = LLM.Event

export interface Handle {
  readonly message: MessageV2.Assistant
  readonly updateToolCall: (
    toolCallID: string,
    update: (part: MessageV2.ToolPart) => MessageV2.ToolPart,
  ) => Effect.Effect<MessageV2.ToolPart | undefined>
  readonly completeToolCall: (
    toolCallID: string,
    output: {
      title: string
      metadata: Record<string, any>
      output: string
      attachments?: MessageV2.FilePart[]
    },
  ) => Effect.Effect<void>
  readonly process: (streamInput: LLM.StreamInput) => Effect.Effect<Result>
}

type Input = {
  assistantMessage: MessageV2.Assistant
  sessionID: SessionID
  model: Provider.Model
}

export interface Interface {
  readonly create: (input: Input) => Effect.Effect<Handle>
}

type ToolCall = {
  partID: MessageV2.ToolPart["id"]
  messageID: MessageV2.ToolPart["messageID"]
  sessionID: MessageV2.ToolPart["sessionID"]
  done: Deferred.Deferred<void>
}

interface ProcessorContext extends Input {
  toolcalls: Record<string, ToolCall>
  shouldBreak: boolean
  snapshot: string | undefined
  blocked: boolean
  needsCompaction: boolean
  currentText: MessageV2.TextPart | undefined
  reasoningMap: Record<string, MessageV2.ReasoningPart>
}

type StreamEvent = Event

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionProcessor") {}

export const layer: Layer.Layer<
  Service,
  never,
  | Session.Service
  | Config.Service
  | Bus.Service
  | Snapshot.Service
  | Agent.Service
  | LLM.Service
  | Permission.Service
  | Plugin.Service
  | SessionSummary.Service
  | SessionStatus.Service
  | Team.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const config = yield* Config.Service
    const bus = yield* Bus.Service
    const snapshot = yield* Snapshot.Service
    const agents = yield* Agent.Service
    const llm = yield* LLM.Service
    const permission = yield* Permission.Service
    const plugin = yield* Plugin.Service
    const summary = yield* SessionSummary.Service
    const scope = yield* Scope.Scope
    const status = yield* SessionStatus.Service
    const team = yield* Team.Service

    const create = Effect.fn("SessionProcessor.create")(function* (input: Input) {
      // Pre-capture snapshot before the LLM stream starts. The AI SDK
      // may execute tools internally before emitting start-step events,
      // so capturing inside the event handler can be too late.
      const initialSnapshot = yield* snapshot.track()
      const ctx: ProcessorContext = {
        assistantMessage: input.assistantMessage,
        sessionID: input.sessionID,
        model: input.model,
        toolcalls: {},
        shouldBreak: false,
        snapshot: initialSnapshot,
        blocked: false,
        needsCompaction: false,
        currentText: undefined,
        reasoningMap: {},
      }
      let aborted = false
      const slog = log.clone().tag("session.id", input.sessionID).tag("messageID", input.assistantMessage.id)

      const parse = (e: unknown) =>
        MessageV2.fromError(e, {
          providerID: input.model.providerID,
          aborted,
        })

      const settleToolCall = Effect.fn("SessionProcessor.settleToolCall")(function* (toolCallID: string) {
        const done = ctx.toolcalls[toolCallID]?.done
        delete ctx.toolcalls[toolCallID]
        if (done) yield* Deferred.succeed(done, undefined).pipe(Effect.ignore)
      })

      const readToolCall = Effect.fn("SessionProcessor.readToolCall")(function* (toolCallID: string) {
        const call = ctx.toolcalls[toolCallID]
        if (!call) return
        const part = yield* session.getPart({
          partID: call.partID,
          messageID: call.messageID,
          sessionID: call.sessionID,
        })
        if (!part || part.type !== "tool") {
          delete ctx.toolcalls[toolCallID]
          return
        }
        return { call, part }
      })

      const updateToolCall = Effect.fn("SessionProcessor.updateToolCall")(function* (
        toolCallID: string,
        update: (part: MessageV2.ToolPart) => MessageV2.ToolPart,
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match) return
        const part = yield* session.updatePart(update(match.part))
        ctx.toolcalls[toolCallID] = {
          ...match.call,
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
        }
        return part
      })

      const completeToolCall = Effect.fn("SessionProcessor.completeToolCall")(function* (
        toolCallID: string,
        output: {
          title: string
          metadata: Record<string, any>
          output: string
          attachments?: MessageV2.FilePart[]
        },
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") return
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "completed",
            input: match.part.state.input,
            output: output.output,
            metadata: output.metadata,
            title: output.title,
            time: { start: match.part.state.time.start, end: Date.now() },
            attachments: output.attachments,
          },
        })
        yield* settleToolCall(toolCallID)
      })

      const failToolCall = Effect.fn("SessionProcessor.failToolCall")(function* (toolCallID: string, error: unknown) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") return false
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "error",
            input: match.part.state.input,
            error: errorMessage(error),
            time: { start: match.part.state.time.start, end: Date.now() },
          },
        })
        if (error instanceof Permission.RejectedError || error instanceof Question.RejectedError) {
          ctx.blocked = ctx.shouldBreak
        }
        yield* settleToolCall(toolCallID)
        return true
      })

      const handleEvent = Effect.fnUntraced(function* (value: StreamEvent) {
        switch (value.type) {
          case "start":
            yield* status.set(ctx.sessionID, { type: "busy" })
            return

          case "reasoning-start":
            if (value.id in ctx.reasoningMap) return
            ctx.reasoningMap[value.id] = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "reasoning",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            yield* session.updatePart(ctx.reasoningMap[value.id])
            return

          case "reasoning-delta":
            if (!(value.id in ctx.reasoningMap)) return
            ctx.reasoningMap[value.id].text += value.text
            if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.reasoningMap[value.id].sessionID,
              messageID: ctx.reasoningMap[value.id].messageID,
              partID: ctx.reasoningMap[value.id].id,
              field: "text",
              delta: value.text,
            })
            return

          case "reasoning-end":
            if (!(value.id in ctx.reasoningMap)) return
            // oxlint-disable-next-line no-self-assign -- reactivity trigger
            ctx.reasoningMap[value.id].text = ctx.reasoningMap[value.id].text
            ctx.reasoningMap[value.id].time = { ...ctx.reasoningMap[value.id].time, end: Date.now() }
            if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
            yield* session.updatePart(ctx.reasoningMap[value.id])
            delete ctx.reasoningMap[value.id]
            return

          case "tool-input-start":
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`)
            }
            const part = yield* session.updatePart({
              id: ctx.toolcalls[value.id]?.partID ?? PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "tool",
              tool: value.toolName,
              callID: value.id,
              state: { status: "pending", input: {}, raw: "" },
              metadata: value.providerExecuted ? { providerExecuted: true } : undefined,
            } satisfies MessageV2.ToolPart)
            ctx.toolcalls[value.id] = {
              done: yield* Deferred.make<void>(),
              partID: part.id,
              messageID: part.messageID,
              sessionID: part.sessionID,
            }
            return

          case "tool-input-delta":
            return

          case "tool-input-end":
            return

          case "tool-call": {
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`)
            }
            yield* updateToolCall(value.toolCallId, (match) => ({
              ...match,
              tool: value.toolName,
              state: {
                ...match.state,
                status: "running",
                input: value.input,
                time: { start: Date.now() },
              },
              metadata: match.metadata?.providerExecuted
                ? { ...value.providerMetadata, providerExecuted: true }
                : value.providerMetadata,
            }))

            const parts = MessageV2.parts(ctx.assistantMessage.id)
            const recentParts = parts.slice(-DOOM_LOOP_THRESHOLD)

            if (
              recentParts.length !== DOOM_LOOP_THRESHOLD ||
              !recentParts.every(
                (part) =>
                  part.type === "tool" &&
                  part.tool === value.toolName &&
                  part.state.status !== "pending" &&
                  JSON.stringify(part.state.input) === JSON.stringify(value.input),
              )
            ) {
              return
            }

            const agent = yield* agents.get(ctx.assistantMessage.agent)
            yield* permission.ask({
              permission: "doom_loop",
              patterns: [value.toolName],
              sessionID: ctx.assistantMessage.sessionID,
              metadata: { tool: value.toolName, input: value.input },
              always: [value.toolName],
              ruleset: agent.permission,
            })
            return
          }

          case "tool-result": {
            yield* completeToolCall(value.toolCallId, value.output)
            return
          }

          case "tool-error": {
            yield* failToolCall(value.toolCallId, value.error)
            return
          }

          case "error":
            throw value.error

          case "start-step":
            if (!ctx.snapshot) ctx.snapshot = yield* snapshot.track()
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              snapshot: ctx.snapshot,
              type: "step-start",
            })
            return

          case "finish-step": {
            const usage = Session.getUsage({
              model: ctx.model,
              usage: value.usage,
              metadata: value.providerMetadata,
            })
            ctx.assistantMessage.finish = value.finishReason
            ctx.assistantMessage.cost += usage.cost
            ctx.assistantMessage.tokens = usage.tokens
            yield* session.updatePart({
              id: PartID.ascending(),
              reason: value.finishReason,
              snapshot: yield* snapshot.track(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "step-finish",
              tokens: usage.tokens,
              cost: usage.cost,
            })
            yield* session.updateMessage(ctx.assistantMessage)
            if (ctx.snapshot) {
              const patch = yield* snapshot.patch(ctx.snapshot)
              if (patch.files.length) {
                yield* session.updatePart({
                  id: PartID.ascending(),
                  messageID: ctx.assistantMessage.id,
                  sessionID: ctx.sessionID,
                  type: "patch",
                  hash: patch.hash,
                  files: patch.files,
                })
              }
              ctx.snapshot = undefined
            }
            yield* summary
              .summarize({
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.parentID,
              })
              .pipe(Effect.ignore, Effect.forkIn(scope))
            if (
              !ctx.assistantMessage.summary &&
              isOverflow({ cfg: yield* config.get(), tokens: usage.tokens, model: ctx.model })
            ) {
              ctx.needsCompaction = true
            }
            return
          }

          case "text-start":
            ctx.currentText = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "text",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            yield* session.updatePart(ctx.currentText)
            return

          case "text-delta":
            if (!ctx.currentText) return
            ctx.currentText.text += value.text
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.currentText.sessionID,
              messageID: ctx.currentText.messageID,
              partID: ctx.currentText.id,
              field: "text",
              delta: value.text,
            })
            return

          case "text-end":
            if (!ctx.currentText) return
            // oxlint-disable-next-line no-self-assign -- reactivity trigger
            ctx.currentText.text = ctx.currentText.text
            ctx.currentText.text = (yield* plugin.trigger(
              "experimental.text.complete",
              {
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.id,
                partID: ctx.currentText.id,
              },
              { text: ctx.currentText.text },
            )).text
            {
              const end = Date.now()
              ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
            }
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePart(ctx.currentText)
            ctx.currentText = undefined
            return

          case "finish":
            return

          default:
            slog.info("unhandled", { event: value.type, value })
            return
        }
      })

      const cleanup = Effect.fn("SessionProcessor.cleanup")(function* () {
        if (ctx.snapshot) {
          const patch = yield* snapshot.patch(ctx.snapshot)
          if (patch.files.length) {
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              type: "patch",
              hash: patch.hash,
              files: patch.files,
            })
          }
          ctx.snapshot = undefined
        }

        if (ctx.currentText) {
          const end = Date.now()
          ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
          yield* session.updatePart(ctx.currentText)
          ctx.currentText = undefined
        }

        for (const part of Object.values(ctx.reasoningMap)) {
          const end = Date.now()
          yield* session.updatePart({
            ...part,
            time: { start: part.time.start ?? end, end },
          })
        }
        ctx.reasoningMap = {}

        yield* Effect.forEach(
          Object.values(ctx.toolcalls),
          (call) => Deferred.await(call.done).pipe(Effect.timeout("250 millis"), Effect.ignore),
          { concurrency: "unbounded" },
        )

        for (const toolCallID of Object.keys(ctx.toolcalls)) {
          const match = yield* readToolCall(toolCallID)
          if (!match) continue
          const part = match.part
          const end = Date.now()
          const metadata = "metadata" in part.state && isRecord(part.state.metadata) ? part.state.metadata : {}
          yield* session.updatePart({
            ...part,
            state: {
              ...part.state,
              status: "error",
              error: "Tool execution aborted",
              metadata: { ...metadata, interrupted: true },
              time: { start: "time" in part.state ? part.state.time.start : end, end },
            },
          })
        }
        ctx.toolcalls = {}
        ctx.assistantMessage.time.completed = Date.now()
        yield* session.updateMessage(ctx.assistantMessage)
      })

      const halt = Effect.fn("SessionProcessor.halt")(function* (e: unknown) {
        slog.error("process", { error: errorMessage(e), stack: e instanceof Error ? e.stack : undefined })
        const error = parse(e)
        if (MessageV2.ContextOverflowError.isInstance(error)) {
          ctx.needsCompaction = true
          yield* bus.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
          return
        }
        ctx.assistantMessage.error = error
        yield* bus.publish(Session.Event.Error, {
          sessionID: ctx.assistantMessage.sessionID,
          error: ctx.assistantMessage.error,
        })
        yield* status.set(ctx.sessionID, { type: "idle" })
      })

      const process = Effect.fn("SessionProcessor.process")(function* (streamInput: LLM.StreamInput) {
        slog.info("process")
        ctx.needsCompaction = false
        ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true

        // Run team debate — if team is enabled, find implementer and swap model
        // Accumulate ALL previous team threads so context grows across turns
        let previousThread = ""
        for (const msg of streamInput.messages) {
          if (msg.role !== "assistant") continue
          const raw = msg.content
          const content = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n") : ""
          const matches = [...content.matchAll(/### Team Discussion\n\n([\s\S]*?)(?=\n\n### Team Discussion|\n\n### (?!Team Discussion)|$)/g)]
          for (const m of matches) {
            const t = m[1].trim()
            if (t) previousThread = previousThread ? `${previousThread}\n\n${t}` : t
          }
        }

        const teamModel = yield* team.run(streamInput, ctx.sessionID, ctx.assistantMessage.id, previousThread || undefined).pipe(
          Effect.orElseSucceed(() => Option.none()),
        )
        let finalInput: LLM.StreamInput = streamInput
        let cliImplementer: CliParticipant | null = null
        let concurrentDone = false
        if (Option.isSome(teamModel)) {
          const { participant, orderedParticipants, thread, subTeamImplementers } = teamModel.value
          const model = participant.model

          const lastUserMsg = [...streamInput.messages].reverse().find((m) => m.role === "user")
          let taskStr = ""
          let fullContext = ""
          if (lastUserMsg) {
            const c = lastUserMsg.content
            if (typeof c === "string") taskStr = c
            else if (Array.isArray(c)) taskStr = c.filter((p: any) => p.type === "text").map((p: any) => p.text as string).join("\n")
          }
          // Build full conversation context from ALL messages (multiple turns)
          for (const msg of streamInput.messages) {
            if (msg.role === "user") {
              const content = typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("") : ""
              if (content) fullContext += `\n[USER]: ${content.slice(0, 2000)}`
            } else if (msg.role === "assistant") {
              const content = typeof msg.content === "string" ? msg.content : ""
              if (content) fullContext += `\n[ASSISTANT]: ${content.slice(0, 1000)}`
            }
          }
          if (fullContext) taskStr = `PREVIOUS CONVERSATION:\n${fullContext}\n\nCURRENT TASK:\n${taskStr}`

          if (subTeamImplementers && subTeamImplementers.length > 0) {
            slog.info("team.concurrent.subteams", { count: subTeamImplementers.length })
            yield* status.set(ctx.sessionID as any, { type: "busy" })

            // Build fallback map: teamName -> alternative API participant
            const apiPool = orderedParticipants.filter((p): p is ApiParticipant => p.kind === "api")
            const fallbackImpl = new Map<string, ApiParticipant>()
            for (const sti of subTeamImplementers) {
              if (sti.implementer.kind === "api" && apiPool.length > 1) {
                const fallback = apiPool.find((p) => p.model.id !== sti.implementer.model.id && sti.memberIDs.includes(p.model.id))
                if (fallback) fallbackImpl.set(sti.subTeamName, fallback)
              }
              if (!fallbackImpl.has(sti.subTeamName) && apiPool.length > 0) {
                const anyOther = apiPool.find((p) => p.model.id !== (sti.implementer.kind === "api" ? sti.implementer.model.id : ""))
                if (anyOther) fallbackImpl.set(sti.subTeamName, anyOther)
              }
            }

            // Create text parts for real-time streaming BEFORE running tasks
            const subTeamPartIDs = new Map<string, string>()
            for (const sti of subTeamImplementers) {
              if (sti.implementer.kind !== "api") continue
              const partID = PartID.ascending()
              subTeamPartIDs.set(sti.subTeamName, partID as string)
              yield* session.updatePart({
                id: partID, messageID: ctx.assistantMessage.id,
                sessionID: ctx.assistantMessage.sessionID, type: "text",
                text: `## ${sti.subTeamName} (${sti.implementer.model.name})\n`,
                time: { start: Date.now() },
              })
            }

            const bridge = yield* EffectBridge.make()

            const subTeamResults: ImplResult[] = yield* Effect.all(
              subTeamImplementers.map((sti) => {
                const impl = sti.implementer
                if (impl.kind !== "api") return Effect.succeed({ modelName: impl.model.name, teamName: sti.subTeamName, output: "(CLI)", files: [] as string[], implementer: impl } satisfies ImplResult)
                const rawPartID = subTeamPartIDs.get(sti.subTeamName)
                const partID = rawPartID as string | undefined
                return Effect.promise(() =>
                  runTaskImplementer(impl,
                    `SUB-TEAM DEBATE:\n${sti.thread.slice(-3000)}\n\nSub-team: ${sti.subTeamName}\nFocus: ${sti.focus}\nFull task: ${taskStr}`,
                    sti.subTeamName, thread, streamInput.tools,
                    partID ? (chunk: string) => {
                      bridge.fork(session.updatePartDelta({
                        sessionID: ctx.assistantMessage.sessionID,
                        messageID: ctx.assistantMessage.id,
                        partID: partID as any, field: "text" as const, delta: chunk,
                      }))
                    } : undefined,
                  ),
                )
              }),
              { concurrency: "unbounded" },
            )

            // Finalize text parts with completed text
            for (const r of subTeamResults) {
              const rawPartID = subTeamPartIDs.get(r.teamName)
              if (rawPartID) {
                const now = Date.now()
                bridge.fork(session.updatePart({
                  id: rawPartID as any, messageID: ctx.assistantMessage.id,
                  sessionID: ctx.assistantMessage.sessionID, type: "text",
                  text: `## ${r.teamName} (${r.modelName})\n${r.output}`,
                  time: { start: now, end: now },
                }))
              }
            }

            // If a sub-team's implementer failed, try fallback with full context
            for (const r of subTeamResults) {
              if (r.error && r.implementer.kind === "api") {
                const fb = fallbackImpl.get(r.teamName)
                if (fb) {
                  const sti = subTeamImplementers.find((s) => s.subTeamName === r.teamName)
                  slog.info("team.concurrent.fallback", { team: r.teamName, fallback: fb.model.name, failedOutput: r.output.slice(0, 100) })
                  // Pass the failed LLM's output + sub-team's internal debate thread as context
                  const fbContext = `PREVIOUS ATTEMPT (FAILED: ${r.error}):\n${r.output.slice(0, 3000)}\n\nSUB-TEAM DEBATE:\n${(sti?.thread ?? "").slice(-4000)}\n\nYOUR TASK:\nSub-team: ${r.teamName}\nFocus: ${sti?.focus ?? ""}\nFull task: ${taskStr}\n\nContinue from where the previous implementer failed. Read existing files, fix or complete them.`
                  const fbResult = yield* Effect.promise(() =>
                    runTaskImplementer(fb, fbContext, `${r.teamName} (fallback)`, thread, streamInput.tools),
                  )
                  // Record fallback in session memory
                  const now = Date.now()
                  yield* session.updatePart({ id: PartID.ascending(), messageID: ctx.assistantMessage.id, sessionID: ctx.assistantMessage.sessionID, type: "text", text: `### Fallback: ${r.teamName}\n**${r.modelName}** failed (${r.error}) → **${fb.model.name}** took over\n\nPrevious output:\n\`\`\`\n${r.output.slice(0, 500)}\n\`\`\``, time: { start: now, end: now } })
                  const idx = subTeamResults.findIndex((sr) => sr.teamName === r.teamName)
                  if (idx >= 0) subTeamResults[idx] = fbResult
                }
              }
            }
            const conflicts = findFileConflicts(subTeamResults)
            if (conflicts.length > 0) {
              slog.info("team.concurrent.conflicts", { count: conflicts.length, files: conflicts.map((c) => c.file) })
              for (const conflict of conflicts) {
                const involved = subTeamResults.filter((r) => conflict.teams.includes(r.teamName))
                const apiP = orderedParticipants.filter((p): p is ApiParticipant => p.kind === "api")
                if (apiP.length < 2) continue
                const combined = involved.map((r) => `=== ${r.teamName} (${r.modelName}) ===\n${r.output}`).join("\n\n")
                yield* Effect.promise(() => resolveConflicts(apiP[0], apiP[1] || apiP[0], [conflict.file], combined, taskStr, streamInput.tools)).pipe(Effect.orElseSucceed(() => ""))
              }
            }
            const checkResult = yield* Effect.promise(() => checkAndFixLoop(subTeamResults, thread, taskStr, streamInput.tools, fallbackImpl))
            if (checkResult.iterations > 0) {
              const now = Date.now()
              yield* session.updatePart({ id: PartID.ascending(), messageID: ctx.assistantMessage.id, sessionID: ctx.assistantMessage.sessionID, type: "text", text: `### Automated checks: ${checkResult.iterations} iteration(s)\nErrors fixed by sub-teams.\n\n\`\`\`\n${checkResult.lastErrors.slice(0, 1500)}\n\`\`\``, time: { start: now, end: now } })
            }
            ctx.assistantMessage.modelID = model.id
            ctx.assistantMessage.providerID = model.providerID
            ctx.assistantMessage.time.completed = Date.now()
            yield* session.updateMessage(ctx.assistantMessage)
            yield* status.set(ctx.sessionID, { type: "idle" })
            concurrentDone = true
          }

          if (!concurrentDone && orderedParticipants.length > 1) {
            const apiP = orderedParticipants.filter((p): p is ApiParticipant => p.kind === "api")
            if (apiP.length >= 2) {
              const tasks = yield* Effect.promise(() => generateTaskBreakdown(apiP[0], thread, taskStr, orderedParticipants.map((p) => p.model.name))).pipe(Effect.orElseSucceed(() => [] as string[]))
              if (tasks.length > 0) {
                slog.info("team.concurrent.tasks", { count: tasks.length })
                const assignments: Array<{ p: ApiParticipant; task: string; label: string }> = []
                for (let i = 0; i < tasks.length; i++) assignments.push({ p: apiP[i % apiP.length], task: tasks[i], label: apiP[i % apiP.length].model.name })
                const taskResults: ImplResult[] = yield* Effect.all(
                  assignments.map(({ p, task, label }) => Effect.promise(() => runTaskImplementer(p, task, label, thread, streamInput.tools))),
                  { concurrency: "unbounded" },
                )
                // Fallback: if a task implementer failed, try another participant with full context
                for (const r of taskResults) {
                  if (r.error && r.implementer.kind === "api") {
                    const fb = apiP.find((p) => p.model.id !== r.implementer.model.id)
                    if (fb) {
                      slog.info("team.concurrent.fallback", { team: r.teamName, fallback: fb.model.name, failedOutput: r.output.slice(0, 100) })
                      const origTask = assignments.find((a) => a.label === r.teamName)
                      const fbContext = `PREVIOUS ATTEMPT (FAILED: ${r.error}):\n${r.output.slice(0, 3000)}\n\nCONTINUE FROM FAILURE:\n${origTask?.task ?? r.teamName}\n\nRead existing files, fix or complete them.`
                      const fbResult = yield* Effect.promise(() => runTaskImplementer(fb, fbContext, `${r.teamName} (fallback)`, thread, streamInput.tools))
                      const now = Date.now()
                      yield* session.updatePart({ id: PartID.ascending(), messageID: ctx.assistantMessage.id, sessionID: ctx.assistantMessage.sessionID, type: "text", text: `### Fallback: ${r.teamName}\n**${r.modelName}** failed (${r.error}) → **${fb.model.name}** took over`, time: { start: now, end: now } })
                      const idx = taskResults.findIndex((sr) => sr.teamName === r.teamName)
                      if (idx >= 0) taskResults[idx] = fbResult
                    }
                  }
                }
                const taskFallback = new Map<string, ApiParticipant>()
                for (const a of assignments) {
                  taskFallback.set(a.label, apiP.find((p) => p.model.id !== a.p.model.id) ?? a.p)
                }
                const conflicts = findFileConflicts(taskResults)
                if (conflicts.length > 0) slog.info("team.concurrent.conflicts", { count: conflicts.length })
                const checkResult = yield* Effect.promise(() => checkAndFixLoop(taskResults, thread, taskStr, streamInput.tools, taskFallback))
                if (checkResult.iterations > 0) {
                  const now = Date.now()
                  yield* session.updatePart({ id: PartID.ascending(), messageID: ctx.assistantMessage.id, sessionID: ctx.assistantMessage.sessionID, type: "text", text: `### Checks: ${checkResult.iterations} iteration(s)\n\`\`\`\n${checkResult.lastErrors.slice(0, 1500)}\n\`\`\``, time: { start: now, end: now } })
                }
                const allText = checkResult.results.map((r) => `## ${r.teamName}\n${r.output}`).join("\n\n---\n\n")
                const now = Date.now()
                yield* session.updatePart({ id: PartID.ascending(), messageID: ctx.assistantMessage.id, sessionID: ctx.assistantMessage.sessionID, type: "text", text: `## Concurrent Team Implementation\n\n${allText}`, time: { start: now, end: now } })
                ctx.assistantMessage.modelID = model.id
                ctx.assistantMessage.providerID = model.providerID
                ctx.assistantMessage.time.completed = Date.now()
                yield* session.updateMessage(ctx.assistantMessage)
                yield* status.set(ctx.sessionID, { type: "idle" })
                concurrentDone = true
              }
            }
          }

          if (!concurrentDone) {
            if (CLI_PROVIDER_IDS.has(model.providerID)) {
              slog.info("team.implementer.cli", { modelID: model.id, providerID: model.providerID })
              cliImplementer = participant as CliParticipant
              ctx.assistantMessage.modelID = model.id
              ctx.assistantMessage.providerID = model.providerID
              ctx.model = model
              yield* session.updateMessage(ctx.assistantMessage)
              finalInput = streamInput
            } else {
              slog.info("team.implementer", { modelID: model.id, providerID: model.providerID })
              ctx.assistantMessage.modelID = model.id
              ctx.assistantMessage.providerID = model.providerID
              ctx.model = model
              yield* session.updateMessage(ctx.assistantMessage)
              finalInput = { ...streamInput, model }
            }
          }
        }

        if (concurrentDone) return "stop" as const

        // CLI implementation path — run agentic CLI subprocess directly
        if (cliImplementer) {
          const cli = cliImplementer
          const bridge = yield* EffectBridge.make()
          yield* Effect.callback<void>((resume) => {
            ;(async () => {
              try {
                const start = Date.now()
                const partID = PartID.ascending()

                bridge.fork(
                  session.updatePart({
                    id: partID,
                    messageID: ctx.assistantMessage.id,
                    sessionID: ctx.assistantMessage.sessionID,
                    type: "text",
                    text: "",
                    time: { start },
                  }),
                )

                let prevLen = 0
                const onChunk = (accumulated: string) => {
                  const delta = accumulated.slice(prevLen)
                  prevLen = accumulated.length
                  if (!delta) return
                  bridge.fork(
                    session.updatePartDelta({
                      sessionID: ctx.assistantMessage.sessionID,
                      messageID: ctx.assistantMessage.id,
                      partID,
                      field: "text",
                      delta,
                    }),
                  )
                }

                let accumulated = ""
                if (cli.cli === "gemini") {
                  accumulated = await callGeminiAgent(cli.bin, finalInput.messages as any, cli.model.id, onChunk)
                } else if (cli.cli === "claude-code") {
                  accumulated = await callClaudeAgent(cli.bin, finalInput.messages as any, cli.model.id, onChunk)
                } else {
                  accumulated = await callCodex(cli.bin, finalInput.messages as any, cli.model.id, onChunk)
                }

                bridge.fork(
                  session.updatePart({
                    id: partID,
                    messageID: ctx.assistantMessage.id,
                    sessionID: ctx.assistantMessage.sessionID,
                    type: "text",
                    text: accumulated,
                    time: { start, end: Date.now() },
                  }),
                )
                resume(Effect.void)
              } catch {
                resume(Effect.void)
              }
            })()
          })
          return "stop" as const
        }

        return yield* Effect.gen(function* () {
          yield* Effect.gen(function* () {
            ctx.currentText = undefined
            ctx.reasoningMap = {}
            const stream = llm.stream(finalInput)

            yield* stream.pipe(
              Stream.tap((event) => handleEvent(event)),
              Stream.takeUntil(() => ctx.needsCompaction),
              Stream.runDrain,
            )
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                aborted = true
                if (!ctx.assistantMessage.error) {
                  yield* halt(new DOMException("Aborted", "AbortError"))
                }
              }),
            ),
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) => Effect.fail(Cause.squash(cause)),
            ),
            Effect.retry(
              SessionRetry.policy({
                parse,
                set: (info) =>
                  status.set(ctx.sessionID, {
                    type: "retry",
                    attempt: info.attempt,
                    message: info.message,
                    next: info.next,
                  }),
              }),
            ),
            Effect.catch(halt),
            Effect.ensuring(cleanup()),
          )

          if (ctx.needsCompaction) {
            if (streamInput.user.team?.length) {
              ctx.needsCompaction = false
              return "continue"
            }
            return "compact"
          }
          if (ctx.blocked || ctx.assistantMessage.error) return "stop"
          return "continue"
        })
      })

      return {
        get message() {
          return ctx.assistantMessage
        },
        updateToolCall,
        completeToolCall,
        process,
      } satisfies Handle
    })

    return Service.of({ create })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Session.defaultLayer),
    Layer.provide(Snapshot.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(LLM.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Team.defaultLayer),
  ),
)

export * as SessionProcessor from "./processor"
