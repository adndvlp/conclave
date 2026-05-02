import { Effect, Layer, Context, Option } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Provider } from "@/provider/provider"
import { SessionStatus } from "@/session/status"
import { runBreakingTeams, type Participant, type RoundSignal } from "./debate"
import type { LLM } from "@/session/llm"
import type { ModelMessage } from "ai"

const log = Log.create({ service: "team" })

export interface Interface {
  readonly run: (
    streamInput: LLM.StreamInput,
    sessionID: string,
    onRoundComplete?: (round: number, roundText: string) => Effect.Effect<void>,
  ) => Effect.Effect<Option.Option<{ model: Provider.Model; thread: string }>>
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
      let result: Option.Option<{ model: Provider.Model; thread: string }> = Option.none()

      if (members && members.length >= 2) {
        const task = extractTask(streamInput.messages)

        const resolved = yield* Effect.all(
          members.map(({ providerID, modelID }) =>
            Effect.gen(function* () {
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
              return Option.some<Participant>({ model: model.value, language: language.value })
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
            status.set(sessionID as any, {
              type: "team.breaking",
              globalRound: globalRoundNum,
              subTeams: subTeamsInfo,
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
          )

          log.info("team.done", {
            implementer: debateResult.implementer.model.id,
            converged: debateResult.converged,
            globalRounds: debateResult.globalRounds,
            subTeams: debateResult.subTeams.length,
          })

          yield* status.set(sessionID as any, { type: "busy" })
          result = Option.some({ model: debateResult.implementer.model, thread: debateResult.thread })
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
