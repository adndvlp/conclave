import { Effect } from "effect"
import { generateText } from "ai"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { Provider } from "@/provider/provider"
import { buildDeliberationPrompt, buildSubTeamPrompt, buildGlobalRoundPrompt } from "./prompts"
import type { SubTeam, CrossTeamMessage } from "./schema"

export type Participant = {
  model: Provider.Model
  language: LanguageModelV3
}

export type RoundSignal = {
  model: string
  signal: string
  text: string
}

export type ProgressCallback = (round: number, total: number, signals: RoundSignal[]) => Effect.Effect<void>

export type BreakingProgressCallback = (subTeams: Array<{
  id: string
  name: string
  status: SubTeam["status"]
  round: number
  signals: RoundSignal[]
}>, globalRound: number) => Effect.Effect<void>

// ─── Signal types ───────────────────────────────────────────────────────────

type Round1SignalType = "PROPOSE" | "QUESTION" | "BREAK" | "PASS"
type Round2SignalType = "LEAD" | "SUPPORT" | "ALIGN" | "BUILD" | "CHALLENGE" | "SYNTHESIZE" | "EXTEND" | "PASS"
type GlobalSignalType = "BROADCAST" | "PASS"
type SignalType = Round1SignalType | Round2SignalType | GlobalSignalType

type Signal =
  | { type: "PROPOSE" | "QUESTION" | "BUILD" | "CHALLENGE" | "SYNTHESIZE" | "PASS"; payload?: string }
  | { type: "LEAD" | "EXTEND" | "BROADCAST"; payload: string }
  | { type: "SUPPORT" | "ALIGN"; target: string; reason?: string }
  | { type: "BREAK"; teamName: string; focus: string; invites: string[] }

const ROUND1_PATTERN = /^(PROPOSE|QUESTION|BREAK|PASS)(?::(.*))?$/
const ROUND2_PATTERN = /^(LEAD|SUPPORT|ALIGN|BUILD|CHALLENGE|SYNTHESIZE|EXTEND|PASS)(?::(.*))?$/
const GLOBAL_PATTERN = /^(BROADCAST|PASS)(?::(.*))?$/

function parseSignal(text: string, round: number, global = false): Signal | null {
  const candidates = text.trim().split("\n").slice(-5).reverse()
  const pattern = global ? GLOBAL_PATTERN : round === 1 ? ROUND1_PATTERN : ROUND2_PATTERN

  for (const line of candidates) {
    const clean = line.trim().replace(/^\*+|\*+$|^_+|_+$/g, "").trim()
    const match = clean.match(pattern)
    if (!match) continue

    const type = match[1] as SignalType
    const data = match[2]?.trim() ?? ""

    if (type === "SUPPORT" || type === "ALIGN") {
      const colonIdx = data.indexOf(":")
      const target = colonIdx >= 0 ? data.slice(0, colonIdx).trim() : data
      const reason = colonIdx >= 0 ? data.slice(colonIdx + 1).trim() : undefined
      return { type, target, reason }
    }

    if (type === "BREAK") {
      const parts = data.split(":")
      const teamName = parts[0]?.trim() ?? ""
      const focus = parts[1]?.trim() ?? ""
      const invites = parts[2]
        ? parts[2].split(",").map((s) => s.trim()).filter(Boolean)
        : []
      return { type, teamName, focus, invites }
    }

    return { type: type as any, payload: data || undefined }
  }

  return null
}

// ─── Result types ────────────────────────────────────────────────────────────

export type DebateResult = {
  implementer: Participant
  converged: boolean
  rounds: number
  extensions: number
  thread: string
}

