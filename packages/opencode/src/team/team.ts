import { Effect, Layer, Context, Option } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Provider } from "@/provider/provider"
import { SessionStatus } from "@/session/status"
import { Session } from "@/session/session"
import { PartID } from "@/session/schema"
import { runBreakingTeams, type Participant, type RoundSignal, type SubTeamImplementer } from "./debate"
import { CLI_PROVIDER_IDS, cliSyntheticModel, detectCli } from "./cli-adapter"
import { EffectBridge } from "@/effect/bridge"
import type { LLM } from "@/session/llm"
import type { ModelMessage } from "ai"

export type { Participant }

const log = Log.create({ service: "team" })

export interface Interface {
  readonly run: (
    streamInput: LLM.StreamInput,
    sessionID: string,
    messageID: string,
    initialThread?: string,
  ) => Effect.Effect<Option.Option<{
    participant: Participant
    orderedParticipants: Participant[]
    subTeamImplementers: SubTeamImplementer[]
    thread: string
  }>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Team") {}

function extractTask(messages: ModelMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user")
  if (!last) return ""
  if (typeof last.content === "string") return last.content
  if (Array.isArray(last.content)) {
    return last.content
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text as string)
      .join("")
  }
  return ""
}

function buildFullContext(messages: ModelMessage[]): string {
  const parts: string[] = []
  for (const msg of messages) {
    if (msg.role === "user") {
      const content = typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("") : ""
      if (content) parts.push(content.slice(0, 2000))
    }
  }
  return parts.join("\n\n")
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const status = yield* SessionStatus.Service
    const session = yield* Session.Service

    const run = Effect.fn("Team.run")(function* (
      streamInput: LLM.StreamInput,
      sessionID: string,
      messageID: string,
      initialThread?: string,
    ) {
      const members = streamInput.user.team
      let result: Option.Option<{ participant: Participant; orderedParticipants: Participant[]; subTeamImplementers: SubTeamImplementer[]; thread: string }> = Option.none()

      if (members && members.length >= 2) {
        const task = extractTask(streamInput.messages)
        const fullContext = buildFullContext(streamInput.messages)
        // Include previous team discussion thread if available
        const previousThread = initialThread ? `PREVIOUS TEAM DISCUSSION:\n${initialThread}\n\n` : ""
        // Prepend full conversation history so debate participants know what happened before
        const taskWithContext = `${previousThread}PREVIOUS CONVERSATION:\n${fullContext}\n\nCURRENT TASK:\n${task}`

        const resolved = yield* Effect.all(
          members.map(({ providerID, modelID }) =>
            Effect.gen(function* () {
              // CLI participant — resolve via subprocess detection, no SDK needed
              if (CLI_PROVIDER_IDS.has(providerID)) {
                const cliMap: Record<string, { cli: "gemini" | "claude-code" | "codex"; bin: string; label: string }> = {
                  "cli-gemini":  { cli: "gemini",     bin: "gemini", label: "Gemini" },
                  "cli-claude":  { cli: "claude-code", bin: "claude", label: "Claude Code" },
                  "cli-codex":   { cli: "codex",      bin: "codex",  label: "Codex" },
                }
                const entry = cliMap[providerID]
                if (!entry) return Option.none<Participant>()
                const bin = yield* Effect.promise(() => detectCli(entry.bin))
                if (!bin) {
                  log.warn("team.cli.not_found", { providerID, bin: entry.bin })
                  return Option.none<Participant>()
                }
                const model = cliSyntheticModel(providerID, modelID, `${entry.label} (${modelID})`)
                return Option.some<Participant>({ kind: "cli", model, cli: entry.cli, bin })
              }

              // API participant
              const model = yield* provider.getModel(providerID, modelID).pipe(Effect.option)
              if (Option.isNone(model)) {
                log.warn("team.member.not_found", { providerID, modelID })
                return Option.none<Participant>()
              }
              const language = yield* provider.getLanguage(model.value).pipe(Effect.option)
              if (Option.isNone(language)) {
                log.warn("team.member.no_language", { providerID, modelID })
                return Option.none<Participant>()
              }
              return Option.some<Participant>({ kind: "api", model: model.value, language: language.value })
            }),
          ),
          { concurrency: "unbounded" },
        )

        const participants: Participant[] = resolved.filter(Option.isSome).map((x) => x.value)

        if (participants.length >= 2) {
          const maxRounds = 3
          const minRounds = 2
          const breakingCfg = (streamInput.user as any).team_config?.breakingTeams
          const maxSubTeams = breakingCfg?.maxSubTeams ?? 3
          const globalRoundInterval = breakingCfg?.globalRoundInterval ?? 1

          yield* status.set(sessionID as any, {
            type: "team.breaking",
            globalRound: 0,
            subTeams: [],
          })

          // Create reasoning parts per participant (same pattern as single-model reasoning)
          const participantPartIDs = new Map<string, string>()
          const participantPrevLen = new Map<string, number>()
          const sid: any = sessionID
          const mid: any = messageID

          // Round header — appears once above all reasoning toggles
          yield* session.updatePart({
            id: PartID.ascending(), messageID: mid, sessionID: sid, type: "text" as const,
            text: `### Debate · Round 1 / ${maxRounds}`,
            time: { start: Date.now() },
          } as any)

          for (const p of participants) {
            const partID = PartID.ascending()
            participantPartIDs.set(p.model.name, partID as string)
            participantPrevLen.set(p.model.name, 0)
            yield* session.updatePart({
              id: partID, messageID: mid, sessionID: sid, type: "reasoning" as const,
              text: `### ${p.model.name}\n`,
              time: { start: Date.now() },
            } as any)
          }

          const bridge = yield* EffectBridge.make()

          const onParticipantChunk = (modelName: string, text: string, round: number) => {
            // Stream delta to reasoning part (same as single-model reasoning-delta)
            const pid = participantPartIDs.get(modelName)
            const prevLen = participantPrevLen.get(modelName) ?? 0
            if (pid) {
              const delta = text.slice(prevLen)
              participantPrevLen.set(modelName, text.length)
              if (delta) {
                bridge.fork(
                  session.updatePartDelta({
                    sessionID: sid, messageID: mid,
                    partID: pid as any, field: "text" as const, delta,
                  } as any),
                )
              }
            }
          }

          const onBreakingProgress = (
            subTeamsInfo: Array<{
              id: string
              name: string
              status: "working" | "done" | "blocked"
              round: number
              signals: RoundSignal[]
            }>,
            globalRoundNum: number,
          ) =>
            Effect.gen(function* () {
              yield* status.set(sessionID as any, {
                type: "team.breaking",
                globalRound: globalRoundNum,
                subTeams: subTeamsInfo,
              })
            })

          const debateResult = yield* runBreakingTeams(
            participants,
            taskWithContext,
            initialThread || "",
            maxRounds,
            minRounds,
            maxSubTeams,
            globalRoundInterval,
            onBreakingProgress,
            onParticipantChunk,
          )

          log.info("team.done", {
            implementer: debateResult.implementer.model.id,
            converged: debateResult.converged,
            globalRounds: debateResult.globalRounds,
            subTeams: debateResult.subTeams.length,
            participants: debateResult.orderedParticipants.map((p) => p.model.id),
          })

          // Persist team thread for next turn (as text part so it converts to ModelMessage)
          if (debateResult.thread.trim()) {
            yield* session.updatePart({
              id: PartID.ascending(), messageID: messageID as any, sessionID: sessionID as any,
              type: "text" as const,
              text: `### Team Discussion\n\n${debateResult.thread}`,
              time: { start: Date.now(), end: Date.now() },
              metadata: { team_thread: true },
            } as any)
          }

          yield* status.set(sessionID as any, { type: "busy" })
          result = Option.some({
            participant: debateResult.implementer,
            orderedParticipants: debateResult.orderedParticipants,
            subTeamImplementers: debateResult.subTeamImplementers,
            thread: debateResult.thread,
          })
        } else {
          log.warn("team.insufficient_members", { found: participants.length })
        }
      }

      return result
    })

    return Service.of({ run: run as Interface["run"] })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Provider.defaultLayer),
  Layer.provide(SessionStatus.defaultLayer),
  Layer.provide(Session.defaultLayer),
)
