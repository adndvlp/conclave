import { Effect, Layer, Context, Option } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Provider } from "@/provider/provider"
import { SessionStatus } from "@/session/status"
import { runBreakingTeams, type Participant, type RoundSignal } from "./debate"
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
    onRoundComplete?: (round: number, roundText: string) => Effect.Effect<void>,
  ) => Effect.Effect<Option.Option<{ participant: Participant; thread: string }>>
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

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const status = yield* SessionStatus.Service

    const run = Effect.fn("Team.run")(function* (
      streamInput: LLM.StreamInput,
      sessionID: string,
      onRoundComplete?: (round: number, roundText: string) => Effect.Effect<void>,
    ) {
      const members = streamInput.user.team
      let result: Option.Option<{ participant: Participant; thread: string }> = Option.none()

      if (members && members.length >= 2) {
        const task = extractTask(streamInput.messages)

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

          // Bridge for calling Effects from async/Promise callbacks
          const bridge = yield* EffectBridge.make()

          // Per-participant accumulated streaming text
          const participantTexts = new Map<string, { text: string; round: number }>()
          let lastChunkEmit = 0
          let chunkTimeout: NodeJS.Timeout | null = null

          const onParticipantChunk = (modelName: string, text: string, round: number) => {
            participantTexts.set(modelName, { text, round })
            const now = Date.now()

            const flush = () => {
              lastChunkEmit = Date.now()
              if (chunkTimeout) {
                clearTimeout(chunkTimeout)
                chunkTimeout = null
              }
              bridge.fork(
                Effect.gen(function* () {
                  const current = yield* status.get(sessionID as any)
                  if (current.type !== "team.breaking") return
                  yield* status.set(sessionID as any, {
                    ...current,
                    participantStreams: Array.from(participantTexts.entries()).map(([name, d]) => ({
                      modelName: name,
                      text: d.text,
                      round: d.round,
                    })),
                  })
                }),
              )
            }

            if (now - lastChunkEmit < 250) {
              if (!chunkTimeout) {
                chunkTimeout = setTimeout(flush, 250 - (now - lastChunkEmit))
              }
              return
            }
            flush()
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
              const current = yield* status.get(sessionID as any)
              yield* status.set(sessionID as any, {
                type: "team.breaking",
                globalRound: globalRoundNum,
                subTeams: subTeamsInfo,
                participantStreams: current.type === "team.breaking" ? current.participantStreams : undefined,
              })
            })

          const debateResult = yield* runBreakingTeams(
            participants,
            task,
            maxRounds,
            minRounds,
            maxSubTeams,
            globalRoundInterval,
            onBreakingProgress,
            onRoundComplete,
            onParticipantChunk,
          )

          log.info("team.done", {
            implementer: debateResult.implementer.model.id,
            converged: debateResult.converged,
            globalRounds: debateResult.globalRounds,
            subTeams: debateResult.subTeams.length,
          })

          yield* status.set(sessionID as any, { type: "busy" })
          result = Option.some({ participant: debateResult.implementer, thread: debateResult.thread })
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
)