export type BreakingTeamsResult = {
  implementer: Participant
  converged: boolean
  globalRounds: number
  subTeams: SubTeam[]
  thread: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function selectWinner(
  participants: Participant[],
  endorsements: Map<string, number>,
  leads: Map<string, number>,
): Participant {
  let best = participants[0]
  let bestScore = -1
  for (const p of participants) {
    const score = (endorsements.get(p.model.id) ?? 0) * 2 + (leads.get(p.model.id) ?? 0)
    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }
  return best
}

function lastNLines(text: string, n = 8): string {
  return text.trim().split("\n").slice(-n).join("\n")
}

// ─── Core debate ─────────────────────────────────────────────────────────────

export const runDebate = Effect.fn("Team.runDebate")(function* (
  participants: Participant[],
  task: string,
  maxRounds = 3,
  minRounds = 2,
  maxExtensions = 2,
  roundExtension = 1,
  onProgress?: ProgressCallback,
  onRoundComplete?: (round: number, text: string) => Effect.Effect<void>,
): Generator<any, DebateResult> {
  let thread = ""
  let implementer: Participant | null = null
  let converged = false
  let rounds = 0
  let extensions = 0
  let dynamicMax = maxRounds
  const endorsements = new Map<string, number>()
  const leads = new Map<string, number>()

  for (let round = 1; round <= dynamicMax; round++) {
    rounds = round

    const roundResults = yield* Effect.all(
      participants.map((p) =>
        Effect.promise(() =>
          generateText({
            model: p.language as any,
            messages: buildDeliberationPrompt({
              self: p.model,
              teammates: participants.filter((x) => x.model.id !== p.model.id).map((x) => x.model),
              task,
              thread,
              round,
              maxRounds: dynamicMax,
            }) as any,
            maxOutputTokens: 1024,
            temperature: 0.2,
          }),
        ).pipe(
          Effect.map((result: any) => ({
            participant: p,
            text: result.text,
            signal: parseSignal(result.text, round),
          })),
          Effect.orElseSucceed(() => ({
            participant: p,
            text: "",
            signal: null as Signal | null,
          })),
        ),
      ),
      { concurrency: "unbounded" },
    )

    const roundSignals: RoundSignal[] = []
    let extendVotes = 0

    for (const { participant, text, signal } of roundResults) {
      if (text) thread += `\n[${participant.model.name}]: ${text}\n`
      if (signal) {
        const signalStr =
          signal.type === "SUPPORT" || signal.type === "ALIGN"
            ? `${signal.type}:${(signal as any).target}`
            : (signal as any).payload
              ? `${signal.type}:${(signal as any).payload.slice(0, 40)}`
              : signal.type

        roundSignals.push({ model: participant.model.name, signal: signalStr, text })

        if (signal.type === "LEAD") leads.set(participant.model.id, (leads.get(participant.model.id) ?? 0) + 1)

        if (signal.type === "SUPPORT" || signal.type === "ALIGN") {
          const targetName = (signal as any).target as string
          const target = participants.find(
            (p) =>
              p.model.name.toLowerCase().includes(targetName.toLowerCase()) ||
              targetName.toLowerCase().includes(p.model.name.toLowerCase()),
          )
          if (target) endorsements.set(target.model.id, (endorsements.get(target.model.id) ?? 0) + 1)
        }

        if (signal.type === "EXTEND") extendVotes++
      }
    }

    if (onProgress) yield* onProgress(round, dynamicMax, roundSignals)
    if (onRoundComplete) {
      const roundSummary = roundSignals
        .map((s) => `- **${s.model}**: ${s.signal}${s.text ? `\n  > ${s.text.slice(0, 200)}` : ""}`)
        .join("\n")
      yield* onRoundComplete(round, `## Ronda ${round}\n\n${roundSummary || "Sin senales"}${thread ? `\n\n### Hilo\n\n${lastNLines(thread, 20)}` : ""}`)
    }

    if (extendVotes > participants.length / 2 && extensions < maxExtensions) {
      dynamicMax += roundExtension
      extensions++
    }

    if (round >= minRounds) {
      const maxEndorsed = endorsements.size > 0 ? Math.max(...endorsements.values()) : 0
      if (maxEndorsed >= participants.length - 1) {
        implementer = selectWinner(participants, endorsements, leads)
        converged = true
        break
      }
    }
  }

  if (!implementer) implementer = selectWinner(participants, endorsements, leads)

  return { implementer, converged, rounds, extensions, thread }
})

// ─── Breaking Teams ───────────────────────────────────────────────────────────

type BreakProposal = {
  participant: Participant
  teamName: string
  focus: string
  invites: string[]
}

function formSubTeams(
  proposals: BreakProposal[],
  allParticipants: Participant[],
): SubTeam[] {
  const hardMax = Math.floor(allParticipants.length / 2)

  // Index participants by name fragments for invite resolution
  const byName = (query: string): Participant | undefined =>
    allParticipants.find(
      (p) =>
        p.model.name.toLowerCase().includes(query.toLowerCase()) ||
        query.toLowerCase().includes(p.model.name.toLowerCase()),
    )

  // Which team each participant explicitly chose (by their own BREAK signal)
  const explicitTeam = new Map<string, string>() // modelId → teamName key
  for (const p of proposals) {
    explicitTeam.set(p.participant.model.id, p.teamName.toLowerCase())
  }

  const teamMap = new Map<string, { focus: string; members: Participant[] }>()

  // First pass: register teams and their proposers
  for (const p of proposals) {
    const key = p.teamName.toLowerCase()
    if (!teamMap.has(key)) {
      if (teamMap.size >= hardMax) continue
      teamMap.set(key, { focus: p.focus, members: [] })
    }
    const team = teamMap.get(key)!
    if (!team.members.find((m) => m.model.id === p.participant.model.id)) {
      team.members.push(p.participant)
    }
  }

  // Second pass: process invites — add invited model if they didn't pick a different team
  for (const p of proposals) {
    const key = p.teamName.toLowerCase()
    const team = teamMap.get(key)
    if (!team) continue

    for (const inviteName of p.invites) {
      const invited = byName(inviteName)
      if (!invited) continue
      const theirChoice = explicitTeam.get(invited.model.id)
      // Only accept invite if they didn't explicitly choose another team
      if (theirChoice && theirChoice !== key) continue
      if (!team.members.find((m) => m.model.id === invited.model.id)) {
        team.members.push(invited)
      }
    }
  }

  const teams = Array.from(teamMap.entries()).map(([name, { focus, members }], idx) => ({
    id: `team-${idx}`,
    name,
    focus,
    members,
  }))

  // Merge solo teams into smallest viable team
  const solos = teams.filter((t) => t.members.length < 2)
  const viable = teams.filter((t) => t.members.length >= 2)

  for (const solo of solos) {
    if (viable.length === 0) { viable.push(solo); continue }
    const target = viable.reduce((a, b) => (a.members.length <= b.members.length ? a : b))
    target.members.push(...solo.members)
  }

  // Participants not in any team stay global-only

  return viable.map((t, idx) => ({
    id: `team-${idx}`,
    name: t.name,
    focus: t.focus,
    memberIDs: t.members.map((m) => m.model.id),
    thread: "",
    rounds: 0,
    status: "working" as const,
    crossTeamMessages: [],
  }))
}

export const runBreakingTeams = Effect.fn("Team.runBreakingTeams")(function* (
  participants: Participant[],
  task: string,
  maxRounds = 3,
  minRounds = 2,
  maxSubTeams = 3,
  globalRoundInterval = 1,
  onProgress?: BreakingProgressCallback,
  onRoundComplete?: (round: number, text: string) => Effect.Effect<void>,
): Generator<any, BreakingTeamsResult> {
  // ── Phase 0: decision round ─────────────────────────────────────────────
  const phase0Results = yield* Effect.all(
    participants.map((p) =>
      Effect.promise(() =>
        generateText({
          model: p.language as any,
          messages: buildDeliberationPrompt({
            self: p.model,
            teammates: participants.filter((x) => x.model.id !== p.model.id).map((x) => x.model),
            task,
            thread: "",
            round: 1,
            maxRounds: 1,
            allowBreak: true,
          }) as any,
          maxOutputTokens: 512,
          temperature: 0.2,
        }),
      ).pipe(
        Effect.map((r: any) => ({
          participant: p,
          text: r.text,
          signal: parseSignal(r.text, 1),
        })),
        Effect.orElseSucceed(() => ({ participant: p, text: "", signal: null as Signal | null })),
      ),
    ),
    { concurrency: "unbounded" },
  )

  const breakProposals: BreakProposal[] = []
  let phase0Thread = ""

  for (const { participant, text, signal } of phase0Results) {
    if (text) phase0Thread += `\n[${participant.model.name}]: ${text}\n`
    if (signal?.type === "BREAK") {
      breakProposals.push({
        participant,
        teamName: (signal as any).teamName,
        focus: (signal as any).focus,
        invites: (signal as any).invites ?? [],
      })
    }
  }

  // Not enough BREAK votes or only 1 unique team → fall back to normal debate
  const uniqueTeams = new Set(breakProposals.map((p) => p.teamName.toLowerCase()))
  if (breakProposals.length < participants.length / 2 || uniqueTeams.size < 2) {
    const result = yield* runDebate(participants, task, maxRounds, minRounds, 2, 1, undefined, onRoundComplete)
    return {
      implementer: result.implementer,
      converged: result.converged,
      globalRounds: result.rounds,
      subTeams: [],
      thread: result.thread,
    }
  }

  // ── Phase 1: form sub-teams ──────────────────────────────────────────────
  const subTeamDefs = formSubTeams(breakProposals, participants)
  const participantMap = new Map(participants.map((p) => [p.model.id, p]))

  // Mutable runtime state per sub-team (thread, messages, etc.)
  const subTeamState = new Map<string, {
    thread: string
    crossTeamMessages: CrossTeamMessage[]
    status: SubTeam["status"]
    rounds: number
    endorsements: Map<string, number>
    leads: Map<string, number>
    implementer: Participant | null
  }>()

  for (const st of subTeamDefs) {
    subTeamState.set(st.id, {
      thread: "",
      crossTeamMessages: [],
      status: "working",
      rounds: 0,
      endorsements: new Map(),
      leads: new Map(),
      implementer: null,
    })
  }

  let globalRound = 0
  let allDone = false
  const globalBroadcasts: CrossTeamMessage[] = []
  let globalThread = phase0Thread

  // ── Phase 2: main loop ───────────────────────────────────────────────────
  for (let cycle = 1; cycle <= maxRounds && !allDone; cycle++) {
    // ── Sub-team internal rounds (parallel) ──────────────────────────────
    yield* Effect.all(
      subTeamDefs.map((st) =>
        Effect.gen(function* () {
          const state = subTeamState.get(st.id)!
          if (state.status === "done") return

          const members = st.memberIDs.map((id) => participantMap.get(id as any)!).filter(Boolean)
          if (members.length === 0) return

          state.rounds++
          const round = state.rounds

          // Inject incoming cross-team broadcasts into thread context
          const newMessages = globalBroadcasts.filter((m) => m.globalRound === globalRound)
          state.crossTeamMessages.push(...newMessages)

          const roundResults = yield* Effect.all(
            members.map((p) =>
              Effect.promise(() =>
                generateText({
                  model: p.language as any,
                  messages: buildSubTeamPrompt({
                    self: p.model,
                    teammates: members.filter((m) => m.model.id !== p.model.id).map((m) => m.model),
                    teamName: st.name,
                    focus: st.focus,
                    task,
                    thread: state.thread,
                    crossTeamMessages: state.crossTeamMessages,
                    round,
                    maxRounds,
                  }) as any,
                  maxOutputTokens: 1024,
                  temperature: 0.2,
                }),
              ).pipe(
                Effect.map((r) => ({
                  participant: p,
                  text: r.text,
                  signal: parseSignal(r.text, round),
                })),
                Effect.orElseSucceed(() => ({ participant: p, text: "", signal: null as Signal | null })),
              ),
            ),
            { concurrency: "unbounded" },
          )

          const roundSignals: RoundSignal[] = []

          for (const { participant, text, signal } of roundResults) {
            if (text) state.thread += `\n[${participant.model.name}]: ${text}\n`
            if (signal) {
              const signalStr =
                signal.type === "SUPPORT" || signal.type === "ALIGN"
                  ? `${signal.type}:${(signal as any).target}`
                  : (signal as any).payload
                    ? `${signal.type}:${(signal as any).payload.slice(0, 40)}`
                    : signal.type

              roundSignals.push({ model: participant.model.name, signal: signalStr, text })

              if (signal.type === "LEAD") state.leads.set(participant.model.id, (state.leads.get(participant.model.id) ?? 0) + 1)
              if (signal.type === "SUPPORT" || signal.type === "ALIGN") {
                const targetName = (signal as any).target as string
                const target = members.find(
                  (m) =>
                    m.model.name.toLowerCase().includes(targetName.toLowerCase()) ||
                    targetName.toLowerCase().includes(m.model.name.toLowerCase()),
                )
                if (target) state.endorsements.set(target.model.id, (state.endorsements.get(target.model.id) ?? 0) + 1)
              }
            }
          }

          // Check convergence for this sub-team
          if (round >= minRounds) {
            const maxEndorsed = state.endorsements.size > 0 ? Math.max(...state.endorsements.values()) : 0
            if (maxEndorsed >= members.length - 1 || members.length === 1) {
              state.implementer = selectWinner(members, state.endorsements, state.leads)
              state.status = "done"
            }
          }

          if (onRoundComplete) {
            const roundText = roundSignals
              .map((s) => `**[${st.name}] ${s.model}** \`${s.signal}\`\n\n${s.text}`)
              .join("\n\n---\n\n")
            yield* onRoundComplete(round, `## Sub-equipo: ${st.name}\n\n${roundText}`)
          }

          if (onProgress) {
            yield* onProgress(
              subTeamDefs.map((s) => {
                const ss = subTeamState.get(s.id)!
                return { id: s.id, name: s.name, status: ss.status, round: ss.rounds, signals: roundSignals }
              }),
              globalRound,
            )
          }
        }),
      ),
      { concurrency: "unbounded" },
    )

    // ── Global round (every globalRoundInterval cycles) ──────────────────
    if (cycle % globalRoundInterval === 0) {
      globalRound++

      const globalResults = yield* Effect.all(
        participants.map((p) => {
          const myTeam = subTeamDefs.find((st) => st.memberIDs.includes(p.model.id))
          const myState = myTeam ? subTeamState.get(myTeam.id)! : null
          const otherTeams = subTeamDefs
            .filter((st) => st.id !== myTeam?.id)
            .map((st) => ({
              name: st.name,
              summary: lastNLines(subTeamState.get(st.id)!.thread),
            }))

          return Effect.promise(() =>
            generateText({
              model: p.language as any,
              messages: buildGlobalRoundPrompt({
                self: p.model,
                myTeamName: myTeam?.name ?? "sin equipo",
                myTeamSummary: lastNLines(myState?.thread ?? ""),
                otherTeamsSummaries: otherTeams,
                task,
                globalRound,
              }) as any,
              maxOutputTokens: 512,
              temperature: 0.2,
            }),
          ).pipe(
            Effect.map((r) => ({
              participant: p,
              text: r.text,
              signal: parseSignal(r.text, 2, true),
              teamName: myTeam?.name ?? "sin equipo",
            })),
            Effect.orElseSucceed(() => ({
              participant: p,
              text: "",
              signal: null as Signal | null,
              teamName: myTeam?.name ?? "sin equipo",
            })),
          )
        }),
        { concurrency: "unbounded" },
      )

      let allPass = true
      const globalSignals: RoundSignal[] = []

      for (const { participant, text, signal, teamName } of globalResults) {
        if (text) globalThread += `\n[GLOBAL][${teamName}][${participant.model.name}]: ${text}\n`
        if (signal) {
          const signalStr = (signal as any).payload
            ? `${signal.type}:${(signal as any).payload.slice(0, 60)}`
            : signal.type

          globalSignals.push({ model: participant.model.name, signal: signalStr, text })

          if (signal.type === "BROADCAST") {
            allPass = false
            globalBroadcasts.push({
              fromTeam: teamName,
              message: (signal as any).payload ?? "",
              globalRound,
            })
          }
        }
      }

      if (onRoundComplete) {
        const globalText = globalSignals
          .map((s) => `**[GLOBAL] ${s.model}** \`${s.signal}\`\n\n${s.text}`)
          .join("\n\n---\n\n")
        yield* onRoundComplete(globalRound, `## Ronda global ${globalRound}\n\n${globalText}`)
      }

      // All done if all sub-teams converged AND no broadcasts
      const allSubsDone = subTeamDefs.every((st) => subTeamState.get(st.id)!.status === "done")
      if (allSubsDone && allPass) {
        allDone = true
      }
    }
  }

  // ── Phase 3: select global implementer ──────────────────────────────────
  // Pick implementer from sub-team with most endorsements total
  let globalImplementer: Participant | null = null
  let bestSubScore = -1

  for (const st of subTeamDefs) {
    const state = subTeamState.get(st.id)!
    const totalScore = Array.from(state.endorsements.values()).reduce((a, b) => a + b, 0) +
      Array.from(state.leads.values()).reduce((a, b) => a + b, 0)
    if (totalScore > bestSubScore && state.implementer) {
      bestSubScore = totalScore
      globalImplementer = state.implementer
    }
  }

  if (!globalImplementer) {
    globalImplementer = participants[0]
  }

  const fullThread = globalThread + "\n\n" + subTeamDefs
    .map((st) => `=== ${st.name.toUpperCase()} ===\n${subTeamState.get(st.id)!.thread}`)
    .join("\n\n")

  const finalSubTeams: SubTeam[] = subTeamDefs.map((st) => ({
    ...st,
    thread: subTeamState.get(st.id)!.thread,
    rounds: subTeamState.get(st.id)!.rounds,
    status: subTeamState.get(st.id)!.status,
    crossTeamMessages: subTeamState.get(st.id)!.crossTeamMessages,
  }))

  return {
    implementer: globalImplementer,
    converged: allDone,
    globalRounds: globalRound,
    subTeams: finalSubTeams,
    thread: fullThread,
  }
})
